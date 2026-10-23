#!/usr/bin/env bash
# ==============================================================================
# backup-data.sh — copy Tukuk-OS runtime data (chat, leaderboard, publishes,
# comments, plays, stats) to Cloudflare R2 (bucket: tukuk-fallback).
#
# Run by the hourly timer (tukuk-data-backup.timer). ROTATING KEY:
# tukuk-data-<day><hour>.tar.gz (168 slots = a full 7 days) — writing to the
# same slot every week means NO delete API is needed; there are always 168
# recent copies without wasting space.
#
# USE:    BACKUP_WORKER_URL=... BACKUP_UPLOAD_SECRET=... bash scripts/backup-data.sh
#         (old fallback: CLOUDFLARE_API_TOKEN + wrangler — the VPS token has no
#         R2 scope, so the worker path is the primary path)
# RESTORE: bash scripts/restore-data.sh [key]   (empty key → current-hour slot)
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tukuk-fallback}"
DATA_DIR="${DATA_DIR:-data}"
WURL="${BACKUP_WORKER_URL:-}"
WSEC="${BACKUP_UPLOAD_SECRET:-}"
if [[ -z "$WURL" || -z "$WSEC" ]]; then
  # no worker path → try wrangler (only works if the token has R2:Edit)
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "[backup] no BACKUP_WORKER_URL/SECRET & no R2 token — skip."; exit 0; }
fi
[[ -d "$DATA_DIR" ]] || { echo "[backup] $DATA_DIR missing — skip."; exit 0; }

KEY="backups/tukuk-data-$(date -u +%u%H).tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[backup] packing tar $DATA_DIR → $TMP/data.tar.gz ..."
tar czf "$TMP/data.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"; TARRC=$?
# exit 1 = "file changed as we read it": data/ is written live by the app; the
# archive is still valid (that one member may be one flush stale). Only ≥2 is fatal.
if [[ $TARRC -ge 2 ]]; then
  echo "[backup] ERROR: tar failed (rc=$TARRC)" >&2; exit 1
elif [[ $TARRC -eq 1 ]]; then
  echo "[backup] WARN: a file changed mid-read (live writes) — continuing with usable archive" >&2
fi
SIZE="$(du -h "$TMP/data.tar.gz" | cut -f1)"

echo "[backup] sending $KEY ($SIZE) to R2 ..."
if [[ -n "$WURL" && -n "$WSEC" ]]; then
  if curl -fsS --max-time 120 -X POST -H "Authorization: Bearer $WSEC" \
       -H "x-content-type: application/gzip" --data-binary "@$TMP/data.tar.gz" \
       "$WURL/?key=$KEY" >/dev/null; then
    echo "[backup] ✓ $KEY ($SIZE) — $(date -u +%FT%TZ) [worker]"
    exit 0
  fi
  echo "[backup] ERROR: worker post failed" >&2; exit 1
fi
if npx --yes wrangler r2 object put "$BUCKET/$KEY" --file "$TMP/data.tar.gz" --remote >/dev/null 2>&1; then
  echo "[backup] ✓ $KEY ($SIZE) — $(date -u +%FT%TZ) [wrangler]"
else
  echo "[backup] ERROR: failed to send to R2" >&2; exit 1
fi
