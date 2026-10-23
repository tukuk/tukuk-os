#!/usr/bin/env bash
# Put the Tukuk Builder on an idle stop/keep it up.
#
#   sudo bash /opt/tukuk-os/deploy/install-builder-idle.sh stop-now
#   sudo bash /opt/tukuk-os/deploy/install-builder-idle.sh keep      # pin it up, timer stays off
#   sudo bash /opt/tukuk-os/deploy/install-builder-idle.sh sleep     # install units + turn the timer on
#   sudo bash /opt/tukuk-os/deploy/install-builder-idle.sh wake      # start the builder again
#   sudo bash /opt/tukuk-os/deploy/install-builder-idle.sh status    # what it would decide, right now
#
# `sleep` is the mode that saves the memory: it installs the two units and enables the timer,
# so the builder is stopped the next time it has been idle for three hours. `keep` is what to
# run before a long building session — it starts the builder and leaves the timer disabled, so
# nothing stops it mid-work.
set -uo pipefail

SRC=/opt/tukuk-os/deploy
UNITS=(tukuk-builder.service cloudflared-build.service)
KEEP=/etc/tukuk-builder-keep
MODE=${1:-status}

step() { echo "[builder-idle-install] $*"; }
have_units() {
  for u in builder-idle-stop.service builder-idle-stop.timer; do
    [ -f "$SRC/$u" ] || { step "MISSING $SRC/$u — git pull first"; exit 1; }
    install -m 644 "$SRC/$u" "/etc/systemd/system/$u" && step "installed $u"
  done
  [ -f "$SRC/builder-idle-stop.sh" ] || { step "MISSING $SRC/builder-idle-stop.sh"; exit 1; }
  chmod +x "$SRC/builder-idle-stop.sh"
  systemctl daemon-reload
}
report() { bash "$SRC/builder-idle-stop.sh" --dry-run; }

case "$MODE" in
  stop-now)
    systemctl stop "${UNITS[@]}" && step "stopped ${UNITS[*]}"
    ;;

  keep)
    rm -f "$KEEP"
    systemctl stop builder-idle-stop.timer 2>/dev/null || true
    systemctl disable builder-idle-stop.timer 2>/dev/null || true
    systemctl start "${UNITS[0]}" || step "tukuk-builder did not start — check: journalctl -u tukuk-builder -n 30"
    step "builder is up and the idle timer is OFF — it will not be stopped while you work"
    ;;

  sleep)
    have_units
    rm -f "$KEEP"
    systemctl enable --now builder-idle-stop.timer && step "timer enabled — the builder goes to sleep after 3 idle hours"
    systemctl start builder-idle-stop.service
    step "the check that just ran:"
    report
    ;;

  wake)
    systemctl start "${UNITS[0]}" "${UNITS[1]}" || step "start failed — check: journalctl -u tukuk-builder -n 30"
    for i in $(seq 1 20); do
      curl -fsS -m 3 -o /dev/null http://127.0.0.1:5174/ && { step "answering on :5174 after $((i * 2))s"; break; }
      sleep 2
    done
    curl -fsS -m 3 -o /dev/null http://127.0.0.1:5174/ || step "still not answering on :5174 — check: journalctl -u tukuk-builder -n 30"
    ;;

  status)
    [ -f /etc/systemd/system/builder-idle-stop.timer ] && step "units installed: yes (timer $(systemctl is-enabled builder-idle-stop.timer 2>/dev/null || echo no))" \
      || step "units installed: no — the builder will run forever until this is run in sleep mode"
    step "builder: $(systemctl is-active tukuk-builder.service), holds $(($(systemctl show tukuk-builder.service -p MemoryCurrent --value 2>/dev/null || echo 0)/1048576)) MB"
    [ -e "$KEEP" ] && step "$KEEP exists — the builder is pinned up"
    report
    ;;

  *) step "unknown mode '$MODE' — use: stop-now | keep | sleep | wake | status"; exit 1 ;;
esac

echo
echo "--- what is holding memory now ---"
for u in "${UNITS[@]}" tukuk-os.service meilisearch.service; do
  step "$(printf '%-26s' "$u") $(systemctl is-active "$u")  $(($(systemctl show "$u" -p MemoryCurrent --value 2>/dev/null || echo 0)/1048576)) MB"
done
free -m | awk 'NR==2{print "[builder-idle-install] available on the box: " $7 " MB of " $2 " MB"}'
exit 0
