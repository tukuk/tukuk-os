#!/usr/bin/env bash
# ==============================================================================
# Direct Deployment Script from Laptop to Ubuntu Server (LAN IP — see TUKUK_HOST)
# The VPS is on DHCP, so its address drifts (was .105, now .100). Override per
# run:  TUKUK_HOST=192.168.8.110 bash deploy/remote-deploy.sh
# ==============================================================================

SERVER_USER="tukuk"
SERVER_IP="${TUKUK_HOST:-192.168.8.100}"
REMOTE_DIR="/opt/tukuk-os"

echo "=== Tukuk-OS Direct Remote Deployment ==="
echo "Target: $SERVER_USER@$SERVER_IP:$REMOTE_DIR"

# Check if sshpass is available
if ! command -v sshpass &> /dev/null; then
  echo "Installing sshpass for automated password login..."
  sudo apt-get update && sudo apt-get install -y sshpass
fi

PASSWORD="1"

echo "1. Creating remote directory if not exists..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "sudo mkdir -p $REMOTE_DIR && sudo chown -R $SERVER_USER:$SERVER_USER $REMOTE_DIR"

echo "2. Syncing project files to server..."
sshpass -p "$PASSWORD" rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'meili_data' --exclude 'dist' ./ "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

echo "3. Installing dependencies and restarting service on server..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && npm install --omit=dev && sudo systemctl restart tukuk-os || systemctl --user restart tukuk-os"

echo ""
echo "================================================================"
echo "✓ Deployment successful!"
echo "Open your browser at: http://$SERVER_IP:3000"
echo "Admin Panel: http://$SERVER_IP:3000/admin (login: email + passkey)"
echo "Note: .env (keys & CF_TUNNEL_TOKEN) is also synced by rsync in step 2."
echo "================================================================"
