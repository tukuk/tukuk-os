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
# machine that has no /opt/tukuk-os yet -- and so that testing it does not overwrite a live
# game. The default is inside the ONE folder (deploy/paths.sh): this script is installed at
# /usr/local/sbin, where it cannot source that file, so the value is spelled out here and
# kept in step with TUKUK_PLAY_DIR by test/server-layout.test.js.
DEST="${TUKUK_PLAY_DIR:-/opt/tukuk-os/apps/play}"

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

# The service worker lives in this repo, not in the Godot project: it caches the
# hash-versioned artifacts into persistent Cache Storage so a returning visitor
# never re-pulls 500 MB when the browser's HTTP cache has already evicted it.
# Installed next to the shell it controls; web-head.html registers '/sw.js'.
# Searched in more than one place on purpose: this script normally runs as the
# root-owned /usr/local/sbin/publish-tukuk-play, where the repo file is NOT a
# neighbour, so a sibling-only lookup would warn on every real publish.
SW_SRC=''
for cand in "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sw.js" \
            "$PWD/deploy/godot/sw.js" \
            /opt/tukuk-os/deploy/godot/sw.js; do
  if [ -f "$cand" ]; then SW_SRC="$cand"; break; fi
done
if [ -n "$SW_SRC" ]; then
  install -m 0644 "$SW_SRC" "$DEST/sw.js"
  echo "worker: installed $SW_SRC -> $DEST/sw.js"
else
  echo "WARN: sw.js found nowhere (checked beside this script, ./deploy/godot, /opt/tukuk-os/deploy/godot)."
  echo "      Players will re-download the pack whenever the browser evicts its HTTP cache." >&2
fi

# Cloudflare Free caches by URL EXTENSION and refuses files over 512 MB. The engine
# names its pack `index.pck` and its binary `index.wasm`, which are on both counts:
# neither extension is in the default cacheable list (measured -- .pck and .wasm answer
# DYNAMIC whatever Cache-Control says, while .zip goes MISS then HIT), and the pack is
# ~478 MB of a 512 MB ceiling. So both heavy artifacts are also published under a `.zip`
# name -- byte-identical, and a Godot pack is a container anyway -- and the shell is
# rewritten to dial those names with a content hash in the query string. The hash is what
# lets a new build replace a year-cached immutable URL.
#
# index.js gets the same treatment one level down: it is where the wasm and the two audio
# worklets are requested, so its own URL is versioned by ITS hash, computed after it has
# been rewritten (it carries no hash of itself, so that is not circular).
PACK_LIMIT=536870912   # 512 MB
pck_size=$(stat -c %s "$DEST/index.pck")
if [ "$pck_size" -gt "$PACK_LIMIT" ] && [ "${ALLOW_BIG_PACK:-0}" != "1" ]; then
  echo "FATAL: index.pck is $pck_size bytes, above the 512 MB CDN cache limit." >&2
  echo "       Every visitor would stream the pack from origin through the tunnel." >&2
  echo "       Fix the export_filter in the Web preset (see deploy/godot/build-web.sh), or set ALLOW_BIG_PACK=1." >&2
  exit 3
fi
[ -f "$DEST/index.js" ] || { echo "FATAL: $DEST/index.js missing -- not a 4.x web export" >&2; exit 2; }

PCK_HASH=$(sha256sum "$DEST/index.pck" | cut -c1-12)
WASM_HASH=$(sha256sum "$DEST/index.wasm" | cut -c1-12)
cp -f "$DEST/index.pck" "$DEST/index.pck.zip"
cp -f "$DEST/index.wasm" "$DEST/index.wasm.zip"
chmod a+r "$DEST/index.pck.zip" "$DEST/index.wasm.zip"

cp -f "$DEST/index.html" "$DEST/index.html.pre-alias.bak"
cp -f "$DEST/index.js" "$DEST/index.js.pre-alias.bak"

# Half a rewrite is worse than none: the shell would ask the engine for a URL the engine
# does not fetch, or the reverse. Any exit before ALIASED=1 puts the document root back
# the way it was found, aliases included.
ALIASED=0
restore_alias() {
  [ "$ALIASED" = "1" ] && return 0
  [ -f "$DEST/index.html.pre-alias.bak" ] && mv -f "$DEST/index.html.pre-alias.bak" "$DEST/index.html"
  [ -f "$DEST/index.js.pre-alias.bak" ] && mv -f "$DEST/index.js.pre-alias.bak" "$DEST/index.js"
  rm -f "$DEST/index.pck.zip" "$DEST/index.wasm.zip"
}
trap restore_alias EXIT

