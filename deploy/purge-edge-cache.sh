#!/usr/bin/env bash
# Purge the Cloudflare edge cache after a deploy.
#
# Why this exists: static assets outlive a restart. Measured against tukuk.org on 29 Oct 2026
# (GET, not HEAD — HEAD is never cacheable, so `curl -I` cannot show cf-cache-status), with
# src/server.js as the authority: CSS/JS go out with `s-maxage=300, stale-while-revalidate=600`
# — /theme.css came back HIT, /theme.js REVALIDATED — images/icons/fonts carry `s-maxage=604800`,
# a week, and rendered HTML is DYNAMIC, so pages themselves are live the moment the service is.
# So the window this script shortens is 5 minutes for styles and scripts, and up to a week for a
# changed image or icon — that half is the actual reason to run it.
#
# It used to be a much bigger window. The CSS/JS lease was `s-maxage=3600, swr=86400` until an
# accessibility run against tukuk.org kept reporting contrast and link failures that were already
# fixed in the repo, because the audit was measuring an edge copy older than the deploy. The lease
# was cut — the CSS/JS branch of the static policy in src/server.js carries that story in its own
# comment; this paragraph is what survives it.
#
# Usage:
#   deploy/purge-edge-cache.sh --check              # prove the token sees the zone; purge NOTHING
#   deploy/purge-edge-cache.sh                 # purge everything in the zone
#   deploy/purge-edge-cache.sh https://tukuk.org/theme.css https://tukuk.org/about
#
# --check exists because the no-argument form wipes the whole zone cache, and that is the
# wrong way to find out whether a brand-new token is scoped correctly — it is a production
# cache miss for every visitor on a Free plan if it turns out the token could purge at all.
#
# Credentials: CLOUDFLARE_API_TOKEN from the environment or from .env next to this repo.
# The token needs Zone:Read (the id lookup below) plus Zone → Cache Purge → Purge for the zone.
# Nothing is printed but the outcome.
#
# Which message you will get, all measured 29 Oct 2026 with two different credentials:
#   • The token in /opt/tukuk-os/.env on the VPS verifies active but sees ZERO zones —
#     `GET /zones?name=tukuk.org` answers count 0, because it is scoped to Workers/AI.
#     Run this on the box today and "cannot see tukuk.org" is the expected outcome.
#   • The laptop's wrangler OAuth token DOES see the zone (it returns the 32-hex zone id)
#     but its purge POST comes back `"success":false, "code":10000, "message":
#     "Authentication error"`, because `zone (read)` does not include Cache Purge — and the
#     edge kept serving /theme.css afterwards, so that refusal was real, not cosmetic.
#   • On this laptop the .env key is present with an empty value: the "not set" message.
# None of these is a bug in this script. The missing piece is one dashboard action: an API
# token with Zone:Read + Zone → Cache Purge → Purge for tukuk.org, provable with --check.
# Note that --check cannot prove the PURGE scope — only a real purge can. It proves the half
# that fails first, which is the zone being visible at all. (`/user/tokens/verify` reports a
# status for API tokens only; an OAuth credential has no verify endpoint, and --check now says
# so instead of printing a blank — the wrangler token measured above is the case that hit it.)
set -euo pipefail

# --check must be stripped before anything else, and it never reaches the purge below.
CHECK=0
if [[ "${1:-}" == "--check" ]]; then CHECK=1; shift; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-tukuk.org}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$ROOT/.env" ]]; then
  # Read one key without sourcing the file: .env holds values with spaces and quotes.
  CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$ROOT/.env" | tail -1 | tr -d '"')"
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "purge-edge-cache: CLOUDFLARE_API_TOKEN is not set (env or $ROOT/.env)" >&2
  exit 1
fi

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "https://api.cloudflare.com/client/v4$path"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}"
}

# The zone id is looked up rather than stored: an id in a file is one more thing to get wrong
# when the token is rotated.
ZONE_ID="$(api GET "/zones?name=$ZONE_NAME" | sed -n 's/.*"id":"\([a-f0-9]\{32\}\)".*/\1/p' | head -1)"
if [[ -z "$ZONE_ID" ]]; then
  # The token on this box is scoped to Workers/AI and sees no zones, so this is the expected
  # outcome here today — the script is the right tool, the credential is the missing piece.
  echo "purge-edge-cache: the API token cannot see $ZONE_NAME (needs Zone:Read + Zone:Cache Purge)." >&2
  echo "purge-edge-cache: nothing was purged; the edge will refresh on its own within its TTL." >&2
  exit 1
fi

if [[ "$CHECK" == "1" ]]; then
  # The token itself is never printed, and neither is a prefix of it: "last 4" style output
  # is how credentials end up in logs that get pasted into issues.
  # `/user/tokens/verify` answers for API tokens ONLY. Measured 29 Oct 2026: with the
  # wrangler OAuth token the call returns no `status` field at all, and an interpolation of
  # an empty grep printed "Token status:" followed by nothing — a blank where a verdict
  # belongs reads like a broken script, so the absence is named instead.
  VERIFY="$(api GET /user/tokens/verify)"
  STATUS="$(printf '%s' "$VERIFY" | sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' | head -1)"
  if [[ -n "$STATUS" ]]; then
    echo "purge-edge-cache: --check only. API token status: $STATUS"
  else
    echo "purge-edge-cache: --check only. This credential is not an API token, so it has no"
    echo "purge-edge-cache:   verify endpoint — the two lines below are what actually count."
  fi
  echo "purge-edge-cache: $ZONE_NAME is visible, zone id ${#ZONE_ID} hex characters. Nothing was purged."
  echo "purge-edge-cache: the Cache Purge scope is still unproven — only a purge can prove it,"
  echo "purge-edge-cache: so run one named URL (not the no-argument form) to finish the check."
  exit 0
fi

if [[ $# -gt 0 ]]; then
  files="$(printf '"%s",' "$@" | sed 's/,$//')"
  body="{\"files\":[$files]}"
  what="$# URL(s)"
else
  body='{"purge_everything":true}'
  what="every cached object in $ZONE_NAME"
fi

response="$(api POST "/zones/$ZONE_ID/purge_cache" "$body")"
if [[ "$response" != *'"success":true'* ]]; then
  echo "purge-edge-cache: Cloudflare refused the purge: $response" >&2
  exit 1
fi
echo "purge-edge-cache: purged $what"
