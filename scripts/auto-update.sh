#!/usr/bin/env bash
# ==============================================================================
# auto-update.sh — Kemas kini TEPENUH satu baris: git → npm → servis → edge.
#
#   npm run update            (manual, di server)
#   tukuk-update.timer        (harian, automatik — dipasang setup-all.sh)
#
# Rantaian: git pull → npm install (postinstall → setup-all.sh: servis systemd,
# tunnel cloudflared, deploy worker www, snapshot R2) → servis sudah dijalankan
# semula oleh setup-all.sh. Tiada langkah manual.
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

echo "[auto-update] $(date -Is) — tarik origin/$BRANCH ..."
git fetch origin "$BRANCH" || { echo "[auto-update] git fetch gagal (jaringan?) — langkau kitaran ini."; exit 0; }
if ! git merge --ff-only "origin/$BRANCH"; then
  echo "[auto-update] working tree berubah/diverged — tiada auto-merge demi keselamatan. Semak: git status"
  exit 0
fi

echo "[auto-update] npm install → postinstall menjalankan setup-all.sh (servis, tunnel, worker, snapshot)..."
npm install --omit=dev

echo "[auto-update] $(date -Is) — selesai. Tukuk-OS kini pada commit: $(git rev-parse --short HEAD)"