# Step 1: the engine js asks for the aliased wasm and versioned worklets.
python3 - "$DEST" "$WASM_HASH" <<'PY'
import sys, os, hashlib
dest, wasm = sys.argv[1], sys.argv[2]
path = os.path.join(dest, 'index.js')
src = open(path, encoding='utf-8').read()

# (anchor, replacement, hard?) -- the wasm sites are hard: a silent miss costs every
# visitor 39 MB of origin egress and there is no other symptom.
WASM_URL = '`${loadPath}.wasm.zip?v=wasm%s`' % wasm
rules = [
    ('preloader.loadPromise(`${loadPath}.wasm`, size, true)',
     'preloader.loadPromise(%s, size, true)' % WASM_URL, True),
    ('return `${loadPath}.wasm`;', 'return %s;' % WASM_URL, True),
]
for name, key in (('index.audio.worklet.js', 'aw'), ('index.audio.position.worklet.js', 'ap')):
    if os.path.exists(os.path.join(dest, name)):
        with open(os.path.join(dest, name), 'rb') as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()[:12]
        # The engine asks for a worklet as `${loadPath}.audio.worklet.js`: the exported
        # file name with its executable prefix swapped for the variable. So the anchor is
        # the name MINUS its first component, not minus its extension.
        tail = '.'.join(name.split('.')[1:])
        rules.append(('return `${loadPath}.%s`;' % tail,
                      'return `${loadPath}.%s?v=%s%s`;' % (tail, key, digest), False))

missing = []
for old, new, hard in rules:
    n = src.count(old)
    if n == 1:
        src = src.replace(old, new)
    elif n == 0 and new in src:
        pass  # already rewritten (a re-publish of the same directory)
    elif hard:
        missing.append('%s (matched %d, expected 1)' % (old[:52], n))
if missing:
    raise SystemExit('FATAL: index.js anchors did not hold:\n  ' + '\n  '.join(missing))
open(path, 'w', encoding='utf-8').write(src)
print('index.js: wasm and worklet URLs aliased')
PY

# Step 2: the shell. Its own script tag is versioned with the hash of the file step 1
# just produced, so a rebuilt engine can never be paired with a week-old cached copy.
JS_HASH=$(sha256sum "$DEST/index.js" | cut -c1-12)
python3 - "$DEST" "$PCK_HASH" "$JS_HASH" <<'PY'
import sys, os, re
dest, pck, js = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(dest, 'index.html')
src = open(path, encoding='utf-8').read()
alias = 'index.pck.zip?v=pck%s' % pck

# 2a. every quoted reference to the bare pack, whichever quote style the shell uses.
src = re.sub(r'(["\'])index\.pck\1', lambda m: '%s%s%s' % (m.group(1), alias, m.group(1)), src)

# 2b. mainPack is the ONLY thing that decides which URL the engine fetches: without it
# Godot asks for `${exe}.pck` and streams 478 MB from origin while every grep in this
# script still passes, because the fileSizes key was renamed. A 4.7 export does not emit
# the key at all, so this insertion -- not the rename -- is the load-bearing half.
if '"mainPack"' not in src:
    key = '"fileSizes":{'
    if key not in src:
        raise SystemExit('FATAL: no mainPack reference could be written -- the shell has no '
                         '"fileSizes" block to hang it on; the engine format changed.')
    src = src.replace(key, '"mainPack":"%s",%s' % (alias, key), 1)

# 2c. the shell's own script tag, replacing any hand-written label left from before.
src, n = re.subn(r'src="index\.js(\?v=[^"]*)?"', 'src="index.js?v=js%s"' % js, src)
if n != 1:
    raise SystemExit('FATAL: the index.js script tag matched %d times, expected 1.' % n)
open(path, 'w', encoding='utf-8').write(src)
print('index.html: mainPack=%s, index.js?v=js%s' % (alias, js))
PY

