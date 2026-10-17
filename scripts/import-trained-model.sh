#!/usr/bin/env bash
# ==============================================================================
# import-trained-model.sh — Pasang fail model yang dilatih/dimuat turun di
# Kaggle/Colab ke dalam pelayan Tukuk-OS dengan selamat (sekali arahkan).
#
#   sudo bash scripts/import-trained-model.sh <path-fail> [ranks|edge|brain]
#
# Destinasi ikut jenis:
#   ranks → fine-tune/reranker (reranker Meilisearch/onnx) + restart tukuk-os
#   edge  → /home/tukuk/models + litert-lm import (tier pinggir LiteRT)
#   brain → data/tukuk-brain-v1.json (korpus AI) + rebuild index
#
# Sentiasa simpan salinan .prev di sisi fail asal untuk rollback mudah.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

SRC="${1:?guna: import-trained-model.sh <path-fail> [ranks|edge|brain]}"
KIND="${2:-}"
[ -f "$SRC" ] || { echo "✗ fail tiada: $SRC"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "perlukan root: sudo bash $0 ..."; exit 1; }

if [ -z "$KIND" ]; then
  case "$SRC" in
    *.onnx|*rerank*) KIND=ranks ;;
    *.litertlm|*.gguf) KIND=edge ;;
    *brain*.json) KIND=brain ;;
    *) echo "✗ tak dapat jangkakan jenis — beri argumen kedua: ranks|edge|brain"; exit 1 ;;
  esac
  echo "… jenis dikesan automatik: $KIND"
fi

case "$KIND" in
  ranks)
    DEST="fine-tune/reranker/$(basename "$SRC")"
    [ -f "$DEST" ] && cp -f "$DEST" "$DEST.prev"
    install -m 0644 "$SRC" "$DEST"
    systemctl restart tukuk-os && sleep 3 && systemctl is-active tukuk-os
    echo "✓ $DEST dipasang; tukuk-os direstart. Rollback: mv $DEST.prev $DEST && restart."
    ;;
  edge)
    DEST="/home/tukuk/models/$(basename "$SRC")"
    [ -f "$DEST" ] && cp -f "$DEST" "$DEST.prev"
    install -m 0644 -o tukuk -g tukuk "$SRC" "$DEST"
    sudo -u tukuk env HOME=/home/tukuk /home/tukuk/.local/bin/litert-lm import "$DEST" || exit 1
    systemctl restart litert-lm 2>/dev/null || true
    echo "✓ $DEST diimport ke registry LiteRT (senarai: litert-lm list)."
    ;;
  brain)
    [ -f data/tukuk-brain-v1.json ] && cp -f data/tukuk-brain-v1.json data/tukuk-brain-v1.json.prev
    install -m 0644 "$SRC" data/tukuk-brain-v1.json
    sudo -u tukuk env HOME=/home/tukuk node scripts/train-brain.js || echo "⚠ train-brain gagal — jalankan manual."
    systemctl restart tukuk-os && sleep 3 && systemctl is-active tukuk-os
    echo "✓ korpus brain dinaik taraf + index dibina semula."
    ;;
  *) echo "✗ jenis tak diketahui: $KIND (ranks|edge|brain)"; exit 1 ;;
esac
