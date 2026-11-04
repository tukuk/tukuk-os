#!/usr/bin/env bash
# ==============================================================================
# mirror-export.sh — snapshot the public site into a static folder for Cloudflare Pages.
#
# WHY THIS EXISTS: the whole site hangs off ONE cloudflared tunnel to THIS box.
# If the box, the tunnel or Node dies, tukuk.org AND www.tukuk.org both go dark —
# a DNS record pointing at the same dead origin is not a backup. The /alat tools
# are fully client-side (that was the design rule from day one), so a static
# snapshot of them is a genuine second server: Cloudflare Pages (free) serving
# www.tukuk.org keeps every converter, calculator and the Design Studio working
# even while this box is offline. Staleness costs freshness, never availability.
#
# WHAT IT COPIES: the hub, every /alat/* page (from the sitemap, so a new tool
# is mirrored the same hour it ships), the home page, and the handful of static
# assets those pages reference. NOT the whole site — live-data pages (/weather,
# /traffic, /api/*) would freeze mid-reading on a mirror and their SSR shells
# fetch nothing useful offline, so they stay out of scope on purpose.
#
# Requests go through the front proxy (127.0.0.1:3000) WITHOUT cookies, so they
# ride the shared nginx cache instead of forcing 100 fresh renders per cycle.
# ==============================================================================
set -uo pipefail
BASE="${MIRROR_BASE:-http://127.0.0.1:3000}"
OUT="${MIRROR_OUT:-/var/tmp/tukuk-mirror}"

mkdir -p "$OUT"
FAILED=0

# save <url-path> <output-file-relpath>
save() {
  local p="$1" dest="$OUT/$2"
  mkdir -p "$(dirname "$dest")"
  if curl -sf -m 60 --retry 2 -o "$dest" "$BASE$p"; then
    return 0
  fi
  echo "[mirror-export] FAILED: $p" >&2
  FAILED=$((FAILED + 1))
}

echo "[mirror-export] $BASE → $OUT"
save '/'                 'index.html'
save '/alat'             'alat.html'

# Every tool page, taken from the sitemap so the list can never drift from the app.
SITEMAP="$(mktemp)"
if curl -sf -m 30 -o "$SITEMAP" "$BASE/sitemap.xml"; then
  while read -r p; do
    [ -n "$p" ] || continue
    rel="${p#/alat/}"                       # /alat/unit → unit.html (Pages pretty URL)
    case "$rel" in */*) continue ;; esac    # safety: nested alat paths are not tools
    save "$p" "alat/${rel}.html"
  done < <(grep -o '<loc>[^<]*/alat/[^<]*</loc>' "$SITEMAP" | sed 's|<loc>https\?://[^/]*||; s|</loc>||')
else
  echo "[mirror-export] warning: sitemap unreachable — only hub + home mirrored" >&2
  FAILED=$((FAILED + 1))
fi
rm -f "$SITEMAP"

# Pages serves 404.html for any path the mirror never captured (live-data pages
# like /weather stay on the main server by design — without this file a visitor
# on www would meet Cloudflare's bare error instead of our own "go to the real
# site" page). The app's 404 renderer does the wording; we just store its body.
# NOT via save(): -f treats the 404 status as a failure and drops the body.
if curl -s -m 60 --retry 2 -o "$OUT/404.html" "$BASE/no-such-page-404-probe"; then
  echo '[mirror-export] 404.html captured'
else
  echo '[mirror-export] warning: could not capture 404.html' >&2
fi

# The static things those pages load. pdf-lib/fflate turn /alat/pdf and friends
# from dead forms into working tools on the mirror.
for a in /theme.js /theme.css /favicon.ico /icon.svg /apple-touch-icon.png /og.png \
         /consent.js /read-aloud.js /kamus.js \
         /libs/pdf-lib.min.js /libs/fflate.min.js /libs/qrcode.js; do
  save "$a" "${a#/}"
done

# The mirror must never compete with the real site in search: every snapshot page
# carries a canonical to tukuk.org already, and this header makes the intent
# explicit to any crawler that ignores canonicals.
cat > "$OUT/_headers" <<'EOF'
/*
  X-Robots-Tag: noindex, follow
EOF

TOOLS=$(find "$OUT/alat" -name '*.html' 2>/dev/null | wc -l)
echo "[mirror-export] done: $TOOLS tool pages + hub + home, $FAILED failure(s)"
# Partial failure is still a usable mirror — only shout, do not abort a deploy
# on one flaky page (the previous snapshot for that page stays untouched).
exit 0
