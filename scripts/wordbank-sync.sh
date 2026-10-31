#!/usr/bin/env bash
# wordbank-sync.sh — pull tukuk.org's first-party word bank off the public GitHub releases and load
# it into Meilisearch (index `kata`).
#
# Direction of travel matters here: the expensive half (building the bank) runs free on GitHub's
# public runners in tukuk/tukuk-devops; this script only DOWNLOADS finished files and LOADS them.
# That keeps the production box light, which is the whole point of the split.
#
# Two rolling releases feed the ONE kata index:
#   wordbank-latest   en  (WordNet,               wordbank-build.yml)
#   malaybank-latest  ms+id (raw wiktextract,     malaybank-build.yml)
# Every release is DOWNLOADED AND VERIFIED FIRST; only when all checksums pass do we load, and the
# load wipes exactly once (WORDBANK_FRESH=1 on the very first file, 0 on the rest). A failed
# download therefore leaves yesterday's index untouched, and a per-file wipe can never erase the
# language loaded before it.
#
# It verifies SHA256SUMS before loading anything. A truncated download on a home connection is not
# a build failure unless we make it one — so we make it one.
#
# Reads env (from /opt/tukuk-os/.env on the server): MEILI_HOST, MEILI_MASTER_KEY.
set -euo pipefail

REPO="${WORDBANK_REPO:-tukuk/tukuk-devops}"
# Space-separated rolling tags, in load order. The first file of the FIRST tag does the wipe.
TAGS="${WORDBANK_TAGS:-wordbank-latest malaybank-latest}"
DEST="${WORDBANK_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data/wordbank}"
NODE="${NODE:-node}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- phase 1: download + verify every release (index still untouched) ----
ALL_FILES=()
for TAG in $TAGS; do
  BASE="https://github.com/${REPO}/releases/download/${TAG}"
  DIR="$DEST/$TAG"
  mkdir -p "$DIR"
  cd "$DIR"
  echo "[wordbank] downloading checksums + manifest from ${BASE}"
  curl -fsSL --retry 3 --max-time 60 -o SHA256SUMS "${BASE}/SHA256SUMS"
  curl -fsSL --retry 3 --max-time 60 -o manifest.json "${BASE}/manifest.json"

  # Download every data file the manifest declares, then verify the whole set. We trust manifest.json
  # (not SHA256SUMS alone) for the file list because SHA256SUMS also names manifest.json itself.
  mapfile -t FILES < <(python3 -c "import json;[print(f['file']) for f in json.load(open('manifest.json'))['files']]" 2>/dev/null \
    || grep -o '"file": *"[^"]*"' manifest.json | sed 's/.*: *"\(.*\)"/\1/')
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "[wordbank] $TAG manifest lists no files — refusing to sync an empty bank" >&2
    exit 1
  fi
  for f in "${FILES[@]}"; do
    echo "[wordbank] fetch $TAG/$f"
    curl -fsSL --retry 3 --max-time 180 -o "$f" "${BASE}/$f"
  done

  echo "[wordbank] verifying sha256 for $TAG"
  # Verify ONLY the manifest-listed files here; SHA256SUMS was re-downloaded fresh so its own line
  # cannot be checked against itself, but every data file is checked before it is trusted.
  sha256sum -c --ignore-missing SHA256SUMS

  for f in "${FILES[@]}"; do
    ALL_FILES+=("$DIR/$f")
  done
done

# ---- phase 2: load everything into kata, wiping exactly once at the start ----
FRESH=1
for path in "${ALL_FILES[@]}"; do
  echo "[wordbank] loading $path into Meilisearch (kata, fresh=$FRESH)"
  WORDBANK_FRESH="$FRESH" "$NODE" "$ROOT/scripts/wordbank-load.js" "$path"
  FRESH=0
done

echo "[wordbank] sync complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
