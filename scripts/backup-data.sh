#!/usr/bin/env bash
# ==============================================================================
# backup-data.sh — Salin data runtime Tukuk-OS (chat, leaderboard, terbitan,
# komen, plays, statistik) ke Cloudflare R2 (bucket: tukuk-fallback).
#
# Dijalankan oleh timer jam-jeran (tukuk-data-backup.timer). KUNCI berrotak:
# tukuk-data-<hari><jam>.tar.gz (168 slot = 7 hari penuh) — tulis ke slot yang
# sama setiap minggu bererti TIADA perlu API padam; sentiasa ada 168 salinan
# terbaru tanpa membazir ruang.
#
# GUNA:  CLOUDFLARE_API_TOKEN=... bash scripts/backup-data.sh
# PULIH: bash scripts/restore-data.sh [key]   (key kosong → slot jam semasa)
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tukuk-fallback}"
DATA_DIR="${DATA_DIR:-data}"
[[ -d "$DATA_DIR" ]] || { echo "[backup] $DATA_DIR tiada — skip."; exit 0; }
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "[backup] CLOUDFLARE_API_TOKEN tiada — skip."; exit 0; }

KEY="backups/tukuk-data-$(date -u +%u%H).tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[backup] memadam tar $DATA_DIR → $TMP/data.tar.gz ..."
if ! tar czf "$TMP/data.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"; then
  echo "[backup] RALAT: tar gagal" >&2; exit 1
fi
SIZE="$(du -h "$TMP/data.tar.gz" | cut -f1)"

echo "[backup] menghantar $KEY ($SIZE) ke R2 ..."
if npx --yes wrangler r2 object put "$BUCKET/$KEY" --file "$TMP/data.tar.gz" --remote >/dev/null 2>&1; then
  echo "[backup] ✓ $KEY ($SIZE) — $(date -u +%FT%TZ)"
else
  echo "[backup] RALAT: gagal hantar ke R2" >&2; exit 1
fi
