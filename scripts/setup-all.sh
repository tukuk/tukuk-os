#!/usr/bin/env bash
# ==============================================================================
# setup-all.sh — Auto-setup penuh Tukuk-OS untuk server sebenar.
#
# Cara guna di mesin KOSONG (Ubuntu 22.04+) — SATU langkah sahaja:
#   git clone git@github.com:fevian448/tukuk-os-v2.git /opt/tukuk-os
#   cd /opt/tukuk-os
#   npm install     # postinstall -> skrip ini auto-jalan, terus siap 100%
#
# (repo private — mesin baru perlukan SSH key GitHub; .env auto-disalin
#  daripada deploy/env.defaults; credentials tunnel dibaca daripada
#  deploy/cloudflared/<CF_TUNNEL_ID>.json)
#
# Atau manual:  sudo bash scripts/setup-all.sh
#
# Skrip ini IDEMPOTENT — boleh jalankan berkali-kali; bahagian yang sudah
# siap akan dilangkau. Apabila dipanggil melalui npm postinstall, ia hanya
# bertindak jika: (a) TUKUK_AUTO_SETUP=1, ATAU (b) app berada di /opt/tukuk-os.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${BLUE}➜ $*${NC}"; }
warn() { echo -e "${YELLOW}! $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${TUKUK_INSTALL_DIR:-/opt/tukuk-os}"
FROM_NPM=0
[[ "${1:-}" == "--from-npm" ]] && FROM_NPM=1

# ── Pintu keselamatan: jangan auto-ubah sistem kecuali benar-benar server ──────
# Pengawal rekursi: elak npm install bersarang mencetuskan setup berkali-kali.
if [[ "${TUKUK_SETUP_RUNNING:-0}" == "1" ]]; then
  info "setup-all sudah berjalan dalam proses induk — dilangkau."
  exit 0
fi
export TUKUK_SETUP_RUNNING=1

if [[ $FROM_NPM -eq 1 ]]; then
  if [[ "${TUKUK_AUTO_SETUP:-0}" != "1" && "$REPO_DIR" != "$INSTALL_DIR" ]]; then
    info "postinstall: auto-setup dilangkau (bukan server). Untuk jalankan di server:"
    echo "   sudo bash scripts/setup-all.sh     ATAU   TUKUK_AUTO_SETUP=1 npm install"
    exit 0
  fi
fi

# ── Wajib root; naik ke sudo secara automatik ─────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null; then
    exec sudo env "TUKUK_AUTO_SETUP=${TUKUK_AUTO_SETUP:-1}" "TUKUK_SETUP_RUNNING=1" "PATH=$PATH" bash "$0" "${@:---from-server}"
  fi
  die "Perlukan root (guna sudo)."
fi

command -v apt-get >/dev/null || die "Skrip ini untuk Ubuntu/Debian."

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  Tukuk-OS — Auto Setup (server + Cloudflare Tunnel)${NC}"
echo -e "${BLUE}========================================================${NC}"

# ── [1] Fail .env (kunci & API) — auto daripada defaults terbawa ─────────────
if [[ ! -f "$REPO_DIR/.env" ]]; then
  if [[ -f "$REPO_DIR/deploy/env.defaults" ]]; then
    cp "$REPO_DIR/deploy/env.defaults" "$REPO_DIR/.env"
    ok ".env automatik daripada deploy/env.defaults — tiada editing diperlukan."
  elif [[ -f "$REPO_DIR/.env.example" ]]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
    warn ".env dicipta daripada .env.example — ISI SEMUA KUNCI anda, kemudian jalankan semula."
  fi
fi
[[ -f "$REPO_DIR/.env" ]] && chmod 600 "$REPO_DIR/.env"
get_env() { [[ -f "$REPO_DIR/.env" ]] && grep -E "^$1=" "$REPO_DIR/.env" | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//' || true; }

# ── [2] Pakej asas + tuning memori (2GB RAM) ──────────────────────────────────
info "[1/8] Pakej asas & tuning kernel..."
apt-get update -y -qq
apt-get install -y -qq curl wget git unzip rsync zram-tools ca-certificates >/dev/null
[[ -f /etc/default/zramswap ]] || cat > /etc/default/zramswap << 'EOF'
ALGO=zstd
PERCENT=75
PRIORITY=100
EOF
systemctl enable --now zramswap >/dev/null 2>&1 || true
cat > /etc/sysctl.d/99-tukuk-os.conf << 'EOF'
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
net.core.somaxconn = 4096
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_fin_timeout = 15
EOF
sysctl --system > /dev/null
ok "Sistem tunes siap."

# ── [3] Node.js 22 LTS ─────────────────────────────────────────────────────────
info "[2/8] Node.js..."
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) / npm $(npm -v)"

# ── [4] Meilisearch ────────────────────────────────────────────────────────────
info "[3/8] Meilisearch..."
if ! command -v meilisearch >/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/meilisearch/meilisearch/latest/scripts/install-meilisearch.sh | bash >/dev/null 2>&1 \
    || { ARCH=$(dpkg --print-architecture); wget -q "https://github.com/meilisearch/meilisearch/releases/latest/download/meilisearch-linux-${ARCH}" -O /usr/local/bin/meilisearch && chmod +x /usr/local/bin/meilisearch; }
fi
ok "meilisearch: $(command -v meilisearch || echo 'TIADA — pasangkan sendiri')"

MEILI_KEY="$(get_env MEILI_MASTER_KEY)"
if [[ -z "$MEILI_KEY" ]]; then
  MEILI_KEY="$(head -c 24 /dev/urandom | base64 | tr -d '=+/')"
  echo "MEILI_MASTER_KEY=$MEILI_KEY" >> "$REPO_DIR/.env"
  warn "MEILI_MASTER_KEY baharu dijana dan disimpan dalam .env."
fi

cat > /etc/systemd/system/meilisearch.service << EOF
[Unit]
Description=Meilisearch (enjin indeks Tukuk-OS)
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=$(command -v meilisearch) --db-path $INSTALL_DIR/meili_data --master-key $MEILI_KEY --http-addr 127.0.0.1:7700
Restart=always
RestartSec=3
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

# ── [5] Letak app di /opt/tukuk-os + git branch siap ──────────────────────────
info "[4/8] Aplikasi & git..."
if [[ "$REPO_DIR" != "$INSTALL_DIR" ]]; then
  mkdir -p "$INSTALL_DIR"
  rsync -a --delete --exclude node_modules --exclude meili_data --exclude snapshots --exclude dumps "$REPO_DIR/" "$INSTALL_DIR/"
fi
cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR" || true
if [[ -d .git ]]; then
  DEFAULT_BRANCH="$(get_env GIT_BRANCH)"; DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
  git fetch --all --prune -q || true
  git checkout "$DEFAULT_BRANCH" 2>/dev/null || git checkout -b "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH" || true
  git pull --ff-only -q origin "$DEFAULT_BRANCH" || warn "git pull dilangkau (tmpahan tempatan)."
  ok "Git branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
fi
[[ -d node_modules ]] || npm install --omit=dev --no-audit --no-fund
mkdir -p meili_data snapshots dumps data

# ── [6] Perkhidmatan systemd (tukuk-os + watchdog) ────────────────────────────
info "[5/8] Servis Tukuk-OS..."
cat > /etc/systemd/system/tukuk-os.service << EOF
[Unit]
Description=Tukuk-OS Search Engine
After=network-online.target meilisearch.service
Wants=meilisearch.service
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=768
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=3
MemoryMax=1G
TasksMax=512
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/tukuk-os-watchdog.service << EOF
[Unit]
Description=Watchdog Tukuk-OS
After=tukuk-os.service meilisearch.service

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/scripts/watchdog.sh
EOF

cat > /etc/systemd/system/tukuk-os-watchdog.timer << 'EOF'
[Unit]
Description=Watchdog Tukuk-OS setiap 2 minit

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=30s
Unit=tukuk-os-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now meilisearch >/dev/null
systemctl enable --now tukuk-os >/dev/null
systemctl enable --now tukuk-os-watchdog.timer >/dev/null
ok "tukuk-os + meilisearch + watchdog berjalan."

# ── [7] Cloudflare Tunnel auto ────────────────────────────────────────────────
info "[6/8] Cloudflare Tunnel..."
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  apt-get update -y -qq
  apt-get install -y -qq cloudflared >/dev/null || {
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i cloudflared-linux-amd64.deb && rm -f cloudflared-linux-amd64.deb
  }
fi

CF_TOKEN="$(get_env CF_TUNNEL_TOKEN)"
CF_ID="$(get_env CF_TUNNEL_ID)"
# Token cloudflared sejati SELALU bermula "eyJ" (JSON base64). Tolak nilai
# rosak/placeholder supaya pelayan baru tak mati pada `service install <sampah>`.
if [[ -n "$CF_TOKEN" && "$CF_TOKEN" != eyJ* ]]; then
  warn "CF_TUNNEL_TOKEN bukan token cloudflared sah (mestinya bermula 'eyJ…'). Diabaikan."
  CF_TOKEN=""
fi
mkdir -p /etc/cloudflared
if [[ -n "$CF_TOKEN" ]]; then
  # ── MOD TOKEN (paling portabel — TIADA fail credentials .json diperlukan) ──
  # config.yml dibina daripada templat: baris `credentials-file:` digantikan
  # `token: <TOKEN>`. Ingress kekal dalam fail ini (tidak bergantung dashboard).
  # PENTING: `cloudflared service install` MENOLAK config `token:` (minta
  # credentials-file), TETAPI `cloudflared tunnel run --config` MENERIMA token.
  # Jadi unit systemd ditulis terus (ExecStart `--config ... tunnel run`), bukan
  # melalui `service install` — beginilah pelayan baru boleh 100% auto.
  [[ -n "$CF_ID" ]] || die "CF_TUNNEL_TOKEN diisi tapi CF_TUNNEL_ID kosong — letak UUID tunnel."
  sed -e "s#<TUNNEL_ID>#$CF_ID#g" \
      -e "s#^credentials-file:.*#token: $CF_TOKEN#" \
      "$INSTALL_DIR/deploy/cloudflared/config.yml" > /etc/cloudflared/config.yml
  chmod 600 /etc/cloudflared/config.yml   # config kini mengandungi token rahsia
  cat > /etc/systemd/system/cloudflared.service << 'EOF'
[Unit]
Description=cloudflared Tunnel (Tukuk-OS, mod token)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now cloudflared >/dev/null && systemctl restart cloudflared >/dev/null \
    && ok "Cloudflare Tunnel ($CF_ID) berjalan dalam MOD TOKEN (portabel, tiada .json)." \
    || die "Gagal mulakan servis cloudflared — semak: journalctl -u cloudflared -n 30"
elif [[ -n "$CF_ID" ]]; then
  # ── MOD NAMED/JSON (fallback: perlu fail <CF_ID>.json pada pelayan ini) ──
  CRED_SRC=""
  for cand in "$INSTALL_DIR/deploy/cloudflared/$CF_ID.json" "$HOME/.cloudflared/$CF_ID.json" "/root/.cloudflared/$CF_ID.json" "/home/tukuk/.cloudflared/$CF_ID.json"; do
    [[ -f "$cand" ]] && CRED_SRC="$cand" && break
  done
  [[ -n "$CRED_SRC" ]] || die "Tiada CF_TUNNEL_TOKEN & credentials $CF_ID.json tidak ditemui. Paling mudah: dashboard Cloudflare → Networks → Tunnels → $CF_ID → salin TOKEN, letak CF_TUNNEL_TOKEN=<eyJ…> dalam .env, ulangi setup-all.sh. ATAU scp fail .json dari pelayan lama."
  cp "$CRED_SRC" "/etc/cloudflared/$CF_ID.json" && chmod 600 "/etc/cloudflared/$CF_ID.json"
  sed "s#<TUNNEL_ID>#$CF_ID#g" "$INSTALL_DIR/deploy/cloudflared/config.yml" > /etc/cloudflared/config.yml
  cloudflared service install >/dev/null && systemctl enable --now cloudflared >/dev/null \
    && ok "Cloudflare Tunnel ($CF_ID) dipasang daripada credentials JSON lokal." \
    || die "Gagal pasang servis cloudflared — semak /etc/cloudflared/config.yml."
else
  warn "CF_TUNNEL_TOKEN / CF_TUNNEL_ID belum diisi dalam .env — tunnel dilangkau."
  echo "   Cara disyorkan (MOD TOKEN, portabel ke semua pelayan):"
  echo "   Cloudflare One → Tunnels → $CF_ID (atau create baharu) → salin TOKEN (mula 'eyJ'),"
  echo "   tampal CF_TUNNEL_TOKEN=<token> + CF_TUNNEL_ID=<uuid> dalam $INSTALL_DIR/.env,"
  echo "   kemudian:  sudo bash scripts/setup-all.sh   (hanya langkah tunnel diulang)"
  echo "   Ujian pantas tanpa token:  cloudflared tunnel --url http://localhost:3000"
fi

# ── [8] Cloudflare Edge — www.tukuk.org sentiasa hidup ─────────────────────
info "[7/8] Cloudflare Edge (cermin www + snapshot R2)..."
CF_API="$(get_env CLOUDFLARE_API_TOKEN)"
if [[ -n "$CF_API" ]]; then
  export CLOUDFLARE_API_TOKEN="$CF_API"
  command -v wrangler >/dev/null || npm install -g wrangler --silent || true
  ( cd "$INSTALL_DIR/worker" && npx --yes wrangler deploy >/dev/null ) \
    && ok "Worker www.tukuk.org di-deploy (cuba origin → gagal → hidang snapshot R2)." \
    || warn "wrangler deploy gagal — semak CLOUDFLARE_API_TOKEN & kebenaran zone."
  bash "$INSTALL_DIR/scripts/snapshot-r2.sh" || true
  cat > /etc/systemd/system/tukuk-snapshot.service << EOF
[Unit]
Description=Snapshot laman Tukuk-OS ke R2
After=tukuk-os.service

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
ExecStart=/bin/bash $INSTALL_DIR/scripts/snapshot-r2.sh
EOF
  cat > /etc/systemd/system/tukuk-snapshot.timer << 'EOF'
[Unit]
Description=Snapshot R2 setiap 6 jam

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Unit=tukuk-snapshot.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now tukuk-snapshot.timer >/dev/null
  ok "Timer snapshot 6 jam aktif — cermin www sentiasa segar."
else
  warn "CLOUDFLARE_API_TOKEN tiada — langkah edge dilangkau (fallback www tidak aktif)."
fi

# Auto-update harian: git pull → npm install (postinstall → setup-all) → servis
# & worker & snapshot ikut berkemas. Padam dengan GIT_AUTO_UPDATE=0 dalam .env.
if [[ "$(get_env GIT_AUTO_UPDATE)" != "0" ]]; then
  cat > /etc/systemd/system/tukuk-update.service << 'EOF'
[Unit]
Description=Kemas kini Tukuk-OS (git + npm + servis + edge)

[Service]
Type=oneshot
WorkingDirectory=/opt/tukuk-os
ExecStart=/bin/bash /opt/tukuk-os/scripts/auto-update.sh
EOF
  cat > /etc/systemd/system/tukuk-update.timer << 'EOF'
[Unit]
Description=Auto-update Tukuk-OS setiap hari

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=1500
Persistent=true
Unit=tukuk-update.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now tukuk-update.timer >/dev/null
  ok "Auto-update harian aktif (tukuk-update.timer ~04:30). Manual: npm run update"
fi

# ── [9] Pengesahan akhir ──────────────────────────────────────────────────────
info "[8/8] Mengesahkan..."
sleep 3
for svc in meilisearch tukuk-os cloudflared; do
  printf "  %-14s %s\n" "$svc" "$(systemctl is-active $svc 2>/dev/null || echo inactive)"
done
if [[ "$(curl -s -m5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null)" == "200" ]]; then
  ok "Enjin carian hidup di http://127.0.0.1:3000"
else
  warn "Server belum respons — semak: journalctl -u tukuk-os -n 30"
fi

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  SELESAI. Panel admin: /admin — login e-mel + passkey.${NC}"
echo -e "  Server: $INSTALL_DIR | Log: journalctl -u tukuk-os -f"
echo -e "${BLUE}========================================================${NC}"
