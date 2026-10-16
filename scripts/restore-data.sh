#!/usr/bin/env bash
# ==============================================================================
# restore-data.sh — Pulihkan data/ Tukuk-OS daripada salinan R2 (backup-data.sh).
#
#   bash scripts/restore-data.sh                    # slot jam semasa (paling segar)
#   bash scripts/restore-data.sh 314                # key tukuk-data-314.tar.gz (hari3 jam14)
#
# SELAMAT: data/ sedia ada dipindah ke data.broken-<ts>/ dahulu — tiada tulis
# ganti buta. Selepas pulih: systemctl restart tukuk-os (root).
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

BUCKET="${R2_BUCKET:-tukuk-fallback}"
SLOT="${1:-$(date -u +%u%H)}"
KEY="backups/tukuk-data-${SLOT}.tar.gz"
[[ "$SLOT" =~ ^[0-9]{3}$ || "$SLOT" =~ ^[0-9]{4}$ ]] || { echo "Slot perlu 3-4 digit (hari+jam), contoh: 314"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[restore] mengambil $KEY dari $BUCKET ..."
npx --yes wrangler r2 object get "$BUCKET/$KEY" --file "$TMP/data.tar.gz" --remote || {
  echo "[restore] RALAT: salinan tiada / muat gagal" >&2; exit 1;
}

TS="$(date +%Y%m%d-%H%M%S)"
if [[ -d "$ROOT/data" ]]; then
  mv "$ROOT/data" "$ROOT/data.broken-$TS"
  echo "[restore] data lama disimpan di data.broken-$TS"
fi

tar xzf "$TMP/data.tar.gz" -C "$ROOT"
echo "[restore] ✓ data dipulihkan daripada $KEY"
echo "[restore] jangan lupa: systemctl restart tukuk-os"
