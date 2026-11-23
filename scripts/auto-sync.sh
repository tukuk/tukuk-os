#!/usr/bin/env bash
# ---------------------------------------------------------------
# scripts/auto-sync.sh — Auto-sync tukuk-os dari GitHub ke server
#
# Fungsi:
#   1. git pull origin main
#   2. Jika ada perubahan, restart systemd service tukuk-os
#   3. Log semua aktiviti ke /var/log/tukuk-os/auto-sync.log
#
# Cara guna:
#   - Tambah ke crontab: * * * * * /opt/tukuk-os/scripts/auto-sync.sh
#   - Atau jalankan manual: bash scripts/auto-sync.sh
# ---------------------------------------------------------------
set -euo pipefail

REPO_DIR="/opt/tukuk-os"
LOG_DIR="/var/log/tukuk-os"
LOG_FILE="$LOG_DIR/auto-sync.log"
BRANCH="main"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR" || { log "ERROR: tidak dapat masuk ke $REPO_DIR"; exit 1; }

# Pastikan kita pada branch betul
git checkout "$BRANCH" >> "$LOG_FILE" 2>&1 || { log "ERROR: gagal checkout $BRANCH"; exit 1; }

# Ambil latest dari remote
git fetch origin >> "$LOG_FILE" 2>&1 || { log "ERROR: gagal fetch"; exit 1; }

# Bandingkan commit tempatan dengan remote
LOCAL=$(git rev-parse "$BRANCH")
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Sudah terkini ($LOCAL). Tiada sync diperlukan."
  exit 0
fi

log "Dapati perubahan: $LOCAL -> $REMOTE. Memulakan git pull..."
git pull origin "$BRANCH" >> "$LOG_FILE" 2>&1 || { log "ERROR: gagal git pull"; exit 1; }

log "Pull berjaya. Restart service tukuk-os..."

# Restart service jika wujud
if systemctl list-unit-files | grep -q "^tukuk-os.service"; then
  sudo systemctl restart tukuk-os >> "$LOG_FILE" 2>&1 && log "Service tukuk-os di-restart."
else
  log "PERINGATAN: systemd service tukuk-os tidak wujud. Restart secara manual diperlukan."
fi

log "Selesai."