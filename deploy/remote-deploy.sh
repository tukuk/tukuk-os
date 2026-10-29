#!/usr/bin/env bash
# ==============================================================================
# ⚠️ DEPRECATED — this is NOT the deploy path. `bash scripts/ship-to-box.sh` is.
# The difference is not style. This script rsync's the working tree over
# /opt/tukuk-os, and that tree is a git clone whose update (scripts/auto-update.sh)
# merges with --ff-only. Such a merge refuses, by design, when a file it is about to
# write is modified locally — the guard that stops a stray production edit being
# stamped over. Measured rather than assumed: dirt on a path the merge does not touch
# goes straight through, so this is about overlapping paths, not about any dirt.
# Files the rsync leaves differing from HEAD are exactly the ones a later upstream
# change has to overwrite, so the day main touches one of them the timer skips the
# merge, reports nothing interesting, and production ends up days behind main while
# every run looks green. Step 1 also `chown -R`s the whole directory to the login
# user, against the root-owned clone that git ops on the box depend on, and the rsync
# carries .env over the production one (keys, tokens, everything the server generated
# for itself).
#
# Kept for the one job git cannot do: bringing up a machine that has no clone yet.
# Say so explicitly, because nothing here should run by accident:
#   TUKUK_FORCE_RSYNC_DEPLOY=1 bash deploy/remote-deploy.sh
#
# The server password is no longer a literal in this file — it was, which made it
# visible in `ps`, in shell history and to everyone who can clone the repo. sshpass
# reads it from SSHPASS in the environment instead. LAN IP drifts on DHCP (was .105,
# now .100): override per run with TUKUK_HOST=192.168.8.110.
# ==============================================================================
if [[ "${TUKUK_FORCE_RSYNC_DEPLOY:-}" != "1" ]]; then
  echo "deploy/remote-deploy.sh: REFUSING to run — this is not how production deploys." >&2
  echo "  Use: bash scripts/ship-to-box.sh   (git push + tukuk-update.service, verified)" >&2
  echo "  rsync'ing tracked files dirties /opt/tukuk-os, and auto-update.sh then skips" >&2
  echo "  the merge rather than overwrite them — silently, as far as the timer is concerned." >&2
  echo "  Provisioning a box with no clone yet: TUKUK_FORCE_RSYNC_DEPLOY=1 bash deploy/remote-deploy.sh" >&2
  exit 1
fi

SERVER_USER="tukuk"
SERVER_IP="${TUKUK_HOST:-192.168.8.100}"
REMOTE_DIR="/opt/tukuk-os"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "deploy/remote-deploy.sh: SSHPASS is not set in the environment (sshpass -e needs it)." >&2
  exit 1
fi
if ! command -v sshpass &> /dev/null; then
  echo "Installing sshpass for automated password login..."
  sudo apt-get update && sudo apt-get install -y sshpass
fi

echo "=== Tukuk-OS Direct Remote Deployment (forced) ==="
echo "Target: $SERVER_USER@$SERVER_IP:$REMOTE_DIR"

echo "1. Creating remote directory if not exists..."
sshpass -e ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "sudo mkdir -p $REMOTE_DIR && sudo chown -R $SERVER_USER:$SERVER_USER $REMOTE_DIR"

echo "2. Syncing project files to server..."
sshpass -e rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'meili_data' --exclude 'dist' ./ "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

echo "3. Installing dependencies and restarting service on server..."
sshpass -e ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && npm install --omit=dev && sudo systemctl restart tukuk-os || systemctl --user restart tukuk-os"

echo "4. Purging the Cloudflare edge cache..."
# Restarting the service does not reach users on its own. Measured at the edge on
# 29 Oct 2026: CSS/JS go out with `s-maxage=300, stale-while-revalidate=600` (theme.css
# returned cf-cache-status: HIT, theme.js REVALIDATED), rendered HTML comes back DYNAMIC
# so pages are effectively live at once, and images/icons/fonts carry `s-maxage=604800` —
# a week. The purge is therefore about changed assets, not changed pages. It runs on the
# server because that is where a Cloudflare token lives, and today it will still fail:
# the VPS token verifies active but sees zero zones (deploy/purge-edge-cache.sh header).
sshpass -e ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && bash deploy/purge-edge-cache.sh" \
  || echo "   ⚠ purge failed — CSS/JS clear themselves in ~5 min; a changed image or icon can take a week"

echo ""
echo "================================================================"
echo "✓ Deployment successful!"
echo "Open your browser at: http://$SERVER_IP:3000"
echo "Admin Panel: http://$SERVER_IP:3000/admin (login: email + passkey)"
echo "Note: .env (keys & CF_TUNNEL_TOKEN) is ALSO rsynced in step 2 — on a box that has"
echo "      generated its own values, that is a destructive step. Check before running."
echo "================================================================"
