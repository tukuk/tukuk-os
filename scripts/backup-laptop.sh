#!/usr/bin/env bash
# ==============================================================================
# backup-laptop.sh — nightly copy of the VPS runtime data/ onto THIS laptop.
#
# Why: the R2 offsite track (tukuk-data-backup.timer) uploads through a
# *.workers.dev endpoint that Cloudflare now platform-throttles (429), and the
# zone's own security rules block every new upload hostname (README §9 — edge
# must stay workerless). Until the R2 path is re-opened (needs a dashboard
# permission change), the laptop is the second device that survives a server
# disk death: one sudo tar pipe over SSH, 14 daily files kept.
#
# Runs from the systemd USER timer (tukuk-laptop-backup.timer, Persistent=true)
# so a laptop that was off at 03:45 catches up on next power-on.
# USE:  bash scripts/backup-laptop.sh          (interactive sshpass or key)
# RESTORE: tar xzf ~/tukuk-backups/data-<date>.tar.gz -C /opt/tukuk-os
# ==============================================================================
set -uo pipefail

DEST_DIR="${HOME}/tukuk-backups"
SSH_PASS="${TUKUK_SSH_PASS:-1}"                      # same LAN cred as every deploy flow
KEEP_DAYS=14
mkdir -p "$DEST_DIR"

# --- find the box: LAN address drifts (verified pattern), try both known IPs ---
HOST=""
for ip in 192.168.8.101 192.168.8.100; do
  if sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password \
       -o PubkeyAuthentication=no -o ConnectTimeout=4 "tukuk@$ip" true 2>/dev/null; then
    HOST="$ip"; break
  fi
done
if [[ -z "$HOST" ]]; then
  echo "[laptop-backup] ERROR: server unreachable on LAN (.101/.100) — nothing done." >&2
  exit 1
fi

KEY="$DEST_DIR/data-$(date +%Y%m%d).tar.gz"
echo "[laptop-backup] pulling /opt/tukuk-os/data from $HOST ..."
# sudo -S feeds the password on stdin; tar streams the tree so live files are
# snapshotted in one pass (rc 1 = "file changed as we read it" → still valid).
sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no "tukuk@$HOST" \
    "echo $SSH_PASS | sudo -S -p '' tar czf - -C /opt/tukuk-os data" > "$KEY"
RC=$?
SIZE=$(du -h "$KEY" 2>/dev/null | cut -f1)
# rc 1 from tar = "file changed as we read it" (data/ is live-written) — archive
# is still valid; only >=2 is a real failure (the classic hourly-tar race pitfall).
if [[ $RC -ge 2 || -z "$SIZE" ]]; then
  echo "[laptop-backup] ERROR: pipe failed (rc=$RC)" >&2
  rm -f "$KEY"; exit 1
fi
[[ $RC -eq 1 ]] && echo "[laptop-backup] WARN: a file changed mid-read — continuing with usable archive" >&2
echo "[laptop-backup] ✓ $KEY ($SIZE) [host=$HOST]"

# --- retention: drop dailies older than KEEP_DAYS ---
find "$DEST_DIR" -name 'data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null
echo "[laptop-backup] kept: $(ls -1 "$DEST_DIR"/data-*.tar.gz 2>/dev/null | wc -l) file(s), newest $(date -r "$(ls -1t "$DEST_DIR"/data-*.tar.gz 2>/dev/null | head -1)" +%F 2>/dev/null)"
