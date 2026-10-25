#!/usr/bin/env bash
# Free the Tukuk VPS from its desktop/console stack. Everything switched off here
# is one `systemctl enable --now <unit>` away. Run as root over SSH:
#   ssh tukuk@<box> "echo <pw> | sudo -S bash /opt/tukuk-os/deploy/lighten-server.sh"
set -u

echo "=== BEFORE ==="
free -m | awk 'NR<=2{print}'
uptime

# What gets switched off, and why that is safe on this box:
#   lightdm                      -> the GUI login screen (its greeter burned 85% of a core for 3.5 days with nobody logged in)
#   Xorg                         -> dies with lightdm; tty1 falls back to text login (getty@tty1 stays)
#   avahi-*                      -> .local mDNS advertising
#   cups*, bluetooth, ModemManager -> printing, Bluetooth, cellular modems
#   smbd nmbd                    -> SMB/NetBIOS file sharing
#   udisks2 gpu-manager switcheroo-control apport -> removable-disk service, hybrid-GPU helpers, crash reporter
#   pmcd pmie pmlogger pmproxy   -> PCP telemetry daemons whose data nothing here reads
#   cockpit.socket               -> web admin console (unused; the admin panel is on tukuk.org)
#   snapd.*                      -> the snap daemon and its socket (see the block below: masked,
#                                  because socket activation would otherwise bring it straight back)
#   snapd.snap-repair / motd-news / fwupd-refresh timers -> background chatter
UNITS="lightdm avahi-daemon avahi-daemon.socket cups cups.socket cups.path cups-browsed bluetooth ModemManager smbd nmbd udisks2 gpu-manager switcheroo-control apport apport-forward.socket cockpit.socket pmcd pmie pmlogger pmproxy snapd.snap-repair.timer motd-news.timer fwupd-refresh.timer"

echo
echo "=== DISABLING ==="
for u in $UNITS; do
  if ! systemctl list-unit-files "$u" >/dev/null 2>&1; then
    echo "none  $u (unit not installed)"
    continue
  fi
  if systemctl disable --now "$u" >/dev/null 2>&1; then
    echo "off   $u"
  else
    echo "skip  $u (already off or never enabled)"
  fi
done

# udisks2, masked rather than disabled: it is D-Bus activated, so the next thing that asks for a
# disk — an apt hook, a udev event, a container runtime — starts it again. That is what happened on
# 23 Oct 2026: the daemon was back a day later, and the governor then warned "switched off on
# purpose but running" every 30 minutes, 77 times, for a process holding 3.6 MB. Masking is what
# makes "off" mean off. Undo: sudo systemctl unmask udisks2 && sudo systemctl start udisks2
systemctl stop udisks2 2>/dev/null
systemctl mask udisks2 >/dev/null 2>&1 && echo "mask  udisks2"

# snapd, masked rather than disabled: its own socket re-spawns the daemon on the
# first snap invocation, so `disable` alone would put it back. Measured on this box, the
# honest saving is NOT the 757 MB that `systemctl show -p MemoryCurrent` reported — that
# figure is mostly page cache of the mounted .snap files, which is reclaimable and stays
# cached either way (memAvail was 4734 MB before and 4732 MB after, within the noise).
# What goes away is a Go daemon with no job on this server, its background refresh scans,
# and the surprise of an unattended snap update. Nothing here uses a snap: the single
# gcloud reference in the tree is a fallback branch in scripts/play-upload.mjs, and the
# AAB it uploads is never built or stored on this box. The reclaim block below brings it back for
# one command and masks it again with the same function, so the end state is unchanged.
# Undo: sudo systemctl unmask snapd.service snapd.socket && sudo systemctl start snapd.socket
put_snapd_away() {
  for u in snapd.service snapd.socket snapd.seeded.service snapd.autoimport.service snapd.core-fixup.service snapd.recovery-chooser-trigger.service snapd.system-shutdown.service snapd.apparmor.service; do
    systemctl stop "$u" 2>/dev/null
    systemctl disable "$u" 2>/dev/null
    systemctl mask "$u" >/dev/null 2>&1 && echo "mask  $u"
  done
}
put_snapd_away

