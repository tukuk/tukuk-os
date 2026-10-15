#!/usr/bin/env bash
# Backup data T Chat (data/chat.json + data/chat-media/) ke Cloudflare R2.
#
# Mengikut jejak backup-meili.sh — dua laluan, cukup satu:
#
#   1) WORKER (disyorkan, tiada kunci S3):
#        tar.gz snapshot -> POST ke worker tukuk-backup -> R2
#        PERLU: BACKUP_WORKER_URL + BACKUP_UPLOAD_SECRET
#
#   2) LOKAL SAHAJA (tiada creds worker):
#        simpan tar.gz di SNAP_DIR dengan pemangkasan KEEP_LOKAL — berguna bila
#        R2 belum dikonfigur, supaya data tidak berubah-ubah tiada salinan sama sekali.
#
# Semua nilai dalam ~/.config/tukuk-os/r2.env (EnvironmentFile systemd).
# Aset media boleh besar; snapshot dibuat tanpa menghentikan proses pelayan
# (JSON ditulis debounce; salinan best-effort — mungkin terlepas penulisan akhir jam).

set -euo pipefail

if [ -f "${HOME}/.config/tukuk-os/r2.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${HOME}/.config/tukuk-os/r2.env"
  set +a
fi

APP_DIR="${APP_DIR:-/home/tukuk/tukuk-os}"
SNAP_DIR="${SNAP_DIR:-$APP_DIR/snapshots}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
R2_BUCKET="${R2_BUCKET:-tukuk-os-backups}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
TIMEOUT="${TIMEOUT:-900}"

log() { printf '[chat-backup] %s\n' "$*"; }
fail() { printf '[chat-backup] RALAT: %s\n' "$*" >&2; exit 1; }

# anggap placeholder <...> sebagai belum diisi
usable() {
  case "${1:-}" in
    ''|'<'*'>'|*'<your'*) return 1 ;;
    *) return 0 ;;
  esac
}

usable "${BACKUP_WORKER_URL:-}" && usable "${BACKUP_UPLOAD_SECRET:-}" && WORKER_OK=1 || WORKER_OK=0

CHAT_JSON="$DATA_DIR/chat.json"
CHAT_MEDIA="$DATA_DIR/chat-media"
[ -f "$CHAT_JSON" ] || fail "tiada $CHAT_JSON — data T Chat belum wujud di pelayan ini"

mkdir -p "$SNAP_DIR"

upload_worker() {
  local file="$1" key="$2"
  local size remote
  size=$(stat -c%s "$file")
  log "memuat naik $(basename "$file") ($size bait) -> $R2_BUCKET/$key"
  curl -sf -m "$TIMEOUT" -X POST \
    -H "Authorization: Bearer $BACKUP_UPLOAD_SECRET" \
    -H "Content-Type: application/gzip" \
    --data-binary "@$file" \
    "$BACKUP_WORKER_URL/?key=$key" \
    || fail "muat naik worker gagal"
  remote=$(curl -sf -m 60 -H "Authorization: Bearer $BACKUP_UPLOAD_SECRET" \
    "$BACKUP_WORKER_URL/?key=$key" -o /dev/null -w '%{size_download}')
  [ "$remote" = "$size" ] || fail "saiz tidak sepadan: local=$size remote=$remote"
  log "sahkan saiz OK ($size bait)"
}

prune_local() {
  local pattern="$1"
  local -a files
  mapfile -t files < <(ls -1t "$SNAP_DIR"/$pattern 2>/dev/null || true)
  local f
  for f in "${files[@]:$KEEP_LOCAL}"; do
    [ -n "$f" ] && rm -f "$f" && log "buang backup local: $(basename "$f")"
  done
  return 0
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$SNAP_DIR/tukuk-chat-${STAMP}.tar.gz"
log "membuat snapshot T Chat ($OUT)..."

# Salin JSON ke staging (elak baca fail ketika tulis debounce → snapshot separuh),
# dan gunakan symlink ke media supaya tar tak berganda ruang. -h (dereference)
# masukkan kandungan media sebenar ke dalam arkib.
STAGE=$(mktemp -d)
cp "$CHAT_JSON" "$STAGE/chat.json"
if [ -d "$CHAT_MEDIA" ]; then
  ln -s "$CHAT_MEDIA" "$STAGE/chat-media"
  tar -czh -f "$OUT" -C "$STAGE" chat.json chat-media
else
  tar -cz -f "$OUT" -C "$STAGE" chat.json
fi
rm -rf "$STAGE"

[ -s "$OUT" ] || fail "snapshot kosong/gagal"
SIZE=$(du -h "$OUT" | cut -f1)
log "snapshot siap ($SIZE)"

if [ "$WORKER_OK" = 1 ]; then
  upload_worker "$OUT" "tukuk-chat/$(date -u +%Y/%m/%d)/$(basename "$OUT")"
else
  log "WORKER OK=0 — simpan lokal sahaja (isi BACKUP_WORKER_URL+BACKUP_UPLOAD_SECRET untuk R2)"
fi
prune_local 'tukuk-chat-*.tar.gz'

log "selesai"
