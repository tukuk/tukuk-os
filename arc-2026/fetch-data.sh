#!/usr/bin/env bash
# ==============================================================================
# fetch-data.sh — download the PUBLIC ARC task data (no account needed).
#
#   bash arc-2026/fetch-data.sh            # ARC-AGI-2 (evaluation + training)
#   bash arc-2026/fetch-data.sh arc1       # ARC-AGI-1 (legacy comparison)
#
# What lands where (all gitignored — these are third-party datasets):
#   arc-2026/data/ARC-AGI-2/data/evaluation/*.json   120 tasks (the scored split)
#   arc-2026/data/ARC-AGI-2/data/training/*.json    1000 tasks (dev only)
#
# LICENCE / RULES: the ARC data is published by the ARC Prize Foundation for
# research. It is NOT redistributed from this repo — every clone fetches its own
# copy, so the licence and attribution stay with the source.
#
# The Kaggle competition data (arc-agi_test_challenges.json etc.) is attached to the
# notebook automatically at /kaggle/input/…; this script is for local work.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")"

SUITE="${1:-arc2}"
DEST="data"

command -v git >/dev/null 2>&1 || { echo "✗ git is required"; exit 1; }
mkdir -p "$DEST"

clone() { # clone <url> <dir>
  if [ -d "$2/.git" ]; then
    echo "… $2 already cloned — refreshing"
    git -C "$2" fetch --depth 1 origin >/dev/null 2>&1 && git -C "$2" reset --hard origin/HEAD >/dev/null 2>&1
  else
    echo "── cloning $1"
    git clone --depth 1 "$1" "$2" || { echo "✗ clone failed: $1"; return 1; }
  fi
}

case "$SUITE" in
  arc2)
    clone https://github.com/arcprize/ARC-AGI-2.git "$DEST/ARC-AGI-2" || exit 1
    ROOT="$DEST/ARC-AGI-2/data"
    ;;
  arc1)
    clone https://github.com/fchollet/ARC-AGI.git "$DEST/ARC-AGI" || exit 1
    ROOT="$DEST/ARC-AGI/data"
    ;;
  *)
    echo "✗ unknown suite '$SUITE' (arc2|arc1)"; exit 1 ;;
esac

for split in training evaluation; do
  n="$(find "$ROOT/$split" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${n:-0}" -gt 0 ]; then
    echo "✓ $split: $n task(s) in $ROOT/$split"
  else
    echo "⚠ $split: no JSON found under $ROOT/$split (the upstream layout may have changed)"
  fi
done

cat <<EOF

Next:
  cd arc-2026
  python3 -m unittest discover -s tests -v
  python3 -m arc.evaluate --dir $ROOT/evaluation --limit 20 --time-budget 3
  python3 -m arc.evaluate --dir $ROOT/evaluation --out results/eval-arc2.json

The --out file is a MEASURED result (pass@1 / pass@2 / per-task time). Quote it in
the paper; never type a number by hand.
EOF