# Reclaim the 3.2 GB of /snap the masked daemon leaves behind, instead of only noting it. Measured
# on this box: google-cloud-cli 2.8G + core24 219M (the base that one CLI needed) + snapd 134M
# = 3.2G; after this block /snap is 134M. Disk was never the emergency (394 G free, 12% used), so
# state what this actually buys: a 2.8 GB toolchain that cannot run here goes away, and there is
# nothing left for an unattended snap update to wake up.
#
# snapd's own 134 MB is DELIBERATELY KEPT. scripts/load-governor.js already models "snapd present
# but masked" as the wanted state (MUST_STAY_OFF), and removing the package would let an Ubuntu
# upgrade put it back with no way to tell it not to. Masked, it costs no CPU and no RAM: after this
# block snapd.service is inactive and snapd.socket is masked, which is the state the governor wants.
#
# Guard before deleting anything: the gcloud CLI appears in this tree only as the ADC fallback
# branch of scripts/play-upload.mjs. Application Default Credentials are read by the googleapis
# library WITHOUT gcloud, so if they existed on this box that branch is live and the snap is doing
# something. Both homes are tested because this script runs as root while the only login that ever
# ran gcloud was tukuk's — reading $HOME here would have proven nothing either way.
if [ -f /home/tukuk/.config/gcloud/application_default_credentials.json ] ||
   [ -f /root/.config/gcloud/application_default_credentials.json ]; then
  echo "skip  /snap NOT reclaimed: ADC credentials exist, so scripts/play-upload.mjs may still use gcloud"
else
  echo "      no application_default_credentials.json in either home and no google-cloud-key.json"
  echo "      on the box, so that fallback has never been satisfiable from here. Removing the snaps."
  for u in snapd.service snapd.socket snapd.seeded.service snapd.autoimport.service snapd.core-fixup.service snapd.recovery-chooser-trigger.service snapd.system-shutdown.service snapd.apparmor.service; do
    systemctl unmask "$u" 2>/dev/null
  done
  systemctl start snapd.socket
  # `snap list` answering is the ONLY proof the daemon is reachable. Without that proof an empty
  # list reads as "no application snaps installed" and gets used to justify deleting a base: that
  # is exactly how one pass of this block hung for 20 minutes trying to start a unit it had not
  # unmasked first, then reported "app snaps left: none" about a daemon it could not talk to.
  # Absence of evidence is not evidence.
  SNAPD_UP=""
  for i in $(seq 15); do
    if snap list >/dev/null 2>&1; then SNAPD_UP=1; break; fi
    sleep 2
  done
  if [ -z "$SNAPD_UP" ]; then
    echo "skip  /snap NOT reclaimed: snapd did not answer 'snap list'"
  else
    snap list 2>/dev/null | awk 'NR>1 && /^[a-z0-9-]+ +[0-9]/ {print "snap  present: " $1}'
    if snap list 2>/dev/null | grep -q '^google-cloud-cli '; then
      snap remove --purge google-cloud-cli 2>&1 | tail -1 | sed 's/^/      /'
    fi
    # core24 is a base, so it may only go once no application snap needs it. Only the Name column
    # counts, after the header, and snapd's trailing "WARNING: There is 1 new warning." line is
    # rejected by requiring a version field that starts with a digit — the first version of this
    # check read that warning as an installed app and kept 219 MB behind for nothing. Both removals
    # are guarded by a presence check so re-running this script on an already-clean box is a no-op
    # instead of "snap core24 not found".
    APPS=$(snap list 2>/dev/null | awk 'NR>1 && $1 != "core24" && $1 != "snapd" && /^[a-z0-9-]+ +[0-9]/ {print $1}')
    if snap list 2>/dev/null | grep -q '^core24 '; then
      if [ -z "$APPS" ]; then
        snap remove --purge core24 2>&1 | tail -1 | sed 's/^/      /'
      else
        echo "note  keeping core24, these application snaps still need the base: $APPS"
      fi
    fi
  fi
  put_snapd_away
  du -sh /snap 2>/dev/null | sed 's/^/disk  /'
  # Backticks inside a double-quoted echo are EXECUTED. That is how one pass of this block ran
  # snap install google-cloud-cli and started re-downloading the 2.8 GB it had just deleted; it
  # only failed because snapd had been re-masked two lines earlier. So: no backticks, ever.
  echo 'undo  unmask + start snapd.socket, then:  snap install google-cloud-cli'
