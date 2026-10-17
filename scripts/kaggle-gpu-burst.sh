#!/usr/bin/env bash
# ==============================================================================
# kaggle-gpu-burst.sh — Pinjam GPU percuma Kaggle (30 jam/minggu) untuk kerja
# batch pelayan yang tak muat di CPU: sekali-sekala, tanpa sebarang bayaran.
#
#   bash scripts/kaggle-gpu-burst.sh smoke                 # job demo (GPU check)
#   KAGGLE_ID=<username-kaggle> bash scripts/kaggle-gpu-burst.sh <nama-job>
#
# PRASYARAT SEKALI SAHAJA (perlu log masuk web Kaggle — penulis tak boleh auto):
#   1. Pelayan: kaggle auth login   (atau letak kaggle.json lama di ~/.kaggle/)
#   2. Ganti KAGGLE_ID / hantar KAGGLE_ID=<username-kaggle> ketika memanggil.
#
# Cara kerja (ikut ToS — guna API kernel rasmi, bukan haraman browser):
#   [1] kaggle-jobs/<job>.py dihantar sebagai kernel GPU (kernels push)
#   [2] status dipoll sehingga "Complete" (atau timeout)
#   [3] output kernel dimuat turun → /opt/tukuk-os/generated/gpu/<job>-<ts>/
#   Mana-mana fail .litertlm/.gguf/.bin dalam output boleh diimport dengan
#   scripts/import-trained-model.sh.
#
# HAD: 1 kernel pada satu masa; jangan hantar data sulit (repo ini private;
# korpus tukuk-brain JANGAN di-push sebagai dataset ke Kaggle).
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

KAGGLE_ID="${KAGGLE_ID:-REPLACE-WITH-USERNAME}"   # username Kaggle sahaja
POLL_MAX_MIN="${POLL_MAX_MIN:-45}"     # gemma kecil/fit biasa siap <30 min
OUT_ROOT="/opt/tukuk-os/generated/gpu"
JOB="${1:-smoke}"

command -v kaggle >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
command -v kaggle >/dev/null 2>&1 || { echo "✗ kaggle CLI tiada (uv tool install kaggle)."; exit 1; }
[ -f "$HOME/.kaggle/kaggle.json" ] || [ -f "$HOME/.kaggle/credentials.json" ] || { echo "✗ tiada kaggle.json mahupun credentials.json di ~/.kaggle — jalankan: kaggle auth login"; exit 1; }
SRC="kaggle-jobs/${JOB}.py"
[ -f "$SRC" ] || { echo "✗ job '$JOB' tiada — sedia ada: $(ls kaggle-jobs/*.py | xargs -n1 basename | sed 's/\.py//' | tr '\n' ' ')"; exit 1; }
case "$KAGGLE_ID" in *REPLACE*) echo "✗ hantar KAGGLE_ID=<username-kaggle> (contoh: KAGGLE_ID=fevian448)"; exit 1;; esac

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# API kernel hanya hormat GPU utk kernel_type=notebook (pembuktian komuniti
# Ogo 2026; script .py didiamkan sahaja ke CPU) — jadi balut .py jadi .ipynb.
python3 - "$SRC" "$TMP/kernel.ipynb" <<'PY'
import json, sys
src = open(sys.argv[1], encoding="utf-8").read()
nb = {
  "cells": [{"cell_type": "code", "source": src.splitlines(keepends=True),
             "metadata": {}, "outputs": [], "execution_count": None}],
  "metadata": {"accelerator": "nvidiaTeslaT4",
               "kaggle": {"accelerator": "nvidiaTeslaT4", "isGpuEnabled": True,
                           "isInternetEnabled": True, "language": "python",
                           "sourceType": "script", "dataSources": []}},
  "nbformat": 4, "nbformat_minor": 5,
}
json.dump(nb, open(sys.argv[2], "w", encoding="utf-8"))
PY
TITLE="tukuk-gpu-burst-${JOB}-$(date +%s)"
SLUG="${KAGGLE_ID}/${TITLE}"
cat > "$TMP/kernel-metadata.json" <<EOF
{
  "id": "${SLUG}",
  "title": "${TITLE}",
  "code_file": "kernel.ipynb",
  "language": "python",
  "kernel_type": "notebook",
  "is_private": true,
  "enable_gpu": true,
  "machine_shape": "NvidiaTeslaT4",
  "enable_internet": true,
  "dataset_sources": [],
  "competition_sources": [],
  "kernel_sources": []
}
EOF

echo "── [1] push kernel '$JOB' (GPU) ──"
( cd "$TMP" && kaggle kernels push --accelerator NvidiaTeslaT4 ) || { echo "✗ push gagal — semak kredit/kaggle.json."; exit 1; }
echo "✓ dihantar: $SLUG"

echo "── [2] poll sehingga siap (maks ${POLL_MAX_MIN} min) ──"
DEADLINE=$(( $(date +%s) + POLL_MAX_MIN * 60 ))
while :; do
  ST="$(kaggle kernels status "$SLUG" 2>/dev/null || echo '?')"
  echo "   $(date +%H:%M:%S) $ST"
  case "$ST" in *COMPLETE*) break;; *FAILED*|*ERROR*) echo "✗ kernel gagal — log: kaggle kernels output $SLUG"; exit 1;; esac
  [ "$(date +%s)" -lt "$DEADLINE" ] || { echo "✗ timeout ${POLL_MAX_MIN} min — kernel mungkin masih beratur; semak kemudian: kaggle kernels status $SLUG"; exit 1; }
  sleep 30
done

echo "── [3] muat turun output ──"
DEST="$OUT_ROOT/${JOB}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
kaggle kernels output "$SLUG" -p "$DEST" || { echo "✗ muat turun gagal."; exit 1; }
echo "✓ output di $DEST:"
ls -la "$DEST" | tail -n +2
echo
echo "Import model terlatih (jika ada): sudo bash scripts/import-trained-model.sh <fail-dalam-DEST>"
