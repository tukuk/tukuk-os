#!/usr/bin/env bash
# ==============================================================================
# install-from-usb.sh — Pasang Tukuk-OS daripada salinan USB ke /opt/tukuk-os.
#
# KENAPA: repo kini PRIVATE (fevian448/tukuk-os-v2). Clone GitHub di mesin
# baru perlu SSH key/PAT — menyusahkan. USB membawa kod terus, jadi TIADA auth
# diperlukan. Server hanya perlu INTERNET untuk `npm install` (Node deps).
#
# CARA (di SERVER, selepas USB dicolok & auto-mount, biasanya /media/<user>/...):
#   # salin folder repo dari USB ke mana-mana, contohnya:
#   cp -r /media/$USER/USB/tukuk-os /tmp/tukuk-os
#   sudo bash /tmp/tukuk-os/scripts/install-from-usb.sh
#
# ATAU jalankan terus dari USB (jika USB mounted & boleh laksana skrip):
#   sudo bash /media/$USER/USB/tukuk-os/scripts/install-from-usb.sh
#
# OPSYEN (env):
#   TUKUK_INSTALL_DIR=/opt/tukuk-os   lokasi pasang (lalai /opt/tukuk-os)
#   TUKUK_KEEP_NODEMODULES=1          sertakan node_modules dari USB (offline-ish)
#   TUKUK_OFFLINE=1                   lulus daripada apt/npm (butuh node_modules + binary
#                                     sudah ada di USB; lihat nota README §5)
#
# Selepas siap: isi CF_TUNNEL_TOKEN (dan CLOUDFLARE_API_TOKEN untuk www/edge)
# dalam /opt/tukuk-os/.env, kemudian jalankan `sudo bash scripts/setup-all.sh`
# sekali lagi (idempotent) untuk hidupkan tunnel & edge.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${BLUE}➜ $*${NC}"; }
warn() { echo -e "${YELLOW}! $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

# Direktori repo = parent skrip ini (iaitu salinan pada USB / tmp).
SRC="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${TUKUK_INSTALL_DIR:-/opt/tukuk-os}"
KEEP_NM="${TUKUK_KEEP_NODEMODULES:-0}"
OFFLINE="${TUKUK_OFFLINE:-0}"

[[ -f "$SRC/package.json" && -d "$SRC/src" ]] || die "Bukan folder repo Tukuk-OS: $SRC (tiada package.json/src)."

if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null || die "Perlukan root (guna sudo)."
  exec sudo env "TUKUK_INSTALL_DIR=$INSTALL_DIR" "TUKUK_KEEP_NODEMODULES=$KEEP_NM" "TUKUK_OFFLINE=$OFFLINE" "PATH=$PATH" bash "$0"
fi

command -v rsync >/dev/null || { info "Pasang rsync..."; apt-get update -y -qq && apt-get install -y -qq rsync >/dev/null; }

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  Tukuk-OS — Install dari USB${NC}"
echo -e "${BLUE}  Sumber : $SRC${NC}"
echo -e "${BLUE}  Sasaran: $INSTALL_DIR${NC}"
echo -e "${BLUE}========================================================${NC}"

# ── 1. Salin kod ke /opt/tukuk-os ────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
if [[ "$SRC" == "$INSTALL_DIR" ]]; then
  info "Sumber sudah = sasaran; skip salinan."
else
  info "[1/3] Menyalin fail ke $INSTALL_DIR ..."
  # Excludes: rahsia runtime & artifak besar yang boleh dijana semula.
  EX=(--exclude .git --exclude meili_data --exclude .wrangler --exclude snapshots --exclude dumps --exclude .env)
  [[ "$KEEP_NM" == "1" || "$OFFLINE" == "1" ]] || EX+=(--exclude node_modules)
  rsync -a "${EX[@]}" "$SRC/" "$INSTALL_DIR/"
  ok "Kod siap disalin."
fi

cd "$INSTALL_DIR"

# ── 2. .env daripada defaults (jika tiada) ────────────────────────────────────
if [[ ! -f .env ]]; then
  if [[ -f deploy/env.defaults ]]; then
    cp deploy/env.defaults .env && chmod 600 .env
    ok ".env dijana daripada deploy/env.defaults."
  elif [[ -f .env.example ]]; then
    cp .env.example .env && chmod 600 .env
    warn ".env daripada .env.example — ISI kunci anda sebelum tunnel hidup."
  else
    die "Tiada deploy/env.defaults atau .env.example untuk jana .env."
  fi
fi

# ── 3. Setup penuh (Node, Meili, servis, tunnel, edge) ───────────────────────
if [[ "$OFFLINE" == "1" ]]; then
  warn "MOD OFFLINE: setup-all.sh akan CUBA apt/npm (mungkin gagal tanpa internet)."
  warn "Untuk offline tulen: pastikan node_modules + binary (node/cloudflared/meilisearch)"
  warn "sudah ada di USB, dan aktifkan servis systemd secara manual."
fi

info "[2/3] Menjalakan setup-all.sh (idempotent) ..."
TUKUK_AUTO_SETUP=1 bash scripts/setup-all.sh

# ── 4. Pengesahan & penutup ───────────────────────────────────────────────────
info "[3/3] Mengesahkan ..."
sleep 2
if [[ "$(curl -s -m5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null)" == "200" ]]; then
  ok "Enjin carian hidup di http://127.0.0.1:3000"
else
  warn "Belum respons — semak: journalctl -u tukuk-os -n 30"
fi

TOKEN="$(grep -E '^CF_TUNNEL_TOKEN=' .env | head -1 | cut -d= -f2- || true)"
if [[ -z "$TOKEN" ]]; then
  echo
  warn "Langkah terakhir: hidupkan domain."
  echo "   1. Nano .env  →  CF_TUNNEL_TOKEN=eyJ...  (Cloudflare Zero Trust → Tunnels)"
  echo "      (+ CLOUDFLARE_API_TOKEN=... untuk www.tukuk.org / edge snapshot)"
  echo "   2. sudo bash scripts/setup-all.sh     # hanya langkah tunnel/edge diulang"
fi

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  SELESAI. Admin: http://127.0.0.1:3000/admin (e-mel + passkey).${NC}"
echo -e "  Log: journalctl -u tukuk-os -f     Manual kemas kini: npm run update"
echo -e "${BLUE}========================================================${NC}"
