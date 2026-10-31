#!/usr/bin/env bash
# ==============================================================================
# Tukuk-OS Turnkey Setup Script for 2GB RAM Ubuntu Server
# Ultra-lightweight setup optimized for Cloudflare Tunnel
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}   Tukuk-OS Server Setup (Optimized for 2GB RAM)     ${NC}"
echo -e "${BLUE}======================================================${NC}"

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}Error: This script must be run as root (use sudo).${NC}"
  exit 1
fi

echo -e "\n${BLUE}[1/6] Tuning Linux Kernel for 2GB RAM & High Performance...${NC}"

# Enable ZRAM (Compressed RAM Swap - acts like 4GB RAM with zero disk lag)
apt-get update -y
apt-get install -y zram-tools curl wget git unzip

cat > /etc/default/zramswap << 'EOF'
ALGO=zstd
PERCENT=75
PRIORITY=100
EOF

systemctl restart zramswap || true

# Optimize memory & network sysctl
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

echo -e "\n${BLUE}[2/6] Installing Node.js 22 LTS...${NC}"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo -e "Node version: $(node -v) | NPM version: $(npm -v)"

echo -e "\n${BLUE}[3/6] Installing Cloudflare Tunnel (cloudflared)...${NC}"
if ! command -v cloudflared &> /dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared || {
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i cloudflared-linux-amd64.deb
    rm -f cloudflared-linux-amd64.deb
  }
fi

echo -e "\n${BLUE}[4/6] Setting up Tukuk-OS Application...${NC}"
INSTALL_DIR="/opt/tukuk-os"
mkdir -p "$INSTALL_DIR"

if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
  if [[ -d "./src" && -f "./package.json" ]]; then
    cp -r ./* "$INSTALL_DIR/"
  else
    # The real repo is now PRIVATE (tukuk/tukuk-os). Cloning over HTTPS on a
    # new machine will FAIL without auth — recommended: bring the code on USB:
    #   sudo bash scripts/install-from-usb.sh
    # (The HTTPS clone below only works if the repo is made public / has a PAT.)
    git clone https://github.com/tukuk/tukuk-os.git "$INSTALL_DIR" || {
      echo "git clone failed (private repo). Use: sudo bash scripts/install-from-usb.sh" >&2
    }
  fi
fi

cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund

echo -e "\n${BLUE}[5/6] Creating Systemd Service for Tukuk-OS...${NC}"
# Not root: /api/admin/terminal runs shell commands as the service user, so root here
# would make any admin-session bug a root shell. setup-all.sh does the same in full.
SVC_USER="tukuk-os"
getent passwd "$SVC_USER" >/dev/null 2>&1 || \
  useradd --system --no-create-home --home-dir /var/lib/tukuk-os \
    --shell /usr/sbin/nologin --comment "Tukuk-OS web + search services" "$SVC_USER"
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/snapshots" "$INSTALL_DIR/dumps" "$INSTALL_DIR/meili_data"
for d in data snapshots dumps meili_data content/blog public/downloads; do
  [ -d "$INSTALL_DIR/$d" ] || continue
  chown -R "$SVC_USER:$SVC_USER" "$INSTALL_DIR/$d"
  chmod -R g+rwX "$INSTALL_DIR/$d"
  find "$INSTALL_DIR/$d" -type d -exec chmod g+s {} +
done
[[ -f "$INSTALL_DIR/.env" ]] && { chmod 600 "$INSTALL_DIR/.env"; setfacl -m "u:$SVC_USER:r--" "$INSTALL_DIR/.env" 2>/dev/null || true; }

cat > /etc/systemd/system/tukuk-os.service << EOF
[Unit]
Description=Tukuk-OS Search Engine (Lightweight Node.js)
After=network.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3
MemoryMax=1G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=yes
CapabilityBoundingSet=
ReadWritePaths=$INSTALL_DIR/data $INSTALL_DIR/content/blog $INSTALL_DIR/public/downloads

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tukuk-os

echo -e "\n${BLUE}[6/6] Verifying Server Status...${NC}"
sleep 2
if curl -s http://127.0.0.1:3000/health | grep -q '"status":"ok"'; then
  echo -e "${GREEN}✓ Tukuk-OS is running successfully on http://127.0.0.1:3000${NC}"
else
  echo -e "${RED}! Tukuk-OS is starting up. Check status with: systemctl status tukuk-os${NC}"
fi

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}   Setup Complete! Cloudflare Tunnel Connection:      ${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "To connect your domain (tukuk.org) with Cloudflare Tunnel:"
echo -e "1. Run:  cloudflared tunnel login"
echo -e "2. Run:  cloudflared tunnel create tukuk-tunnel"
echo -e "3. Run:  cloudflared tunnel route dns tukuk-tunnel tukuk.org"
echo -e "4. Run:  cloudflared tunnel run --url http://localhost:3000 tukuk-tunnel"
echo -e "Or create a service directly in Cloudflare Zero Trust Dashboard!"
echo -e "${BLUE}======================================================${NC}\n"
