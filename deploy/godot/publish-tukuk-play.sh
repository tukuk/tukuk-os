#!/bin/bash
# Publish an exported Godot web build to the play.tukuk.org document root.
#
# Installed root-owned at /usr/local/sbin/publish-tukuk-play and granted to the
# tukuk user through /etc/sudoers.d/tukuk-play, so station-break's
# tools/build-web.sh --deploy works from a detached session, where sudo has no
# terminal to prompt on. The privilege is scoped to this one script and this
# one destination; nothing else runs as root from the build.
set -euo pipefail

SRC=${1:-}
# Overridable so the whole publish path can be exercised against a scratch directory on a
# machine that has no /var/www yet -- and so that testing it does not overwrite a live game.
DEST="${TUKUK_PLAY_DIR:-/var/www/tukuk-play}"

[ -n "$SRC" ] || { echo "usage: $0 <exported web-build directory>" >&2; exit 2; }
[ -d "$SRC" ] || { echo "FATAL: no such directory: $SRC" >&2; exit 2; }
# Refuse anything that is not a finished export: an empty or half-written build
# would replace a working game with a broken one.
[ -f "$SRC/index.html" ] || { echo "FATAL: $SRC/index.html missing -- not an export dir" >&2; exit 2; }
[ -f "$SRC/index.pck" ] || { echo "FATAL: $SRC/index.pck missing -- export did not finish" >&2; exit 2; }
[ -f "$SRC/index.wasm" ] || { echo "FATAL: $SRC/index.wasm missing -- export did not finish" >&2; exit 2; }

mkdir -p "$DEST"
# Whole artifact dir minus editor-only *.import sidecars: a hardcoded file list
# silently drops whatever a later engine adds.
find "$SRC" -maxdepth 1 -type f ! -name '*.import' -exec cp -f {} "$DEST"/ \;
chmod a+r "$DEST"/*
# Chrome asks for /favicon.ico unprompted on every visit and the export never
# writes one, so each boot logged a 404 against the game shell. The engine icon
# is already published; reuse it instead of adding an asset. Guarded because this
# runs after the artifact copy: under `set -e` a missing icon would abort here and
# leave the document root holding half of a new build.
if [ -f "$DEST/index.icon.png" ]; then
  cp -f "$DEST/index.icon.png" "$DEST/favicon.ico"
  chmod a+r "$DEST/favicon.ico"
fi

# Cloudflare Free caches by URL EXTENSION and refuses files over 512 MB. The engine
# names its pack `index.pck`, which is on both counts: uncacheable extension, and at
# ~478 MB one bad texture import pushes it over the size ceiling. So the pack is
# published under a `.zip` name (byte-identical, it already IS a zip container) and
# index.html is rewritten to dial that name with a content hash as the query string —
# the hash is what lets a new build replace a year-cached immutable URL.
PACK_LIMIT=536870912   # 512 MB
pck_size=$(stat -c %s "$DEST/index.pck")
if [ "$pck_size" -gt "$PACK_LIMIT" ] && [ "${ALLOW_BIG_PACK:-0}" != "1" ]; then
  echo "FATAL: index.pck is $pck_size bytes, above the 512 MB CDN cache limit." >&2
  echo "       Every visitor would stream the pack from origin through the tunnel." >&2
  echo "       Fix the export_filter in the Web preset (see deploy/godot/build-web.sh), or set ALLOW_BIG_PACK=1." >&2
  exit 3
fi
HASH=$(sha256sum "$DEST/index.pck" | cut -c1-12)
cp -f "$DEST/index.pck" "$DEST/index.pck.zip"
chmod a+r "$DEST/index.pck.zip"
cp -f "$DEST/index.html" "$DEST/index.html.pre-pckzip.bak"
sed -i "s#\([\"'\"]\)index\.pck\1#\1index.pck.zip?v=pck$HASH\1#g" "$DEST/index.html"
if ! grep -q "index.pck.zip?v=pck$HASH" "$DEST/index.html"; then
  mv -f "$DEST/index.html.pre-pckzip.bak" "$DEST/index.html"
  echo "FATAL: no mainPack reference to index.pck was found in index.html — the engine's shell" >&2
  echo "       format changed. Refusing to publish, because a silently unaliased pack means" >&2
  echo "       origin-streamed downloads for every player and no cache hit to measure." >&2
  exit 4
fi
rm -f "$DEST/index.html.pre-pckzip.bak"

# Serve-side proof the alias actually answers, through the front on loopback with the
# game's Host header — the same path the tunnel takes. SKIP_LOCAL_CHECK=1 for a dry run
# on a machine with no nginx in front yet (the style of test the file list above is for).
if [ "${SKIP_LOCAL_CHECK:-0}" != "1" ]; then
  curl -sS -o /dev/null -w "shell    %{http_code} %{content_type} %{size_download}B\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/index.html" || true
  curl -sS -o /dev/null -w "pack     %{http_code} %{size_download}B (want $pck_size)\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/index.pck.zip?v=pck$HASH" || true
fi

# The edge is the only place this counts. Two requests: MISS then HIT proves Cloudflare
# is holding the pack, which is the entire reason the alias exists.
if [ "${SKIP_EDGE_CHECK:-0}" != "1" ] && command -v curl >/dev/null; then
  a=$(curl -4 -s -D- -o /dev/null --max-time 120 "https://play.tukuk.org/index.pck.zip?v=pck$HASH" | grep -i '^cf-cache-status:' | tr -d '\r' | cut -d' ' -f2)
  b=$(curl -4 -s -D- -o /dev/null --max-time 120 "https://play.tukuk.org/index.pck.zip?v=pck$HASH" | grep -i '^cf-cache-status:' | tr -d '\r' | cut -d' ' -f2)
  echo "edge     1st=${a:-none} 2nd=${b:-none}"
  case "$b" in
    HIT) echo "edge cache confirmed: the pack is served by Cloudflare, not this box." ;;
    *)   echo "WARNING: 2nd request was not HIT (got ${b:-no header}). MISS the first time is" >&2
         echo "         normal; anything else means the alias, the extension rule or the tunnel" >&2
         echo "         is not in place — check: curl -4 -s -D- -o /dev/null https://play.tukuk.org/index.pck.zip?v=pck$HASH | grep -i cf-cache" >&2 ;;
  esac
fi

echo "published to $DEST:"
find "$DEST" -maxdepth 1 -type f -printf "%10s  %f\n" | sort -rn
