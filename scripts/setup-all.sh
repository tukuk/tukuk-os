#!/usr/bin/env bash
# ==============================================================================
# setup-all.sh — Full automatic Tukuk-OS setup for a real server.
#
# How to use on an EMPTY machine (Ubuntu 22.04+) — ONE step only:
#   git clone git@github.com:fevian448/tukuk-os-v2.git /opt/tukuk-os
#   cd /opt/tukuk-os
#   npm install     # postinstall -> this script auto-runs, ready 100% at once
#
# (private repo — a new machine needs a GitHub SSH key; .env is auto-copied
#  from deploy/env.defaults; tunnel credentials are read from
#  deploy/cloudflared/<CF_TUNNEL_ID>.json)
#
# Or manual:  sudo bash scripts/setup-all.sh
#
# This script is IDEMPOTENT — you can run it many times; parts that are
# already done will be skipped. When called via npm postinstall, it only
# acts if: (a) TUKUK_AUTO_SETUP=1, OR (b) the app is at /opt/tukuk-os.
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

# ── Safety gate: do not auto-modify the system unless it really is a server ────
# Recursion guard: prevent nested npm install from triggering setup repeatedly.
if [[ "${TUKUK_SETUP_RUNNING:-0}" == "1" ]]; then
  info "setup-all already running in the parent process — skipping."
  exit 0
fi
export TUKUK_SETUP_RUNNING=1

if [[ $FROM_NPM -eq 1 ]]; then
  if [[ "${TUKUK_AUTO_SETUP:-0}" != "1" && "$REPO_DIR" != "$INSTALL_DIR" ]]; then
    info "postinstall: auto-setup skipped (not a server). To run it on a server:"
    echo "   sudo bash scripts/setup-all.sh     ATAU   TUKUK_AUTO_SETUP=1 npm install"
    exit 0
  fi
fi

# ── Require root; escalate to sudo automatically ──────────────────────────────
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null; then
    exec sudo env "TUKUK_AUTO_SETUP=${TUKUK_AUTO_SETUP:-1}" "TUKUK_SETUP_RUNNING=1" "PATH=$PATH" bash "$0" "${@:---from-server}"
  fi
  die "Need root (use sudo)."
fi

command -v apt-get >/dev/null || die "This script is for Ubuntu/Debian."

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  Tukuk-OS — Auto Setup (server + Cloudflare Tunnel)${NC}"
echo -e "${BLUE}========================================================${NC}"

# ── [1] .env file (keys & API) — automatic from bundled defaults ─────────────
if [[ ! -f "$REPO_DIR/.env" ]]; then
  if [[ -f "$REPO_DIR/deploy/env.defaults" ]]; then
    cp "$REPO_DIR/deploy/env.defaults" "$REPO_DIR/.env"
    ok ".env automatic from deploy/env.defaults — no editing needed."
  elif [[ -f "$REPO_DIR/.env.example" ]]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
    warn ".env created from .env.example — FILL IN ALL YOUR KEYS, then run again."
  fi