# Serve-side proof the rewrites actually landed. Anything less and the pack or the wasm
# silently stops being cached, which is invisible until the tunnel is on fire.
if ! grep -q "index.pck.zip?v=pck$PCK_HASH" "$DEST/index.html" \
   || ! grep -q "\"mainPack\":\"index.pck.zip?v=pck$PCK_HASH\"" "$DEST/index.html" \
   || ! grep -q "src=\"index.js?v=js$JS_HASH\"" "$DEST/index.html" \
   || ! grep -q "\.wasm\.zip?v=wasm$WASM_HASH" "$DEST/index.js"; then
  mv -f "$DEST/index.html.pre-alias.bak" "$DEST/index.html"
  mv -f "$DEST/index.js.pre-alias.bak" "$DEST/index.js"
  rm -f "$DEST/index.pck.zip" "$DEST/index.wasm.zip"
  echo "FATAL: the alias rewrite did not land in the shell or the engine js -- the shell" >&2
  echo "       format changed. Refusing to publish, because an unaliased pack or binary" >&2
  echo "       means origin-streamed downloads for every player and no cache hit to measure." >&2
  exit 4
fi
rm -f "$DEST/index.html.pre-alias.bak" "$DEST/index.js.pre-alias.bak"
ALIASED=1

# The engine asks for the worklets by name; an unversioned one is only a stale-audio risk,
# not a bandwidth one, so it warns rather than aborts.
if [ -f "$DEST/index.audio.worklet.js" ] && ! grep -q 'audio.worklet.js?v=' "$DEST/index.js"; then
  echo "WARN: the audio worklet URL carries no version; a rebuilt worklet stays cached 7 days." >&2
fi

# Serve-side proof the alias actually answers, through the front on loopback with the
# game's Host header -- the same path the tunnel takes. SKIP_LOCAL_CHECK=1 for a dry run
# on a machine with no nginx in front yet (the style of test the file list above is for).
if [ "${SKIP_LOCAL_CHECK:-0}" != "1" ]; then
  curl -sS -o /dev/null -w "shell    %{http_code} %{content_type} %{size_download}B\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/index.html" || true
  # A 404 here means the worker never reached the root, so the registration
  # silently fails and every revisit is a fresh 500 MB download.
  curl -sS -o /dev/null -w "worker   %{http_code} %{content_type}\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/sw.js" || true
  curl -sS -o /dev/null -w "pack     %{http_code} %{size_download}B (want $pck_size)\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/index.pck.zip?v=pck$PCK_HASH" || true
  curl -sS -o /dev/null -w "binary   %{http_code} %{size_download}B (want $(stat -c %s "$DEST/index.wasm"))\n" \
       -H "Host: play.tukuk.org" "http://127.0.0.1:3000/index.wasm.zip?v=wasm$WASM_HASH" || true
fi

# The edge is the only place this counts. Two requests: MISS then HIT proves Cloudflare
# is holding the artifact, which is the entire reason the aliases exist.
if [ "${SKIP_EDGE_CHECK:-0}" != "1" ] && command -v curl >/dev/null; then
  for pair in "pack index.pck.zip?v=pck$PCK_HASH" "binary index.wasm.zip?v=wasm$WASM_HASH"; do
    label=${pair%% *}; url=${pair#* }
    a=$(curl -4 -s -D- -o /dev/null --max-time 120 "https://play.tukuk.org/$url" | grep -i '^cf-cache-status:' | tr -d '\r' | cut -d' ' -f2)
    b=$(curl -4 -s -D- -o /dev/null --max-time 300 "https://play.tukuk.org/$url" | grep -i '^cf-cache-status:' | tr -d '\r' | cut -d' ' -f2)
    echo "edge     $label 1st=${a:-none} 2nd=${b:-none}"
    case "$b" in
      HIT) echo "         $label is served by Cloudflare, not this box." ;;
      *)   echo "WARNING: 2nd $label request was not HIT (got ${b:-no header}). MISS the first" >&2
           echo "         time is normal; anything else means the alias, the extension rule or" >&2
           echo "         the tunnel is not in place -- check:" >&2
           echo "         curl -4 -s -D- -o /dev/null https://play.tukuk.org/$url | grep -i cf-cache" >&2 ;;
    esac
  done
fi

echo "published to $DEST:"
find "$DEST" -maxdepth 1 -type f -printf "%10s  %f\n" | sort -rn
