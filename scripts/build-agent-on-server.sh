#!/usr/bin/env bash
# ==============================================================================
# build-agent-on-server.sh — Bina release Tukuk Agent TERUS di pelayan.
#
# Laluan asal ialah build di laptop (build-tukuk-agent.sh) supaya VPS tetap
# ringan. Tapi jika laptop kurang RAM/dependensi (kerberos perlu libkrb5-dev,
# gulp perlu ~4GB), pelayan dengan 6.8GB+ boleh jadi rumah build yang lebih
# selesa — asalkan Ollama dihenti-sementara semasa kompilasi (cloud tier
# tetap menjawab /ask) dan ada ≥8GB ruang cakera.
#
#   sudo bash scripts/build-agent-on-server.sh            # build + pasang servis
#   sudo bash scripts/build-agent-on-server.sh --keep-ollama
#
# Apa yang dibuat:
#   [1] Semak pratent: cakera, RAM, sudo.
#   [2] apt: pakej pembangunan (build-essential, python3, libkrb5-dev,
#       libxkbfile-dev, libsecret-1-dev, unzip).
#   [3] Node 24 melalui nvm (jika belum ada).
#   [4] Clone fork tukuk-agent-editor → /opt/tukuk-os/code-server (gitignored)
#       + submodule lib/vscode (dalam ~350MB).
#   [5] Henti ollama (kecuali --keep-ollama), jalankan build-tukuk-agent.sh,
#       mula ollama semula.
#   [6] Pasang release secara LOKAL (tiada rsync/ssh): /opt/tukuk-agent/release
#       + user + unit systemd + start — catatan akhir sama seperti
#       publish-agent.sh.
# ==============================================================================
set -uo pipefail

INSTALL_DIR=/opt/tukuk-os
FORK_URL="https://github.com/fevian448/tukuk-agent-editor.git"
KEEP_OLLAMA=0
[ "${1:-}" = "--keep-ollama" ] && KEEP_OLLAMA=1

