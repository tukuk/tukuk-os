#!/usr/bin/env bash
# ==============================================================================
# snapshot-r2.sh — mirror the Tukuk-OS site to R2 (bucket: tukuk-fallback).
# Run by a systemd timer (every 6 hours) or manually:
#   CLOUDFLARE_API_TOKEN=... bash scripts/snapshot-r2.sh
#
# This is the rendered-site mirror in R2 (bucket: tukuk-fallback). It is now a LIVE
# fallback source again, and it is the FIRST one the brain reaches: during an origin
# outage the tukuk-fallback Worker on worker.tukuk.org serves this snapshot before it
# dials the Cloud Run mirror (which has a metered 1 GB/month egress ceiling; R2 has no
# egress charge). Recovery of the whole box is still a manual re-provision (git clone +
# setup-all) + scripts/restore-data.sh — this mirror is about *serving* through an
# outage, not about rebuilding a wiped disk.
# (Was: "edge is WORKERLESS, nothing serves it live" — re-lit by the GCP failover work;
#  see deploy/GCP-FAILOVER.md.)
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tukuk-fallback}"
BASE="${TUKUK_LOCAL_BASE:-http://127.0.0.1:3000}"
WURL="${BACKUP_WORKER_URL:-}"
WSEC="${BACKUP_UPLOAD_SECRET:-}"
FAILS=0
OKS=0
GIVEUP=0

# The VPS token has no R2 scope — without the worker path, the snapshot is sure to fail silently.
if [[ -z "$WURL" || -z "$WSEC" ]]; then
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "No BACKUP_WORKER_URL/SECRET & no token — skip snapshot."; exit 0; }
fi

put() { # put <key> <fail> [content-type]
  local key="$1" file="$2" ct="${3:-}"
  # Once the two transports are both proven unusable, stop paying for the proof.
  [[ "$GIVEUP" == "1" ]] && return 0
  if [[ -n "$WURL" && -n "$WSEC" ]]; then
    local args=(-fsS --max-time 60 -X POST -H "Authorization: Bearer $WSEC" --data-binary "@$file")
    [[ -n "$ct" ]] && args+=(-H "x-content-type: $ct")
    # The upload lands on a *.workers.dev endpoint that Cloudflare platform-throttles with
    # 429 (see backup-data.sh for the full diagnosis). Retry with a short backoff so a
    # transient throttle on one of these many small objects does not mark the whole
    # snapshot failed; a light 5 s/10 s pause is enough for the shared edge to free up.
    local n=0 failed=0
    until curl "${args[@]}" "$WURL/?key=$key" >/dev/null 2>&1; do
      n=$((n + 1))
      if [[ $n -ge 3 ]]; then echo "  ~ $key worker failed after $n tries — trying wrangler path"; failed=1; break; fi
      echo "  ~ $key throttled (429?) — retry $n/2"; sleep $((n * 5))
    done
    if [[ $failed -eq 0 ]]; then echo "  ✓ $key"; OKS=$((OKS+1)); return; fi
    # fall through to the wrangler branch below (self-heals when token gains R2 scope)
  fi
  if [[ -n "$ct" ]]; then
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ct" --remote >/dev/null 2>&1
  else
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --remote >/dev/null 2>&1
  fi && echo "  ✓ $key" || { echo "  ! failed $key"; FAILS=$((FAILS+1)); }
  # Fail fast, and say why. On a rebuilt box there is no BACKUP_WORKER_URL, and the R2
  # token in deploy/env.defaults authenticates but has no R2 Write scope — so every one
  # of these ~60 objects burns a 5 s + 10 s backoff and then a cold `npx wrangler`.
  # Measured on 30 Oct 2026: 78 throttled retries and 38 failures before the install
  # moved on, roughly 30 s each. Three failures with zero successes is conclusive.
  if [[ $FAILS -ge 3 && $OKS -eq 0 && "$GIVEUP" == "0" ]]; then
    GIVEUP=1
    echo "[snapshot] 3 uploads failed, 0 succeeded — neither transport works on this box:" >&2
    echo "           no BACKUP_WORKER_URL/BACKUP_UPLOAD_SECRET, and CLOUDFLARE_API_TOKEN has" >&2
    echo "           no R2 Write scope. Skipping the rest instead of spending half an hour" >&2
    echo "           re-proving it. Fix by setting the worker pair, or widening the token." >&2
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[snapshot] pulling live pages from $BASE ..."
declare -A PAGES=(
  ["/"]="/index.html"
  ["/about"]="/about.html"
  ["/contact"]="/contact.html"
  ["/privacy"]="/privacy.html"
  ["/terms"]="/terms.html"
  ["/docs"]="/docs.html"
  ["/explore"]="/explore.html"
  ["/access"]="/access.html"
  ["/nasa"]="/nasa.html"
  ["/blog"]="/blog/index.html"
  ["/learn"]="/learn/index.html"
)
for path in "${!PAGES[@]}"; do
  key="${PAGES[$path]}"
  mkdir -p "$TMP/$(dirname "$key")"
  if curl -fsS --max-time 30 "$BASE$path" -o "$TMP$key" 2>/dev/null; then
    put "${key#/}" "$TMP$key" "text/html;charset=UTF-8"
  else
    echo "  ! $path could not be pulled"
  fi
done

echo "[snapshot] building + uploading the edge search index (search-index.json) ..."
if node scripts/export-edge-index.js; then
  put "search-index.json" "data/edge-index.json" "application/json"
else
  echo "  ! index export failed (Meilisearch down?) — backup search may be stale"
fi

echo "[snapshot] upgrading public/ static assets ..."
for f in public/*.css public/*.js public/*.svg public/*.png public/*.ico public/*.json public/*.txt public/*.webmanifest; do
  [[ -f "$f" ]] || continue
  put "$(basename "$f")" "$f"
done

if (( FAILS > 0 )); then
  echo "[snapshot] WARNING: $FAILS uploads failed — www mirror NOT fresh." >&2
  exit 1
fi
echo "[snapshot] done. The www.tukuk.org mirror is now fresh."
