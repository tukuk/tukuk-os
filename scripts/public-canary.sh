#!/usr/bin/env bash
# public-canary.sh — the check that does NOT live on the box.
#
# Every other monitor in this project runs on the VPS: watchdog.sh restarts a dead
# service, re-registers a tunnel that lost its edge registrations, and shouts when the
# public edge answers 530. All of that is worthless when the box itself is gone — and
# on 31 Oct 2026 the site answered 530 from the public edge while all four LAN
# addresses were unreachable from the dev laptop. Nothing in the stack could have
# reported it, because the reporter was inside the failure.
#
# So this runs from somewhere else: a laptop, a CI runner, a cron on another host.
# It checks the surface Google actually judges — availability, sitemap shape, the
# crawl budget, and whether an unapproved AdSense account is shipping units.
#
#   bash scripts/public-canary.sh                 # human table, exit 1 on any failure
#   CANARY_BASE=http://127.0.0.1:3000 bash scripts/public-canary.sh   # against local
#   CANARY_ADSENSE=on bash scripts/public-canary.sh                   # after approval
#   bash scripts/public-canary.sh --json          # one JSON object, for machines
#
# Exit codes: 0 all good · 1 something is wrong · 2 the edge itself is unreachable.
#
# Only curl, sed, grep and wc are assumed. No npm, no node, no repo.
set -uo pipefail

BASE="${CANARY_BASE:-https://tukuk.org}"
TIMEOUT="${CANARY_TIMEOUT:-15}"
ADSENSE="${CANARY_ADSENSE:-off}"
JSON=0
[ "${1:-}" = "--json" ] && JSON=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILS=0
SKIPS=0
ROWS=""
UNREACHABLE=0
ORIGIN_DOWN=0
CHECKS=0

# code_for <path> — HTTP status, or 000 when curl could not connect at all. curl prints its own
# 000 to stdout on a connection failure, so only the last three characters are trusted.
code_for() {
  local c
  c="$(curl -s -o "$TMP/body" -w '%{http_code}' -m "$TIMEOUT" "$BASE$1" 2>/dev/null)"
  c="${c: -3}"
  printf '%s' "${c:-000}"
}

row() { # $1 ok|fail|skip  $2 name  $3 detail
  CHECKS=$((CHECKS + 1))
  case "$1" in
    fail) FAILS=$((FAILS + 1)); LABEL=FAIL ;;
    skip) SKIPS=$((SKIPS + 1)); LABEL=SKIP ;;
    *)    LABEL=PASS ;;
  esac
  ROWS="${ROWS}$(printf '%-5s %-34s %s' "$LABEL" "$2" "$3")"$'\n'
}

# expect <name> <path> <wanted-code-regex> [text-that-must-appear]
expect() {
  local name="$1" path="$2" want="$3" must="${4:-}"
  local code; code="$(code_for "$path")"
  [ "$code" = "000" ] && UNREACHABLE=$((UNREACHABLE + 1))
  # 530 is Cloudflare's "no connector"; 521-524 and 502 are the same story told by a
  # different hop. All of them mean the box did not answer, which is a different failure
  # from "the box answered with a bug" — and the only one the on-box watchdog cannot report.
  case "$code" in 502|503|521|522|523|524|530) ORIGIN_DOWN=$((ORIGIN_DOWN + 1)) ;; esac
  if ! printf '%s' "$code" | grep -qE "^($want)$"; then
    row fail "$name" "want $want, got $code"
    return 1
  fi
  if [ -n "$must" ] && ! grep -qF -- "$must" "$TMP/body"; then
    row fail "$name" "missing text: $must"
    return 1
  fi
  row ok "$name" "$code"
  return 0
}

locs() { grep -o '<loc>' "$TMP/body" | wc -l | tr -d ' '; }

# --- 1. the front door -------------------------------------------------------
expect "home"              "/"               "200"
expect "health"            "/health"         "200"
expect "blog"              "/blog"           "200"
expect "privacy"           "/privacy"        "200"
expect "terms"             "/terms"          "200"
expect "contact"           "/contact"        "200"
expect "404 is a real 404" "/canary-no-such-page-$$" "404"

# --- 2. what crawlers are told ----------------------------------------------
if expect "robots.txt" "/robots.txt" "200" "Sitemap:"; then
  if grep -qE '^Disallow: /$' "$TMP/body"; then
    row fail "robots.txt allows crawling" "site blocks itself with Disallow: /"
  else
    row ok "robots.txt allows crawling" ""
  fi
fi

ADSTXT_PUB="${CANARY_PUB:-pub-8954948214333501}"
if expect "ads.txt" "/ads.txt" "200"; then
  if grep -qF "$ADSTXT_PUB" "$TMP/body"; then
    row ok "ads.txt names the publisher" "$ADSTXT_PUB"
  else
    row fail "ads.txt names the publisher" "no $ADSTXT_PUB line"
  fi
