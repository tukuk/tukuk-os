#!/usr/bin/env bash
# wordbank-sync.sh — pull tukuk.org's first-party word bank off the public GitHub release and load
# it into Meilisearch (index `kata`).
#
# Direction of travel matters here: the expensive half (building the bank) runs free on GitHub's
# public runners in tukuk/tukuk-devops; this script only DOWNLOADS a finished file and LOADS it.
# That keeps the production box light, which is the whole point of the split.
#
# It verifies SHA256SUMS before loading anything. A truncated download on a home connection is not
# a build failure unless we make it one — so we make it one.
#
# Reads env (from /opt/tukuk-os/.env on the server): MEILI_HOST, MEILI_MASTER_KEY.
set -euo pipefail

REPO="${WORDBANK_REPO:-tukuk/tukuk-devops}"
TAG="${WORDBANK_TAG:-wordbank-latest}"
DEST="${WORDBANK_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data/wordbank}"
BASE="https://github.com/${REPO}/releases/download/${TAG}"
NODE="${NODE:-node}"

mkdir -p "$DEST"
cd "$DEST"

echo "[wordbank] downloading checksums + manifest from ${BASE}"
curl -fsSL --retry 3 --max-time 60 -o SHA256SUMS "${BASE}/SHA256SUMS"
curl -fsSL --retry 3 --max-time 60 -o manifest.json "${BASE}/manifest.json"

# Download every data file the manifest declares, then verify the whole set. We trust manifest.json
# (not SHA256SUMS alone) for the file list because SHA256SUMS also names manifest.json itself.
mapfile -t FILES < <(python3 -c "import json;[print(f['file']) for f in json.load(open('manifest.json'))['files']]" 2>/dev/null \
  || grep -o '"file": *"[^"]*"' manifest.json | sed 's/.*: *"\(.*\)"/\1/')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "[wordbank] manifest lists no files — refusing to sync an empty bank" >&2
  exit 1
fi
for f in "${FILES[@]}"; do
  echo "[wordbank] fetch $f"
  curl -fsSL --retry 3 --max-time 180 -o "$f" "${BASE}/$f"
done

echo "[wordbank] verifying sha256"
# Verify ONLY the manifest-listed files here; SHA256SUMS was re-downloaded fresh so its own line
# cannot be checked against itself, but every data file is checked before it is trusted.
sha256sum -c --ignore-missing SHA256SUMS

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "${FILES[@]}"; do
  echo "[wordbank] loading $f into Meilisearch (kata)"
  "$NODE" "$ROOT/scripts/wordbank-load.js" "$DEST/$f"
done

echo "[wordbank] sync complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
