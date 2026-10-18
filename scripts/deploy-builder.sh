#!/usr/bin/env bash
# deploy-builder.sh — hantar fork Tukuk Builder (bolt.diy) ke pelayan melalui LAN.
#
# GUNA:
#   1) Sekali sahaja di pelayan: fail systemd + env sudah ada di deploy/.
#   2) Di laptop: node scripts/lint.js, kemudian jalankan skrip ini.
#
# Apa yang berlaku: rsync source (tanpa node_modules/.git/build) ke
# /opt/tukuk-builder, pasang dependensi + bina DI PELAYAN (node22 sudah ada),
# kemudian restart tukuk-builder.service. Ansuhan pertama lambat (.muat turun
# pnpm ~1-2 GB); selepas itu increment sahaja.
set -euo pipefail

HOST="${BUILDER_HOST:-tukuk@192.168.8.103}"
PASS="${1:-${BUILDER_PASS:-1}}"
DEST="/opt/tukuk-builder"
SRC="$(cd "$(dirname "$0")/.." && pwd)/bolt.diy"

ssh_run() { sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$HOST" "echo $PASS | sudo -S $1"; }

echo "[builder] rsync source → $DEST"
# NOTE: sudo -S HANYA terpakai pada perintah pertama — rantai && mesti dibalut sh -c.
ssh_run "sh -c 'mkdir -p $DEST && chown -R tukuk:tukuk $DEST'" || true
rsync -a --delete -e "sshpass -p $PASS ssh -o StrictHostKeyChecking=no" \
  --exclude .git --exclude node_modules --exclude build --exclude dist \
  --exclude .env.local \
  --exclude benchmarks --exclude e2e-tests --exclude playwright-report \
  "$SRC/" "$HOST:$DEST/"

echo "[builder] pasang pnpm (sekali) + install + build di pelayan"
# Semua melalui sh -c: sudo -S hanya terpakai pada perintah pertama, dan
# `command`/`cd` builtin tidak boleh dilalukan terus ke sudo.
ssh_run "sh -c 'corepack disable >/dev/null 2>&1 || true; command -v pnpm >/dev/null || npm i -g pnpm@9.15.9 --silent; pnpm -v'"
ssh_run "sh -c 'cd $DEST && pnpm install --frozen-lockfile --prefer-offline 2>&1 | tail -3'"
ssh_run "sh -c 'cd $DEST && pnpm build 2>&1 | tail -5'"

echo "[builder] pasang systemd unit + restart"
ssh_run "sh -c 'cp /opt/tukuk-os/deploy/tukuk-builder.service /etc/systemd/system/ && systemctl daemon-reload'"
ssh_run "systemctl enable tukuk-builder >/dev/null 2>&1 || true"
ssh_run "systemctl restart tukuk-builder"
sleep 2
ssh_run "systemctl is-active tukuk-builder && curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:5174/"
echo "[builder] siap. https://build.tukuk.org (connector kedua cloudflared-build — tunnel legacy, lihat deploy/cloudflared/config-build.example.yml) dan https://dashboard.tukuk.org (remote-config tunnel utama) kedua-duanya hidang Builder; allowedHosts .tukuk.org dalam vite.config.ts jangan dibuang."
