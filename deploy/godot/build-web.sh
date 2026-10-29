#!/bin/bash
# Build the Station Break (Tukuk Strike HD) Godot Web export on the VPS.
#
# LIVES IN THIS REPO ON PURPOSE. It ran from ~/station-break/tools/ on the server, which
# is not backed up anywhere: a wiped box used to take the only copy of the flagship game's
# build logic with it. The game source is a separate private repo (fevian448/station-break);
# the builder belongs to the platform that has to rebuild it.
#
# Paths are overridable so a rebuilt machine can point it anywhere:
#   STATION_BREAK_DIR (default ~/station-break)   GODOT_BIN (default ~/bin/godot)
#   WEB_BUILD_LOG     (default ~/web-latest.log)
#
# Two things this script exists for:
#
# 1. SIZE. The Web preset ships with export_filter="all_resources", which packs
#    EVERY imported resource -- including the 97 MB level.exr texture array that
#    no scene references, plus the upstream demo/Unity/Unreal folders and the two
#    dev-only addons. That gave a 595 MB index.pck, above Cloudflare's 512 MB
#    per-file CDN cache limit on the Free plan: an uncached 595 MB file means
#    every visitor streams it through the argo tunnel from the VPS. Excluding the
#    unreferenced paths keeps every texture at full resolution and lands the pack
#    at ~478 MB, which the CDN can hold.
#    Verified unreferenced from game code: demo/, Godot/, Unity/, "Unreal
#    Engine/", screenshots/, test/, docs/, level/level.exr, and all of addons/
#    (godot_ai = MCP editor tooling, terrain_3d = unused GDExtension whose
#    missing .so threw load errors on every boot).
#
# 2. THE BOOT SCREEN. Godot's stock shell fills <progress id="status-progress">
#    with no numbers, so on a pack this size a working download looks like a hung
#    page. web-head.html adds a byte readout. Godot 4.7 IGNORES the
#    html/head_include preset option entirely (no error, nothing injected --
#    verified against a scratch project), so the fragment is spliced into a copy
#    of the engine's own template and handed to html/custom_html_shell instead.
#    The shell is regenerated from the installed export templates on every build,
#    so it can never drift behind the engine.
#    The overlay resolves in this order: $WEB_HEAD, then <project>/web-head.html
#    (a box-local copy still wins while it is being iterated on), then the copy
#    committed next to this script. That last fallback is what makes a rebuilt box
#    able to produce the real shell: the overlay was authored on the server and
#    never committed to the game repo, so without it a rebuild would only ever
#    ship a progress bar with no numbers.
#
# 3. THE ENGINE JS IS PATCHED, NOT PADDED. Three fixes are applied to the exported
#    index.js below, both anchored on exact bytes from the 4.7 nothreads template
#    and both hard-failing the build if an anchor does not appear exactly once --
#    an anchor that moves is an engine change, and shipping blind is how the audio
#    fix ended up hand-edited into /var/www only, where the next build erased it.
#
# 4. THE DOWNLOAD GATE. The pack is ~500 MB. The shell calls engine.startGame()
#    while it parses, so a stray link, a crawler or a second tab spends a visitor's
#    data allowance before they see anything. web-head.html supplies tukukGate(),
#    and the line the shell uses to build the engine is rewritten to route the
#    start through a press. Fails open: if the overlay cannot be built, the game
#    starts exactly as it used to.
#
# Usage (as the tukuk user on the VPS; the builder runs from this repo's checkout):
#   /opt/tukuk-os/deploy/godot/build-web.sh              # build only
#   /opt/tukuk-os/deploy/godot/build-web.sh --deploy     # build, then publish via sudo
#
# --deploy shells out to publish-tukuk-play under sudo, so run it where sudo works (or
# from a detached session, which is what the NOPASSWD sudoers entry is for).
set -euo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)"
PROJ="${STATION_BREAK_DIR:-$HOME/station-break}"
GODOT="${GODOT_BIN:-$HOME/bin/godot}"
PRESET_FILE="$PROJ/export_presets.cfg"
LOG="${WEB_BUILD_LOG:-$HOME/web-latest.log}"

# `*/x/*` because Godot matches the pattern against "res://" paths, where the
# first wildcard has to absorb the "res:/" prefix.
EXCLUDES='*/demo/*,*/Unity/*,*/Unreal Engine/*,*/Godot/*,*/screenshots/*,*/test/*,*/docs/*,*/addons/*,*/level/level.exr'

