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
DEST=/var/www/tukuk-play

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
# is already published; reuse it instead of adding an asset.
cp -f "$DEST/index.icon.png" "$DEST/favicon.ico"
chmod a+r "$DEST/favicon.ico"

echo "published to $DEST:"
find "$DEST" -maxdepth 1 -type f -printf "%10s  %f\n" | sort -rn
