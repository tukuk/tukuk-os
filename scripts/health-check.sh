#!/bin/bash
# Health check script for tukuk-os server
# Runs as part of auto-update cron

cd /opt/tukuk-os

echo "[$(date)] Health check starting..."

# Check git status
git status --short > /tmp/health-status.txt 2>&1

# Check for any uncommitted changes
if [ -s /tmp/health-status.txt ]; then
    echo "[$(date)] ⚠️ Working tree has uncommitted changes"
else
    echo "[$(date)] ✅ Working tree clean"
fi

# Check latest commit
LATEST=$(git log -1 --oneline)
echo "[$(date)] Latest commit: $LATEST"

# Check if repo is up to date with origin
BEHIND=$(git log HEAD..origin/main --oneline | wc -l)
if [ "$BEHIND" -gt 0 ]; then
    echo "[$(date)] 📡 $BEHIND commit(s) behind origin/main"
else
    echo "[$(date)] ✅ Up to date with origin/main"
fi

# Check disk space
DF=$(df -h /opt/tukuk-os | awk 'NR==2 {print $5}' | tr -d '%')
echo "[$(date)] Disk usage: ${DF}%"

# Check node process
if pgrep -x "node" > /dev/null; then
    echo "[$(date)] ✅ Node process running"
else
    echo "[$(date)] ⚠️ No node process found"
fi

echo "[$(date)] Health check completed"
exit 0
