#!/usr/bin/env bash
# Purge the Cloudflare edge cache after a deploy.
#
# Why this exists: the app sends `s-maxage=3600, stale-while-revalidate=86400` on /theme.css,
# /theme.js and the other static assets, and `s-maxage=300` on rendered HTML. Cloudflare honours
# that, so for up to an hour after `systemctl restart tukuk-os` the edge keeps handing out the
# previous stylesheet and the previous pages. On 29 Oct 2026 an accessibility run against
# tukuk.org kept reporting contrast and link failures that were already fixed in the repo,
# because the audit was measuring an edge copy older than the deploy.
#
# Usage:
#   deploy/purge-edge-cache.sh                 # purge everything in the zone
#   deploy/purge-edge-cache.sh https://tukuk.org/theme.css https://tukuk.org/about
#
# Credentials: CLOUDFLARE_API_TOKEN from the environment or from .env next to this repo.
# The token needs Zone → Cache Purge → Purge for the zone. Nothing is printed but the outcome.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-tukuk.org}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$ROOT/.env" ]]; then
  # Read one key without sourcing the file: .env holds values with spaces and quotes.
  CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$ROOT/.env" | tail -1 | tr -d '"'"'"'')"
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
  echo "purge-edge-cache: could not resolve the zone id for $ZONE_NAME (token lacks Zone:Read?)" >&2
  exit 1
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
