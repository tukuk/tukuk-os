#!/usr/bin/env bash
# Install the Drive off-site backup on the server. Run as root over SSH:
#   ssh tukuk@<box> "sudo bash /opt/tukuk-os/deploy/install-drive-backup.sh"
#
# What it does, in order:
#   1. moves the bot key out of the home directory to /etc/tukuk-os (root-only 600).
#      A key that can write to the backup folder must not sit where any readable
#      process or stray `git add` can reach it.
#   2. places the two unit files and enables the nightly timer.
#   3. runs one dry backup so the archives (and git bundle verify) prove they work.
set -uo pipefail

SRC=/opt/tukuk-os/deploy
KEY_HOME=/home/tukuk/gdrive-key.json
KEY_ETC=/etc/tukuk-os/gdrive-key.json

# 1. the key
if [ -f "$KEY_ETC" ]; then
  echo "key already at $KEY_ETC"
elif [ -f "$KEY_HOME" ]; then
  mkdir -p /etc/tukuk-os
  install -m 600 -o root -g root "$KEY_HOME" "$KEY_ETC" && rm -f "$KEY_HOME" \
    && echo "moved key -> $KEY_ETC (root:root 600; home copy removed)"
else
  echo "NO KEY FOUND at $KEY_HOME or $KEY_ETC — the timer will report the missing key and skip upload."
fi

# 2. the units
for u in drive-backup.service drive-backup.timer; do
  if [ ! -f "$SRC/$u" ]; then echo "MISSING $SRC/$u — git pull first"; exit 1; fi
  install -m 644 "$SRC/$u" "/etc/systemd/system/$u" && echo "installed $u"
done
systemctl daemon-reload
systemctl enable --now drive-backup.timer && echo "timer enabled"

# 3. prove the archives build, without uploading
echo "--- dry run (archives only, no upload) ---"
cd /opt/tukuk-os && node scripts/drive-backup.js --dry

echo
echo "Next step is human, not scripted:"
echo "  1. In Drive (tukuk.co@gmail.com), create folder \"tukuk-backups\"."
echo "  2. Share it with the bot as Contributor:"
echo "     gdrive-bot@tukuk-org-web.iam.gserviceaccount.com"
echo "  3. Put the folder id (from its url) into the server env:"
echo "     echo 'GDRIVE_FOLDER_ID=<id>' >> /opt/tukuk-os/.env && systemctl restart tukuk-os"
echo "  4. Test a real upload:  systemctl start drive-backup.service"
echo "     then:  ls -l /opt/tukuk-os/data/backup-last.json"
exit 0