fi

# Stop the journal from growing its mmap set without bound (disk is not the issue,
# journald's resident set is). Written with a heredoc and then VERIFIED, not assumed. The printf
# that used to be here is correct in isolation — tested under bash and under sh — but on the box
# the file arrived as one junk line, `[Journal]nSystemMaxUse=150MnSystemKeepFree=1Gn`, literal n's
# where the newlines belonged, eaten by some quoting/transport layer on the way over. journald
# drops unparseable lines without a word, so a "150 MB" cap applied not at all and the journal sat
# at 253 MB until it was caught. A heredoc has no backslash for anything to lose, and the merged
# config is printed below so a reader sees what systemd actually read, not what was meant.
# Note: `journalctl --vacuum-size` is NOT proof the cap parses — it forces the size either way.
# Why 150M and not more: measured on this box after the cap was applied, 149 MB of journal holds
# 206,690 lines spanning Oct 17 -> Oct 23, i.e. about six days of history at normal traffic. That
# is long enough to answer "what was it doing when it got slow", so the cap does not need to grow
# to buy debugging headroom; it only has to stop journald from eating the mmap set unbounded.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/50-size.conf <<'CONF'
# How much disk the journal may take. The proof this file works is the merged view printed by this
# script, plus `journalctl --disk-usage` staying at or under SystemMaxUse — a broken drop-in is
# ignored silently, which is how 253 MB survived a 150 MB cap for a whole day.
[Journal]
SystemMaxUse=150M
SystemKeepFree=1G
CONF
systemctl daemon-reexec
systemctl restart systemd-journald && echo "on    journald capped at 150M"
echo "-- journald, as systemd merged it --"
# -A6 so the printed window includes the two settings, not just the section header: the whole
# point is showing that SystemMaxUse was read, and the first version cut at 4 lines and proved
# nothing about the values.
systemd-analyze cat-config systemd/journald.conf 2>/dev/null | grep -A6 '50-size.conf' | sed 's/^/      /'
journalctl --rotate
# tail -2: journald vacuums /run/log/journal and /var/log/journal separately and prints a line for
# each, so the last line alone reports only the runtime one ("freed 0B" from tmpfs) and hides the
# real file system it just trimmed.
journalctl --vacuum-size=150M 2>&1 | tail -2 | sed 's/^/      /'
journalctl --disk-usage | sed 's/^/      /'

echo
echo "=== DELIBERATELY KEPT (box is on WiFi and administered over SSH) ==="
for k in NetworkManager wpa_supplicant ssh chrony cron nginx cloudflared fwupd unattended-upgrades thermald tukuk-os meilisearch tukuk-agent tukuk-builder; do
  printf "%-20s active=%s enabled=%s\n" "$k" "$(systemctl is-active "$k" 2>/dev/null)" "$(systemctl is-enabled "$k" 2>/dev/null)"
done

echo
echo "=== AFTER ==="
free -m | awk 'NR<=2{print}'
uptime
echo "--- biggest resident set right now ---"
ps -eo comm,rss,pcpu --sort=-rss | head -12
