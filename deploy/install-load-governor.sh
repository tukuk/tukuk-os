#!/usr/bin/env bash
# Install the load governor on the server. Everything it needs is already in the repo, so this
# only places the two unit files, turns the timer on and shows the first sample.
# Run as root over SSH:
#   ssh tukuk@<box> "echo <pw> | sudo -S bash /opt/tukuk-os/deploy/install-load-governor.sh"
set -uo pipefail

SRC=/opt/tukuk-os/deploy

for u in load-governor.service load-governor.timer; do
  if [ ! -f "$SRC/$u" ]; then echo "MISSING $SRC/$u — git pull first"; exit 1; fi
  install -m 644 "$SRC/$u" "/etc/systemd/system/$u" && echo "installed $u"
done

systemctl daemon-reload
systemctl enable --now load-governor.timer && echo "timer enabled"

# One sample straight away so the admin panel has something to show.
systemctl start load-governor.service
echo "--- first sample ---"
journalctl -u load-governor.service -n 6 --no-pager -o cat

echo
echo "--- timer state ---"
systemctl list-timers load-governor.timer --no-pager | head -3

echo
echo "--- snapshot on disk ---"
ls -l /opt/tukuk-os/data/load-*.json 2>/dev/null
node -e '
  const s = JSON.parse(require("fs").readFileSync("/opt/tukuk-os/data/load-snapshot.json", "utf8"));
  const h = s.host;
  console.log(`load ${h.load1} / ${h.cores} cores (${h.loadPerCore1}x)  free ${h.memAvailMb}/${h.memTotalMb} MB  swap ${h.swapUsedMb} MB  services ${s.services.length}  scanned ${s.processesScanned}`);
  for (const x of s.services) console.log(`  ${x.unit.padEnd(24)} ${String(x.state).padEnd(16)} mem=${x.memoryMb ?? "-"} MB cpu=${x.cpuPct ?? "-"}% restarts=${x.restarts}`);
' 2>&1 | sed 's/^/   /'

echo
echo "Second sample in ~2 min will add CPU rates (they need a previous sighting)."
exit 0
