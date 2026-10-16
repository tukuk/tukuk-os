#!/usr/bin/env bash
# ==============================================================================
# auto-update.sh — Kemas kini TEPENUH satu baris: git → (npm) → restart servis.
#
#   npm run update            (manual, di server; perlu root)
#   tukuk-update.timer        (harian, automatik — dipasang setup-all.sh)
#
# Rantaian CERDIK (elak beban + hang pada VPS perlahan):
#   git fetch + merge --ff-only → kalau TIADA commit baharu: keluar serta-merta.
#   kalau ada: `npm install` HANYA bila package.json/package-lock berubah
#   (satu-kata/kod/README tak sentuh dependensi → langkau muat turun native berat
#   seperti onnxruntime yang boleh menggantung), kemudian `systemctl restart
#   tukuk-os` supaya kod baru dimuat. Unit systemd & tunnel sudah dipasang
#   setup-all.sh, jadi tak perlu rantaian postinstall penuh setiap hari.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

INSTALL_DIR="/opt/tukuk-os"
if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
  echo "[auto-update] hanya direka berjalan di $INSTALL_DIR (kini di $(pwd)) — langkau."
  exit 0
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "[auto-update] perlu root:  sudo bash scripts/auto-update.sh"
  exit 1
fi

BRANCH="$(grep -E '^GIT_BRANCH=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
BRANCH="${BRANCH:-main}"

# Model AI milik sendiri (Tukuk-Brain Mini): latih semula daripada log
# produksi terkini. Gagal LEMBUT — taskrouter kekal regex-only jika tiada fail.
train_brain() {
  if node scripts/train-brain.js >/tmp/train-brain.log 2>&1; then
    grep -E 'probe luar|simpan' /tmp/train-brain.log | sed 's/^/[auto-update] /'
  else
    echo "[auto-update] amaran: train-brain gagal — model lama/regex-only terus."
  fi
}

echo "[auto-update] $(date -Is) — tarik origin/$BRANCH ..."
OLD="$(git rev-parse HEAD)"
git fetch origin "$BRANCH" || { echo "[auto-update] git fetch gagal (jaringan?) — langkau kitaran ini."; exit 0; }
if ! git merge --ff-only "origin/$BRANCH"; then
  echo "[auto-update] working tree berubah/diverged — tiada auto-merge demi keselamatan. Semak: git status"
  exit 0
fi
NEW="$(git rev-parse HEAD)"

if [[ "$OLD" == "$NEW" ]]; then
  echo "[auto-update] tiada kemas kini baharu (pada $OLD) — langkau npm & restart."
  # Tetap LATIH model otak — log produksi (tanya/cari) makin banyak hari ini.
  train_brain
  exit 0
fi
echo "[auto-update] kemas kini $OLD → $NEW."

# HANYA install semula bila dependensi benar-benar berubah. Ini elak `npm install`
# harian menarik balik binary native berat (onnxruntime ~300MB) yang boleh HANG
# pada rangkaian perlahan, dan elak pemuatan balik yang tak perlu.
if git diff --quiet "$OLD" "$NEW" -- package.json package-lock.json; then
  echo "[auto-update] package.json/lock tak berubah — langkau npm install."
else
  echo "[auto-update] dependensi berubah → npm install --omit=dev ..."
  npm install --omit=dev || echo "[auto-update] AMARAN: npm install gagal (code $?) — teruskan ke restart."
fi

# Kod sumber mungkin berubah → restart supaya proses muat logik baru (Express
# route dalam memori, mount statik, indeks blog). Unit/tunnel sudah sedia ada.
# Latih model DULU — restart pertama sekali membawa otak + fail model terbaru.
train_brain
echo "[auto-update] restart tukuk-os ..."
systemctl restart tukuk-os

echo "[auto-update] $(date -Is) — selesai. Tukuk-OS kini pada commit: $(git rev-parse --short HEAD)"
