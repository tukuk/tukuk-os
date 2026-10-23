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

# Stop the journal from growing its mmap set without bound (disk is not the issue,
# journald's resident set is).
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=150M\nSystemKeepFree=1G\n' > /etc/systemd/journald.conf.d/50-size.conf
systemctl restart systemd-journald && echo "on    journald capped at 150M"

echo
echo "=== DELIBERATELY KEPT (box is on WiFi and administered over SSH) ==="
for k in NetworkManager wpa_supplicant ssh chrony cron nginx cloudflared snapd fwupd unattended-upgrades thermald tukuk-os meilisearch tukuk-agent tukuk-builder; do
  printf "%-20s active=%s enabled=%s\n" "$k" "$(systemctl is-active "$k" 2>/dev/null)" "$(systemctl is-enabled "$k" 2>/dev/null)"
done

echo
echo "=== AFTER ==="
free -m | awk 'NR<=2{print}'
uptime
echo "--- biggest resident set right now ---"
ps -eo comm,rss,pcpu --sort=-rss | head -12
