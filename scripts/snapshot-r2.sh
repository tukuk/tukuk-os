#!/usr/bin/env bash
# ==============================================================================
# snapshot-r2.sh — mirror the Tukuk-OS site to R2 (bucket: tukuk-fallback).
# Run by a systemd timer (every 6 hours) or manually:
#   CLOUDFLARE_API_TOKEN=... bash scripts/snapshot-r2.sh
#
# This is a COLD disaster copy of the rendered site only — nothing serves it
# automatically any more: the tukuk.org/www Worker was removed (edge is WORKERLESS,
# see README §9). Recovery from here is a manual re-provision (git clone + setup-all)
# plus scripts/restore-data.sh for the dynamic data/ — the snapshot is a last-resort
# static mirror if the origin box is gone entirely, NOT a live fallback path.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tukuk-fallback}"
BASE="${TUKUK_LOCAL_BASE:-http://127.0.0.1:3000}"
WURL="${BACKUP_WORKER_URL:-}"
WSEC="${BACKUP_UPLOAD_SECRET:-}"
FAILS=0

# The VPS token has no R2 scope — without the worker path, the snapshot is sure to fail silently.
if [[ -z "$WURL" || -z "$WSEC" ]]; then
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "No BACKUP_WORKER_URL/SECRET & no token — skip snapshot."; exit 0; }
fi

put() { # put <key> <fail> [content-type]
  local key="$1" file="$2" ct="${3:-}"
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
    if [[ $failed -eq 0 ]]; then echo "  ✓ $key"; return; fi
    # fall through to the wrangler branch below (self-heals when token gains R2 scope)
  fi
  if [[ -n "$ct" ]]; then
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ct" --remote >/dev/null 2>&1
  else
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --remote >/dev/null 2>&1
  fi && echo "  ✓ $key" || { echo "  ! failed $key"; FAILS=$((FAILS+1)); }
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
