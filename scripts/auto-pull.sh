#!/bin/bash
# Auto-pull from GitHub every 5 minutes
# This script safely updates the tukuk-os dev tree

cd /opt/tukuk-os

# Check if working tree is clean before pulling
if ! git diff-index --quiet HEAD --; then
    echo "[$(date)] Working tree has changes — stashing before pull"
    git stash push -m "auto-pull: uncommitted changes before update"
fi

# Pull from origin main
git pull origin main 2>&1

# If we stashed changes, try to pop them back
if git stash list | grep -q "auto-pull:"; then
    git stash pop 2>&1 || echo "[$(date)] Warning: stash pop had conflicts"
fi

# Run npm install if package.json changed
if git diff --name-only HEAD@{1} HEAD | grep -q package.json; then
    echo "[$(date)] package.json changed — running npm install"
    npm install --production 2>&1 | tail -5
fi

# Log the update
echo "[$(date)] Auto-update completed successfully" >> /opt/tukuk-os/logs/auto-update.log

# Optional: restart services if needed
# systemctl restart tukuk-os 2>/dev/null || true

exit 0
