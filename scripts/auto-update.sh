#!/usr/bin/env bash
# ==============================================================================
# auto-update.sh — FULL one-line update: git → (npm) → restart service.
#
#   npm run update            (manual, on the server; needs root)
#   tukuk-update.timer        (daily, automatic — installed by setup-all.sh)
#
# SMART chain (avoids load + hangs on a slow VPS):
#   git fetch + merge --ff-only → if there are NO new commits: exit immediately.
#   if there are: run `npm install` ONLY when package.json/package-lock changed
#   (satu-kata/code/README don't touch dependencies → skip the heavy native download
#   like onnxruntime that can hang), then `systemctl restart
#   tukuk-os` so the new code is loaded. The systemd unit & tunnel are already
#   installed by setup-all.sh, so there's no need for the full postinstall chain daily.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

INSTALL_DIR="/opt/tukuk-os"
if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
  echo "[auto-update] only designed to run in $INSTALL_DIR (currently in $(pwd)) — skip."
  exit 0
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "[auto-update] needs root:  sudo bash scripts/auto-update.sh"
  exit 1
fi

BRANCH="$(grep -E '^GIT_BRANCH=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
BRANCH="${BRANCH:-main}"

# Our own AI model (Tukuk-Brain Mini): retrain from the latest
# production logs. SOFT failure — taskrouter stays regex-only if there is no file.
train_brain() {
  if node scripts/train-brain.js >/tmp/train-brain.log 2>&1; then
    grep -E 'external probes|saved' /tmp/train-brain.log | sed 's/^/[auto-update] /'
  else
    echo "[auto-update] warning: train-brain failed — continuing with old/regex-only model."
  fi
}

echo "[auto-update] $(date -Is) — pulling origin/$BRANCH ..."
OLD="$(git rev-parse HEAD)"
git fetch origin "$BRANCH" || { echo "[auto-update] git fetch failed (network?) — skip this cycle."; exit 0; }
if ! git merge --ff-only "origin/$BRANCH"; then
  echo "[auto-update] working tree changed/diverged — no auto-merge for safety. Check: git status"
  exit 0
fi
NEW="$(git rev-parse HEAD)"

if [[ "$OLD" == "$NEW" ]]; then
  echo "[auto-update] no new update (at $OLD) — skip npm & restart."
  # Still TRAIN the brain model — production logs (ask/search) grow more today.
  train_brain
  exit 0
fi
echo "[auto-update] update $OLD → $NEW."

# Only reinstall when dependencies truly changed. This avoids `npm install`
# daily re-fetching the heavy native binary (onnxruntime ~300MB) that can HANG
# on a slow network, and avoids needless reloads.
if git diff --quiet "$OLD" "$NEW" -- package.json package-lock.json; then
  echo "[auto-update] package.json/lock unchanged — skip npm install."
else
  echo "[auto-update] dependencies changed → npm install --omit=dev ..."
  npm install --omit=dev || echo "[auto-update] WARNING: npm install failed (code $?) — continuing to restart."
fi

# Source code may have changed → restart so the process loads new logic (Express
# routes in memory, static mounts, blog index). The unit/tunnel already exist.
# Train the model FIRST — the first restart brings the brain + latest model file.
train_brain
echo "[auto-update] restart tukuk-os ..."
systemctl restart tukuk-os

echo "[auto-update] $(date -Is) — done. Tukuk-OS is now on commit: $(git rev-parse --short HEAD)"
