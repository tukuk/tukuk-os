#!/usr/bin/env bash
# ==============================================================================
# setup-autosync.sh — tukar /opt/tukuk-os jadi git clone asli supaya
# tukuk-update.timer (root, 04:30) auto-pull kata + kod baharu.
#
#   • Auth: SSH deploy key read-only (/root/.ssh/tukuk_deploy) — TANCA token
#     dalam URL, TANPA login interaktif.
#   • Selari working tree ke origin/main guna `git reset --hard` — fail yang
#     TIDAK dilacak git (data/, .env, node_modules) KEKAL selamat.
#   • Idempotent: boleh jalan ulang dengan selamat.
# ==============================================================================
set -uo pipefail

REPO="/opt/tukuk-os"
REMOTE="git@github.com:fevian448/tukuk-os-v2.git"
BRANCH="main"

[[ "${EUID}" -eq 0 ]] || { echo "[autosync] jalan sebagai root: sudo bash $0"; exit 1; }
cd "$REPO" || { echo "[autosync] $REPO tiada"; exit 1; }

# 1) SSH config utk deploy key (root) ------------------------------------------
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

# 2) Git boleh akses dir milik user lain (kita jalan sebagai root) -------------
git config --global --add safe.directory "$REPO" 2>/dev/null || true

# 3) Ujian auth SSH ------------------------------------------------------------
echo "=== ssh -T git@github.com (expect: successfully authenticated) ==="
ssh -T git@github.com -o StrictHostKeyChecking=accept-new 2>&1 | head -2 || true

# 4) Init + remote + selaraskan ke origin/main --------------------------------
if [[ ! -d "$REPO/.git" ]]; then
  echo "[autosync] git init (branch $BRANCH) ..."
  git init -q -b "$BRANCH" "$REPO"
else
  echo "[autosync] .git sudah wujud — langkau init."
fi

git -C "$REPO" remote remove origin 2>/dev/null || true
git -C "$REPO" remote add origin "$REMOTE"

echo "[autosync] fetch origin/$BRANCH ..."
if ! git -C "$REPO" fetch -q origin "$BRANCH"; then
  echo "[autosync] GAGAL: fetch origin/$BRANCH (auth/rangkaian?)"
  exit 1
fi

echo "[autosync] reset --hard origin/$BRANCH (kekal untracked: data/, .env, node_modules) ..."
git -C "$REPO" reset -q --hard "origin/$BRANCH"

echo "=== keputusan: branch / HEAD / origin ==="
git -C "$REPO" rev-parse --abbrev-ref HEAD
echo "HEAD=$(git -C "$REPO" rev-parse --short HEAD)  origin=$(git -C "$REPO" rev-parse --short origin/$BRANCH)"
echo "=== status (kosong = bersih, auto-merge akan jalan) ==="
git -C "$REPO" status -sb | head -5
echo "[autosync] SELESAI."