fi

# --- 3. sitemap shape, which is the crawl budget made visible ---------------
if expect "sitemap.xml" "/sitemap.xml" "200"; then
  N="$(locs)"; [ "$N" -ge 10 ] && row ok "sitemap.xml has entries" "$N loc" || row fail "sitemap.xml has entries" "$N loc"
fi

if expect "sitemap index (geo)" "/sitemap-geo.xml" "200"; then
  N="$(locs)"
  if [ "$N" -ge 600 ]; then row ok "geo index reaches children" "$N children"
  else row fail "geo index reaches children" "$N children (expected >= 600)"; fi
fi

# A cluster far above CRAWL_INDEX_MAX_ITEMS must advertise hubs only. This is the
# single check that notices if the 254,655-page settlements shard comes back.
if expect "crawl budget: settlements" "/sitemap-settlements.xml" "200"; then
  N="$(locs)"
  if [ "$N" -le 20 ]; then row ok "crawl budget: settlements" "$N loc (hubs only)"
  else row fail "crawl budget: settlements" "$N loc — item URLs are back in the sitemap"; fi
fi

# --- 4. the policy on a real item page --------------------------------------
# The hub only links continents, and a continent page renders ~100,000 cards, so the cheap
# way to a real item is a small country page. Qatar has 8 settlements in the dataset: a
# page small enough to fetch every 30 minutes, and still an item far above any sane line.
ITEM=""
for C in qatar panama jamaica; do
  curl -s -m "$TIMEOUT" -o "$TMP/ctry" "$BASE/settlements/n/$C" 2>/dev/null || continue
  ITEM="$(grep -o 'href="/settlements/[^"]*"' "$TMP/ctry" | sed 's/href="//; s/"$//' \
        | grep -vE '^/settlements/(africa|americas|antarctica|asia|europe|oceania)$' \
        | grep -vE '^/settlements/n/' | head -1)"
  [ -n "$ITEM" ] && break
done
if [ -n "$ITEM" ]; then
  if expect "shard item page" "$ITEM" "200"; then
    if grep -qiE '<meta[^>]+name="robots"[^>]+noindex' "$TMP/body"; then
      row ok "shard item is noindex" "$ITEM"
    else
      row fail "shard item is noindex" "$ITEM — meta robots is not noindex,follow"
    fi
    if [ "$ADSENSE" = "on" ]; then
      grep -qF 'pagead2.googlesyndication.com' "$TMP/body" \
        && row ok "approved: units present" "" || row fail "approved: units present" "no AdSense loader on the page"
    else
      if grep -qF 'pagead2.googlesyndication.com' "$TMP/body" || grep -qF '<ins class="adsbygoogle"' "$TMP/body"; then
        row fail "unapproved: no ad units" "$ITEM still ships AdSense"
      else
        row ok "unapproved: no ad units" ""
      fi
    fi
  fi
else
  row skip "shard item discovery" "no country page yielded an item link"
fi

# --- verdict ----------------------------------------------------------------
# Two distinct tragedies, two distinct verdicts. EDGE_DOWN (exit 2) means requests are not
# reaching the origin at all — dead box, dead tunnel, dead datacentre — and no amount of
# on-box monitoring will have noticed. DEGRADED (exit 1) means the origin answered and got
# something wrong, which is fixable by deploying.
if [ "$UNREACHABLE" -ge 3 ] || [ "$ORIGIN_DOWN" -ge 3 ]; then VERDICT="EDGE_DOWN"; else VERDICT="$([ "$FAILS" -eq 0 ] && echo OK || echo DEGRADED)"; fi

if [ "$JSON" = "1" ]; then
  printf '{"base":"%s","verdict":"%s","checks":%d,"fails":%d,"skips":%d,"unreachable":%d,"origin_down":%d,"adsense":"%s","at":"%s"}\n' \
    "$BASE" "$VERDICT" "$CHECKS" "$FAILS" "$SKIPS" "$UNREACHABLE" "$ORIGIN_DOWN" "$ADSENSE" "$(date -u +%FT%TZ)"
else
  printf '%s\n' "$ROWS"
  printf '%s — %d checks, %d failed, %d skipped, %d unreachable, %d origin-down (%s)\n' \
    "$VERDICT" "$CHECKS" "$FAILS" "$SKIPS" "$UNREACHABLE" "$ORIGIN_DOWN" "$(date -u +%FT%TZ)"
fi

[ "$VERDICT" = "EDGE_DOWN" ] && exit 2
[ "$FAILS" -eq 0 ] || exit 1
exit 0