info() { echo -e "\033[1;36m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }
die()  { echo -e "\033[1;31m✗ $*\033[0m"; exit 1; }

[ "$(id -u)" = 0 ] || die "perlukan root: sudo bash $0"
cd "$INSTALL_DIR" 2>/dev/null || die "$INSTALL_DIR tiada — ini skrip pelayan Tukuk-OS."

# ── [1] Pratent ───────────────────────────────────────────────────────────────
AVAIL_GB=$(df -BG --output=avail "$INSTALL_DIR" | tail -1 | tr -dc '0-9')
[ "${AVAIL_GB:-0}" -ge 8 ] || die "cakera tinggal ${AVAIL_GB}GB — build VS Code perlukan ≥8GB (node_modules + out + release)."
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
info "Pratent OK: cakera ${AVAIL_GB}GB bebas, RAM ${RAM_MB}MB."

# ── [2] Pakej pembangunan (termasuk libkrb5-dev — punca kegagalan laptop) ────
info "[2] apt pakej pembangunan..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 pkg-config \
  libkrb5-dev libxkbfile-dev libsecret-1-dev zip unzip >/dev/null 2>&1 \
  || warn "sebahagian pakej gagal — sambung, tapi node-gyp mungkin ulang ralat yang sama."

# ── [3] Node 24 ───────────────────────────────────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" != "24" ]; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    info "[3] pasang nvm..."
    git clone --depth 1 -b v0.40.1 https://github.com/nvm-sh/nvm.git "$NVM_DIR" >/dev/null 2>&1 \
      || die "clone nvm gagal."
  fi
  . "$NVM_DIR/nvm.sh"
  nvm install 24 >/dev/null || die "nvm install 24 gagal."
  nvm use 24 >/dev/null
fi
. "$NVM_DIR/nvm.sh" 2>/dev/null || true
ok "Node $(node -v) aktif."

# ── [4] Fork + submodule (kredit git pelayan perlu boleh akses repo private ──
#     fevian448/tukuk-agent-editor; kalau 401: tambah PAT, atau publickan fork) ──
if [ ! -d code-server/.git ]; then
  info "[4] clone fork → $INSTALL_DIR/code-server (±350MB)..."
  # Gunakembali kredit yang SUDAH berfungsi untuk auto-update parent:
  #  • HTTPS ber-token (https://user:token@github.com/...) → token yang sama;
  #  • SSH (git@github.com:owner/repo.git) → kunci SSH pelayan yang sama.
  ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
  CLONE_URL="$FORK_URL"
  if [[ "$ORIGIN_URL" == https://*@github.com/* ]]; then
    CRED="${ORIGIN_URL%%github.com/*}"
    CLONE_URL="${CRED}github.com/fevian448/tukuk-agent-editor.git"
  elif [[ "$ORIGIN_URL" == git@github.com:* || "$ORIGIN_URL" == ssh://git@github.com/* ]]; then
    CLONE_URL="git@github.com:fevian448/tukuk-agent-editor.git"
  fi
  git clone --depth 1 "$CLONE_URL" code-server \
    || { warn "clone dengan URL origin gagal — cuba HTTPS anonim."; rm -rf code-server; git clone --depth 1 "$FORK_URL" code-server; } \
    || die "clone gagal. Fork kini PUBLIC (fevian448/tukuk-agent-editor) — jika HTTPS anonim pun gagal, itu masalah jaringan GitHub dari pelayan, bukan kredit."
fi
( cd code-server && git submodule update --init --depth 1 lib/vscode >/dev/null 2>&1 ) \
  || ( cd code-server && git submodule update --init lib/vscode ) || die "submodule lib/vscode gagal."
[ -d code-server/lib/vscode/extensions ] || [ -d code-server/lib/vscode/Extensions ] \
  || die "lib/vscode masih kosong."
ok "Sumber tersedia: $(git -C code-server rev-parse --short HEAD) + vscode $(git -C code-server/lib/vscode rev-parse --short HEAD)"

# ── [5] Build (OLLAMA REBAH sementara — cloud tier kekal jawab /ask) ─────────
OLLAMA_WAS_ACTIVE=0
if [ "$KEEP_OLLAMA" = 0 ] && systemctl is-active --quiet ollama 2>/dev/null; then
  systemctl stop ollama && OLLAMA_WAS_ACTIVE=1
  warn "ollama DITUTUP sementara build (/ask guna cloud seperti biasa)."
fi
info "[5] build — ini ambil ~1–2 jam pada 4 teras; log: /tmp/tukuk-agent-build.log"
export NODE_OPTIONS=--max-old-space-size=4096
bash scripts/build-tukuk-agent.sh 2>&1 | tee /tmp/tukuk-agent-build.log
BUILD_RC=${PIPESTATUS[0]}
[ "$OLLAMA_WAS_ACTIVE" = 1 ] && systemctl start ollama && ok "ollama dihidupkan semula."
[ "$BUILD_RC" = 0 ] || die "build gagal (rc=$BUILD_RC) — hujung log: $(tail -3 /tmp/tukuk-agent-build.log | tr '\n' ' ')"

# ── [6] Pasang release secara lokal ──────────────────────────────────────────
info "[6] pasang → /opt/tukuk-agent/release + servis..."
[ -x code-server/release/bin/tukuk-agent ] || die "release/bin/tukuk-agent tiada — janggal."
mkdir -p /opt/tukuk-agent
rsync -a --delete code-server/release/ /opt/tukuk-agent/release/
getent passwd tukuk-agent >/dev/null 2>&1 || useradd --system --home-dir /var/lib/tukuk-agent --shell /usr/sbin/nologin tukuk-agent
install -d -m 0750 -o tukuk-agent -g tukuk-agent /var/lib/tukuk-agent/extensions /var/lib/tukuk-agent/user-data /var/lib/tukuk-agent/projects
chown -R tukuk-agent:tukuk-agent /opt/tukuk-agent
cp deploy/tukuk-agent.service /etc/systemd/system/tukuk-agent.service
systemctl daemon-reload
systemctl enable tukuk-agent >/dev/null
systemctl restart tukuk-agent
sleep 3
if systemctl is-active --quiet tukuk-agent; then
  ok "tukuk-agent AKTIF pada 127.0.0.1:8443."
else
  warn "servis belum aktif — semak: journalctl -u tukuk-agent -n 30"
fi

cat <<'EOF'
════════════════════════════════════════════════════════════════════════
Langkah akhir (tiada dalam skrip ini):
  1. Cloudflare dashboard (mod token): tambah route
       agent.tukuk.org → http://127.0.0.1:8443
     (Zero Trust → Networks → Routes). Ingress tempatan diabaikan mod token.
  2. AGENT_TOKEN dalam env Tukuk-OS (=/api/agent auth) + pastikan
     tukuk-os di-restart supaya config.agent.token terbaca.
  3. Buka https://agent.tukuk.org → kata laluan editor (--auth password,
     fail .password dalam /var/lib/tukuk-agent/user-data) atau tukar unit
     ke --auth none jika autentikasi di tepi sahaja.
  4. Dalam Cline (jika vsix sudah dipasang kemudian): Provider OpenAI
     Compatible, Base URL https://tukuk.org/api/agent/v1, Key <AGENT_TOKEN>,
     Model tukuk-agent.
════════════════════════════════════════════════════════════════════════
EOF