deploy=0
[ "${1:-}" = "--deploy" ] && deploy=1

[ -x "$GODOT" ] || { echo "FATAL: godot not at $GODOT" >&2; exit 1; }
cd "$PROJ"

VER=$("$GODOT" --version 2>/dev/null | tail -1)
TPL_DIR="$HOME/.local/share/godot/export_templates/${VER%.official*}"
# thread_support=false -> the nothreads template is the one the exporter uses.
TPL_ZIP="$TPL_DIR/web_nothreads_release.zip"
[ -f "$TPL_ZIP" ] || { echo "FATAL: export template missing at $TPL_ZIP" >&2; exit 1; }

# Rewrite only [preset.0] / [preset.0.options]; the Linux preset stays byte-identical.
python3 - "$PRESET_FILE" "$EXCLUDES" <<'PY'
import sys
path, excludes = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
head = (
    '[preset.0]\n\n'
    'name="Web"\n'
    'platform="Web"\n'
    'runnable=true\n'
    'export_filter="all_resources"\n'
    'include_filter=""\n'
    'exclude_filter="%s"\n'
    'export_path="web-build/index.html"\n'
    '\n'
    '[preset.0.options]\n\n'
    'variant/extensions_support=false\n'
    'variant/thread_support=false\n'
    'html/custom_html_shell="res://web-shell.html"\n'
    '\n'
) % excludes
start = text.index('[preset.0]')
end = text.index('[preset.1]')
open(path, 'w', encoding='utf-8').write(text[:start] + head + text[end:])
print('preset.0 rewritten; exclude_filter=%s' % excludes)
PY

# Splice the boot overlay into a fresh copy of the engine's HTML template.
if [ -z "${WEB_HEAD:-}" ]; then
  for cand in "$PROJ/web-head.html" "$SELF/web-head.html"; do
    if [ -f "$cand" ]; then WEB_HEAD="$cand"; break; fi
  done
fi
[ -n "${WEB_HEAD:-}" ] && [ -f "$WEB_HEAD" ] \
  || { echo "FATAL: no boot overlay found (checked \$WEB_HEAD, $PROJ/web-head.html, $SELF/web-head.html)." >&2; exit 1; }
echo "overlay: $WEB_HEAD"
# The engine template goes to a per-run temp file, never a fixed /tmp path: the builder
# runs both as root (a detached --deploy) and as the game user, and a second run used to
# die on EACCES over the first run's leftover file -- same collision that broke the test.
SHELL_TPL="$(mktemp "${TMPDIR:-/tmp}/godot-shell.XXXXXX")"
trap 'rm -f "$SHELL_TPL"' EXIT
unzip -p "$TPL_ZIP" godot.html > "$SHELL_TPL"
python3 - "$WEB_HEAD" "$SHELL_TPL" <<'PY'
import sys
template = open(sys.argv[2], encoding='utf-8').read()
fragment = open(sys.argv[1], encoding='utf-8').read()
marker = '$GODOT_HEAD_INCLUDE'
if marker not in template:
    raise SystemExit('FATAL: %s is no longer in the engine template -- '
                     'update web-head.html handling before shipping a blind shell.' % marker)
open('web-shell.html', 'w', encoding='utf-8').write(template.replace(marker, fragment))
print('web-shell.html generated')
PY

echo "== exporting (log: $LOG) =="
# stdin from /dev/null: a backgrounded Godot run otherwise stops on SIGTTIN.
set +e
"$GODOT" --headless --path "$PROJ" --export-release "Web" "web-build/index.html" >"$LOG" 2>&1 </dev/null
rc=$?
set -e
echo "EXPORT-rc=$rc"
# No exclusions here. "Unrecognized UID" used to be filtered out because it was a known
dangling reference; a build log that hides the one error class the exporter is most
counter-intuitive about is how a broken bus layout shipped twice.
grep -E "ERROR|Cannot export" "$LOG" | head -5 || true
[ "$rc" -eq 0 ] || { tail -20 "$LOG"; exit 1; }

pck=$(stat -c %s "$PROJ/web-build/index.pck")
awk -v b="$pck" 'BEGIN { printf "index.pck = %.1f MB (%s bytes) -- Cloudflare Free caches files up to 512 MB\n", b/1048576, b }'
if [ "$pck" -gt 536870912 ]; then
  echo "WARN: pck above the 512 MB CDN cache limit; visitors stream it from origin." >&2
