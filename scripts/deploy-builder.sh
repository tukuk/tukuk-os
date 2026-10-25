#!/usr/bin/env bash
# deploy-builder.sh — send the Tukuk Builder fork (bolt.diy) to the server over the LAN.
#
# USAGE:
#   1) Once on the server: the systemd + env files already live in deploy/.
#   2) On the laptop: node scripts/lint.js, then run this script.
#
# What happens: rsync source (without node_modules/.git/build) to
# /opt/tukuk-builder, install dependencies + build ON THE SERVER (node22 is
# already there), then restart tukuk-builder.service. The first pass is slow (the
# pnpm download is ~1-2 GB); after that it is incremental only.
set -euo pipefail

HOST="${BUILDER_HOST:-tukuk@${TUKUK_HOST:-192.168.8.105}}"
PASS="${1:-${BUILDER_PASS:-1}}"
DEST="/opt/tukuk-builder"
SRC="$(cd "$(dirname "$0")/.." && pwd)/bolt.diy"

ssh_run() { sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$HOST" "echo $PASS | sudo -S $1"; }

echo "[builder] rsync source → $DEST"
# NOTE: sudo -S ONLY applies to the first command — an && chain must be wrapped in sh -c.
ssh_run "sh -c 'mkdir -p $DEST && chown -R tukuk:tukuk $DEST'" || true
rsync -a --delete -e "sshpass -p $PASS ssh -o StrictHostKeyChecking=no" \
  --exclude .git --exclude node_modules --exclude build --exclude dist \
  --exclude .env.local \
  --exclude benchmarks --exclude e2e-tests --exclude playwright-report \
  "$SRC/" "$HOST:$DEST/"

echo "[builder] install pnpm (once) + install + build on the server"
# All via sh -c: sudo -S only applies to the first command, and
# the `command`/`cd` builtins cannot be piped straight into sudo.
ssh_run "sh -c 'corepack disable >/dev/null 2>&1 || true; command -v pnpm >/dev/null || npm i -g pnpm@9.15.9 --silent; pnpm -v'"
ssh_run "sh -c 'cd $DEST && pnpm install --frozen-lockfile --prefer-offline 2>&1 | tail -3'"
ssh_run "sh -c 'cd $DEST && pnpm build 2>&1 | tail -5'"

echo "[builder] ship the wake-on-request front door (lives in the main repo, not the fork)"
# builder-wakekeeper.js + its unit own port 5174 (what cloudflared reaches) and forward to the
# builder here on 5176. They are part of THIS repo's deploy/, so copy them to the server's
# /opt/tukuk-os/deploy rather than relying on the main-repo checkout being up to date.
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)/deploy"
sshpass -p "$PASS" scp -o StrictHostKeyChecking=no "$DEPLOY_DIR/builder-wakekeeper.js" "$DEPLOY_DIR/tukuk-builder-wake.service" "$HOST:/tmp/" || true
ssh_run "sh -c 'mv /tmp/builder-wakekeeper.js /tmp/tukuk-builder-wake.service /opt/tukuk-os/deploy/ && chmod +x /opt/tukuk-os/deploy/builder-wakekeeper.js'" || true

echo "[builder] install systemd units + restart"
ssh_run "sh -c 'cp /opt/tukuk-os/deploy/tukuk-builder.service /opt/tukuk-os/deploy/tukuk-builder-wake.service /etc/systemd/system/ && systemctl daemon-reload'"
ssh_run "systemctl enable tukuk-builder tukuk-builder-wake >/dev/null 2>&1 || true"
ssh_run "systemctl restart tukuk-builder-wake"   # front door first, so 5174 is never briefly empty
ssh_run "systemctl restart tukuk-builder"
sleep 3
# builder origin (5176) must answer directly; the front door (5174) must proxy it end to end.
ssh_run "systemctl is-active tukuk-builder && curl -s -o /dev/null -w 'builder:5176 http=%{http_code}\n' http://127.0.0.1:5176/"
ssh_run "curl -s -o /dev/null -w 'frontdoor:5174 http=%{http_code}\n' -H 'Host: build.tukuk.org' http://127.0.0.1:5174/"
echo "[builder] done. https://build.tukuk.org (the second connector cloudflared-build — legacy tunnel, see deploy/cloudflared/config-build.example.yml) and https://dashboard.tukuk.org (the primary remote-config tunnel) both serve Builder; do not drop allowedHosts .tukuk.org in vite.config.ts."
