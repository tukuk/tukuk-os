#!/usr/bin/env bash
# ==============================================================================
# snapshot-r2.sh — Cermin laman Tukuk-OS ke R2 (bucket: tukuk-fallback).
# Dijalankan oleh systemd timer (6 jam sekali) atau manual:
#   CLOUDFLARE_API_TOKEN=... bash scripts/snapshot-r2.sh
#
# Worker www.tukuk.org akan hidang snapshot ini bila origin/tunnel mati.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tukuk-fallback}"
BASE="${TUKUK_LOCAL_BASE:-http://127.0.0.1:3000}"

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "CLOUDFLARE_API_TOKEN tiada — skip snapshot."; exit 0; }

put() { # put <key> <fail> [content-type]
  local key="$1" file="$2" ct="${3:-}"
  if [[ -n "$ct" ]]; then
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ct" --remote >/dev/null 2>&1
  else
    npx --yes wrangler r2 object put "$BUCKET/$key" --file "$file" --remote >/dev/null 2>&1
  fi && echo "  ✓ $key" || echo "  ! gagal $key"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[snapshot] menarik halaman hidup daripada $BASE ..."
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
    put "$key" "$TMP$key" "text/html;charset=UTF-8"
  else
    echo "  ! $path tidak dapat ditarik"
  fi
done

echo "[snapshot] membina + menghantar indeks carian edge (search-index.json) ..."
if node scripts/export-edge-index.js; then
  put "search-index.json" "data/edge-index.json" "application/json"
else
  echo "  ! eksport indeks gagal (Meilisearch mati?) — carian sandaran mungkin lapuk"
fi

echo "[snapshot] naik taraf aset statik public/ ..."
for f in public/*.css public/*.js public/*.svg public/*.png public/*.ico public/*.json public/*.txt public/*.webmanifest; do
  [[ -f "$f" ]] || continue
  put "$(basename "$f")" "$f"
done

echo "[snapshot] selesai. Cermin www.tukuk.org kini segar."
