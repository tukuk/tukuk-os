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
#   deploy/purge-edge-cache.sh                 # purge everything in the zone
#   deploy/purge-edge-cache.sh https://tukuk.org/theme.css https://tukuk.org/about
#
# Credentials: CLOUDFLARE_API_TOKEN from the environment or from .env next to this repo.
# The token needs Zone:Read (the id lookup below) plus Zone → Cache Purge → Purge for the zone.
# Nothing is printed but the outcome.
#
# Which message you will get, measured 29 Oct 2026: the token in /opt/tukuk-os/.env on the VPS
# verifies active but sees ZERO zones — `GET /zones?name=tukuk.org` answers count 0, because it
# is scoped to Workers/AI. So run this on the box and expect "cannot see tukuk.org"; on this
# laptop the key is present with an empty value, which is the "not set" message. Neither is a
# bug in this script. The missing piece is one dashboard action: an API token with Zone:Read
# and Zone:Cache Purge for the tukuk.org zone.
set -euo pipefail

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