fi
# A shell that silently fell back to the stock template would ship no readout.
grep -q "tb-bytes" "$PROJ/web-build/index.html" \
  || { echo "FATAL: overlay missing from index.html -- custom shell was not used." >&2; exit 1; }
grep -q '"index.pck":'"$pck" "$PROJ/web-build/index.html" \
  || echo "WARN: shell fileSizes do not match the packed pck; rebuild the shell." >&2

# ── patch the exported engine js ─────────────────────────────────────────────────
# Godot defers GodotAudio.initialize() until a user gesture (browser autoplay policy),
# and sampleNodes is declared `null` until then -- but the WASM bindings happily call
# into it on the very first frame, when a sample stops during teardown, or when audio
# never starts at all. Each unguarded read threw a TypeError straight into the engine.
# This is the fix that used to live only in /var/www/tukuk-play/index.js, applied by
# hand, and silently vanished on the next publish.
echo "== patching the exported engine js =="
python3 - "$PROJ/web-build/index.js" <<'PY'
import sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
PATCHES = [
    ('if(!GodotAudio.sampleNodes.has(id)){',
     'if(!GodotAudio.sampleNodes?.has(id)){',
     'getSampleNode must raise its own ReferenceError, not a TypeError'),
    ('static getSampleNodeOrNull(id){return GodotAudio.sampleNodes.get(id)??null}',
     'static getSampleNodeOrNull(id){return GodotAudio.sampleNodes?.get(id)??null}',
     'stop/pause of a sample before audio init crashed'),
    ('return Number(GodotAudio.sampleNodes.has(playbackObjectId))',
     'return Number(GodotAudio.sampleNodes?.has(playbackObjectId))',
     'the exists-binding is the first call WASM makes, and it crashed pre-init'),
]
bad = []
for old, new, why in PATCHES:
    n = src.count(old)
    if n == 1:
        src = src.replace(old, new)
        print('patched: %s' % why)
    elif n == 0 and src.count(new) == 1:
        print('already applied: %s' % why)
    else:
        bad.append('%s (matched %d times, expected 1)' % (why, n))
if bad:
    raise SystemExit('FATAL: engine js anchors did not hold -- the template changed,\n  '
                     + '\n  '.join(bad)
                     + '\n  Refusing to ship: an unpatched build crashes on audio.')
open(path, 'w', encoding='utf-8').write(src)
PY

# ── route the boot through the press-to-download gate ────────────────────────────
echo "== gating the 500 MB download =="
python3 - "$PROJ/web-build/index.html" <<'PY'
import sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
anchor = 'const engine = new Engine(GODOT_CONFIG);'
wrapped = anchor + '\n\t\tif (window.tukukGate) { tukukGate(engine); }'
n = src.count(anchor)
if n == 1:
    open(path, 'w', encoding='utf-8').write(src.replace(anchor, wrapped))
    print('gate wired into the shell')
elif n == 0 and wrapped in src:
    print('gate already wired')
else:
    raise SystemExit('FATAL: `const engine = new Engine(GODOT_CONFIG);` matched %d times, '
                     'expected 1 -- the shell format changed, so the download would ship '
                     'ungated.' % n)
PY
# A gate whose helper did not make it into the shell would hang the game forever,
# because the call above is what starts it. Both halves or neither.
if ! grep -q 'window.tukukGate = function' "$PROJ/web-build/index.html"; then
  echo "FATAL: the gate call is in the shell but tukukGate() is not -- web-head.html is stale." >&2
  exit 1
fi

if [ "$deploy" = "1" ]; then
  echo "== publishing to /var/www/tukuk-play =="
  # Publish through the one root-owned script that /etc/sudoers.d/tukuk-play actually
  # grants. Copying the artifacts from here instead would fail on sudo authorization in
  # a detached build AND skip the index.pck.zip alias, so the pack would silently stop
  # being cached at the edge -- the failure mode this whole publish path exists to avoid.
  PUB="$(command -v publish-tukuk-play || true)"
  [ -n "$PUB" ] || PUB="/usr/local/sbin/publish-tukuk-play"
  [ -x "$PUB" ] || PUB="$SELF/publish-tukuk-play.sh"
  sudo "$PUB" "$PROJ/web-build"
fi
echo "BUILD-DONE"