fi
[[ -f "$REPO_DIR/.env" ]] && chmod 600 "$REPO_DIR/.env"
get_env() { [[ -f "$REPO_DIR/.env" ]] && grep -E "^$1=" "$REPO_DIR/.env" | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//' || true; }

# Mutation routes (/crawl, /crawl/batch, /documents, /settings) are FAIL-OPEN: if
# API_KEY is empty, requireApiKey() just lets the request through — anyone on the
# internet could inject documents into our search index or wipe it. Generate a key
# as soon as .env exists so a new server is secure by default.
if [[ -f "$REPO_DIR/.env" && -z "$(get_env API_KEY)" ]]; then
  echo "API_KEY=$(head -c 24 /dev/urandom | base64 | tr -d '=+/')" >> "$REPO_DIR/.env"
  warn "API_KEY generated in .env — send it as the X-API-Key header for mutation routes."
fi

# ── [2] Base packages + memory tuning (2GB RAM) ───────────────────────────────
info "[1/8] Base packages & kernel tuning..."
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
ok "System tuning done."

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
ok "meilisearch: $(command -v meilisearch || echo 'NONE — install it yourself')"

MEILI_KEY="$(get_env MEILI_MASTER_KEY)"
if [[ -z "$MEILI_KEY" ]]; then
  MEILI_KEY="$(head -c 24 /dev/urandom | base64 | tr -d '=+/')"
  echo "MEILI_MASTER_KEY=$MEILI_KEY" >> "$REPO_DIR/.env"
  warn "A new MEILI_MASTER_KEY was generated and stored in .env."
fi

cat > /etc/systemd/system/meilisearch.service << EOF
[Unit]
Description=Meilisearch (Tukuk-OS index engine)
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

# ── [5] Place the app at /opt/tukuk-os + git branch ready ──────────────────────
info "[4/8] Application & git..."
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
  git pull --ff-only -q origin "$DEFAULT_BRANCH" || warn "git pull skipped (local overrides)."
  ok "Git branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
fi
[[ -d node_modules ]] || npm install --omit=dev --no-audit --no-fund
mkdir -p meili_data snapshots dumps data

# ── [6] systemd services (tukuk-os + watchdog) ──────────────────────────────
info "[5/8] Tukuk-OS service..."
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
Description=Watchdog Tukuk-OS every 2 minutes

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
ok "tukuk-os + meilisearch + watchdog running."

# ── [6b] Tukuk Agent (editor + AI build-agent) — unit is always installed;
#     the service can ONLY start once a ready-built release from the laptop has
#     been rsync'd to /opt/tukuk-agent/release (no heavy build on the VPS). ────
if [[ -f "$INSTALL_DIR/deploy/tukuk-agent.service" ]]; then
  getent passwd tukuk-agent >/dev/null 2>&1 || \
    useradd --system --home-dir /var/lib/tukuk-agent --shell /usr/sbin/nologin tukuk-agent 2>/dev/null || true
  install -d -m 0750 -o tukuk-agent -g tukuk-agent \
    /var/lib/tukuk-agent/extensions /var/lib/tukuk-agent/user-data /var/lib/tukuk-agent/projects 2>/dev/null || true
  cp "$INSTALL_DIR/deploy/tukuk-agent.service" /etc/systemd/system/tukuk-agent.service
  systemctl daemon-reload
  systemctl enable tukuk-agent >/dev/null 2>&1 || true
  if [[ -x /opt/tukuk-agent/release/bin/tukuk-agent ]]; then
    chown -R tukuk-agent:tukuk-agent /opt/tukuk-agent 2>/dev/null || true
    systemctl restart tukuk-agent >/dev/null 2>&1 \
      && ok "Tukuk Agent running on 127.0.0.1:8443 — https://agent.tukuk.org (through the tunnel)." \
      || warn "tukuk-agent failed to start — check: journalctl -u tukuk-agent -n 30"
  else
    warn "Tukuk Agent unit installed, but no release yet at /opt/tukuk-agent/release."
    echo "   Build on the LAPTOP:  bash scripts/build-tukuk-agent.sh"
    echo "   Push to the server:   bash scripts/publish-agent.sh <user@host>"
    echo "   then rerun setup-all.sh (or: sudo systemctl restart tukuk-agent)."
  fi
fi

# ── [7] Cloudflare Tunnel automatic ────────────────────────────────────────────
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
# A real cloudflared token ALWAYS starts with "eyJ" (JSON base64). Reject broken
# /placeholder values so a new server doesn't die on `service install <garbage>`.
if [[ -n "$CF_TOKEN" && "$CF_TOKEN" != eyJ* ]]; then
  warn "CF_TUNNEL_TOKEN is not a valid cloudflared token (it must start with 'eyJ…'). Ignored."
  CF_TOKEN=""
fi
mkdir -p /etc/cloudflared
if [[ -n "$CF_TOKEN" ]]; then
  # ── TOKEN MODE (most portable — NO .json credentials file needed) ──
  # config.yml is built from the template: the `credentials-file:` line is replaced
  # with `token: <TOKEN>`. Ingress stays in this file (not dependent on the dashboard).
  # IMPORTANT: `cloudflared service install` REJECTS a `token:` config (it wants
  # credentials-file), BUT `cloudflared tunnel run --config` ACCEPTS a token.
  # So the systemd unit is written directly (ExecStart `--config ... tunnel run`), not
  # via `service install` — this is how a new server can be 100% automatic.
  [[ -n "$CF_ID" ]] || die "CF_TUNNEL_TOKEN set but CF_TUNNEL_ID empty — put the tunnel UUID."
  sed -e "s#<TUNNEL_ID>#$CF_ID#g" \
      -e "s#^credentials-file:.*#token: $CF_TOKEN#" \
      "$INSTALL_DIR/deploy/cloudflared/config.yml" > /etc/cloudflared/config.yml
  chmod 600 /etc/cloudflared/config.yml   # config now contains a secret token
  cat > /etc/systemd/system/cloudflared.service << 'EOF'
[Unit]
Description=cloudflared Tunnel (Tukuk-OS, token mode)
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
    && ok "Cloudflare Tunnel ($CF_ID) running in TOKEN MODE (portable, no .json)." \
    || die "Failed to start cloudflared service — check: journalctl -u cloudflared -n 30"
elif [[ -n "$CF_ID" ]]; then
  # ── NAMED/JSON MODE (fallback: needs a <CF_ID>.json file on this server) ──
  CRED_SRC=""
  for cand in "$INSTALL_DIR/deploy/cloudflared/$CF_ID.json" "$HOME/.cloudflared/$CF_ID.json" "/root/.cloudflared/$CF_ID.json" "/home/tukuk/.cloudflared/$CF_ID.json"; do
    [[ -f "$cand" ]] && CRED_SRC="$cand" && break
  done
  [[ -n "$CRED_SRC" ]] || die "No CF_TUNNEL_TOKEN & credentials $CF_ID.json not found. Easiest: Cloudflare dashboard → Networks → Tunnels → $CF_ID → copy the TOKEN, put CF_TUNNEL_TOKEN=<eyJ…> in .env, rerun setup-all.sh. OR scp the .json file from the old server."
  cp "$CRED_SRC" "/etc/cloudflared/$CF_ID.json" && chmod 600 "/etc/cloudflared/$CF_ID.json"
  sed "s#<TUNNEL_ID>#$CF_ID#g" "$INSTALL_DIR/deploy/cloudflared/config.yml" > /etc/cloudflared/config.yml
  cloudflared service install >/dev/null && systemctl enable --now cloudflared >/dev/null \
    && ok "Cloudflare Tunnel ($CF_ID) installed from the local JSON credentials." \
    || die "Failed to install cloudflared service — check /etc/cloudflared/config.yml."
else
  warn "CF_TUNNEL_TOKEN / CF_TUNNEL_ID not yet set in .env — tunnel skipped."
  echo "   Recommended way (TOKEN MODE, portable to all servers):"
  echo "   Cloudflare One → Tunnels → $CF_ID (or create a new one) → copy the TOKEN (starts 'eyJ'),"
  echo "   paste CF_TUNNEL_TOKEN=<token> + CF_TUNNEL_ID=<uuid> into $INSTALL_DIR/.env,"
  echo "   then:  sudo bash scripts/setup-all.sh   (only the tunnel step is rerun)"
  echo "   Quick test without a token:  cloudflared tunnel --url http://localhost:3000"
fi

# ── [8] Cloudflare Edge — www.tukuk.org always live ───────────────────────
info "[7/8] Cloudflare Edge (www mirror + R2 snapshot)..."
CF_API="$(get_env CLOUDFLARE_API_TOKEN)"
if [[ -n "$CF_API" ]]; then
  export CLOUDFLARE_API_TOKEN="$CF_API"
  command -v wrangler >/dev/null || npm install -g wrangler --silent || true
  ( cd "$INSTALL_DIR/worker" && npx --yes wrangler deploy >/dev/null ) \
    && ok "Worker www.tukuk.org deployed (try origin → on failure → serve R2 snapshot)." \
    || warn "wrangler deploy failed — check CLOUDFLARE_API_TOKEN & zone permissions."
  bash "$INSTALL_DIR/scripts/snapshot-r2.sh" || true
  cat > /etc/systemd/system/tukuk-snapshot.service << EOF
[Unit]
Description=Snapshot Tukuk-OS site to R2
After=tukuk-os.service

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
ExecStart=/bin/bash $INSTALL_DIR/scripts/snapshot-r2.sh
EOF
  cat > /etc/systemd/system/tukuk-snapshot.timer << 'EOF'
[Unit]
Description=R2 snapshot every 6 hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Unit=tukuk-snapshot.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now tukuk-snapshot.timer >/dev/null
  ok "6-hour snapshot timer active — the www mirror stays fresh."
else
  warn "No CLOUDFLARE_API_TOKEN — edge step skipped (www fallback not active)."
fi

# ── T Chat backup (chat.json + chat-media) → R2, every 6 hours ──
if [ -f "$INSTALL_DIR/scripts/backup-chat.sh" ]; then
  chmod +x "$INSTALL_DIR/scripts/backup-chat.sh" 2>/dev/null || true
  cat > /etc/systemd/system/chat-backup.service << EOF
[Unit]
Description=Backup T Chat data (chat.json + media)
After=tukuk-os.service

[Service]
Type=oneshot
User=tukuk
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
ExecStart=/bin/bash $INSTALL_DIR/scripts/backup-chat.sh
EOF
  cat > /etc/systemd/system/chat-backup.timer << 'EOF'
[Unit]
Description=Backup T Chat data every 6 hours

[Timer]
OnCalendar=*-*-* 01,07,13,19:15:00
Persistent=true
Unit=chat-backup.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now chat-backup.timer >/dev/null 2>&1 || true
  ok "6-hour T Chat backup timer active (chat-backup.timer)."
fi

# Daily auto-update: git pull → npm install (postinstall → setup-all) → services
# & worker & snapshot tidy themselves. Disable with GIT_AUTO_UPDATE=0 in .env.
if [[ "$(get_env GIT_AUTO_UPDATE)" != "0" ]]; then
  cat > /etc/systemd/system/tukuk-update.service << 'EOF'
[Unit]
Description=Update Tukuk-OS (git + npm + services + edge)

[Service]
Type=oneshot
WorkingDirectory=/opt/tukuk-os
ExecStart=/bin/bash /opt/tukuk-os/scripts/auto-update.sh
EOF
  cat > /etc/systemd/system/tukuk-update.timer << 'EOF'
[Unit]
Description=Auto-update Tukuk-OS daily

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
  ok "Daily auto-update active (tukuk-update.timer ~04:30). Manual: npm run update"
fi

# ── [9] Final verification ────────────────────────────────────────────────────
info "[8/8] Verifying..."
sleep 3
for svc in meilisearch tukuk-os cloudflared; do
  printf "  %-14s %s\n" "$svc" "$(systemctl is-active $svc 2>/dev/null || echo inactive)"
done
if [[ "$(curl -s -m5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null)" == "200" ]]; then
  ok "Search engine is live at http://127.0.0.1:3000"
else
  warn "Server not responding yet — check: journalctl -u tukuk-os -n 30"
fi

# T Chat custom domain (tchat.tukuk.org) — check whether the hostname is configured.
TCHAT_H="$(get_env TCHAT_HOST)"; TCHAT_H="${TCHAT_H:-tchat.tukuk.org}"
TCHAT_CODE=$(curl -s -m6 -o /dev/null -w '%{http_code}' "https://$TCHAT_H/" 2>/dev/null || echo 000)
if [[ "$TCHAT_CODE" == "200" ]]; then
  ok "T Chat custom domain is live at https://$TCHAT_H (HTTP 200)."
elif [[ "$TCHAT_CODE" == "000" ]]; then
  warn "https://$TCHAT_H does not resolve in DNS yet — add a public hostname in Cloudflare Zero Trust → Networks → Routes (full guide in .env.example)."
else
  warn "https://$TCHAT_H replied HTTP $TCHAT_CODE — check the tunnel route + the TCHAT_HOST gate in src/server.js."
fi

echo -e "${BLUE}========================================================${NC}"
echo -e "${GREEN}  DONE. Admin panel: /admin — email login + passkey.${NC}"
echo -e "  Server: $INSTALL_DIR | Log: journalctl -u tukuk-os -f"
echo -e "${BLUE}========================================================${NC}"
