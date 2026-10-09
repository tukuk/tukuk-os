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
    # Repo sebenar kini PRIVATE (fevian448/tukuk-os-v2). Clone HTTPS di mesin
    # baru akan GAGAL tanpa auth — disyorkan bawa kod guna USB:
    #   sudo bash scripts/install-from-usb.sh
    # (Klon HTTPS di bawah hanya berfungsi jika repo dijadikan public / ada PAT.)
    git clone https://github.com/fevian448/tukuk-os-v2.git "$INSTALL_DIR" || {
      echo "git clone gagal (repo private). Gunakan: sudo bash scripts/install-from-usb.sh" >&2
    }
  fi
fi

cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund

echo -e "\n${BLUE}[5/6] Creating Systemd Service for Tukuk-OS...${NC}"
cat > /etc/systemd/system/tukuk-os.service << 'EOF'
[Unit]
Description=Tukuk-OS Search Engine (Lightweight Node.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/tukuk-os
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production
Environment=NODE_OPTIONS="--max-old-space-size=768"
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3
MemoryMax=1G

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
