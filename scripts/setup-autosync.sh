#!/usr/bin/env bash
# ==============================================================================
# setup-autosync.sh — turn /opt/tukuk-os into a real git clone so that
# tukuk-update.timer (root, 04:30) auto-pulls new words + code.
#
#   • Auth: read-only SSH deploy key (/root/.ssh/tukuk_deploy) — no token baked
#     into the URL, no interactive login.
#   • Align the working tree to origin/main using `git reset --hard` — files NOT
#     tracked by git (data/, .env, node_modules) stay safe.
#   • Idempotent: can be re-run safely.
# ==============================================================================
set -uo pipefail

REPO="/opt/tukuk-os"
REMOTE="git@github.com:fevian448/tukuk-os-v2.git"
BRANCH="main"

[[ "${EUID}" -eq 0 ]] || { echo "[autosync] run as root: sudo bash $0"; exit 1; }
cd "$REPO" || { echo "[autosync] $REPO missing"; exit 1; }

# 1) SSH config for the deploy key (root) ------------------------------------------
mkdir -p /root/.ssh; chmod 700 /root/.ssh
if ! grep -q "^Host github.com" /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<'CFG'
Host github.com
  User git
  IdentityFile /root/.ssh/tukuk_deploy
  IdentitiesOnly yes
CFG
  chmod 600 /root/.ssh/config
fi
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true
sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts 2>/dev/null || true

# 2) Let git access a dir owned by another user (we run as root) -------------
# IMPORTANT: use `--system` (/etc/gitconfig), NOT `--global`. The systemd timer
# runs auto-update with an EMPTY $HOME, so git does NOT read
# ~/.gitconfig — safe.directory only takes effect if it is in the system config.
git config --system --add safe.directory "$REPO" 2>/dev/null || true
git config --global --add safe.directory "$REPO" 2>/dev/null || true

# 3) Test SSH auth ------------------------------------------------------------
echo "=== ssh -T git@github.com (expect: successfully authenticated) ==="
ssh -T git@github.com -o StrictHostKeyChecking=accept-new 2>&1 | head -2 || true

# 4) Init + remote + align to origin/main --------------------------------
if [[ ! -d "$REPO/.git" ]]; then
  echo "[autosync] git init (branch $BRANCH) ..."
  git init -q -b "$BRANCH" "$REPO"
else
  echo "[autosync] .git already exists — skip init."
fi

git -C "$REPO" remote remove origin 2>/dev/null || true
git -C "$REPO" remote add origin "$REMOTE"

echo "[autosync] fetch origin/$BRANCH ..."
if ! git -C "$REPO" fetch -q origin "$BRANCH"; then
  echo "[autosync] FAILED: fetch origin/$BRANCH (auth/network?)"
  exit 1
fi

echo "[autosync] reset --hard origin/$BRANCH (keep untracked: data/, .env, node_modules) ..."
git -C "$REPO" reset -q --hard "origin/$BRANCH"

echo "=== result: branch / HEAD / origin ==="
git -C "$REPO" rev-parse --abbrev-ref HEAD
echo "HEAD=$(git -C "$REPO" rev-parse --short HEAD)  origin=$(git -C "$REPO" rev-parse --short origin/$BRANCH)"
echo "=== status (empty = clean, auto-merge will run) ==="
git -C "$REPO" status -sb | head -5
echo "[autosync] DONE."
