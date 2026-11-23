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
# Only the builder is ever stopped. The connector is not part of it: cloudflared carries
# build.tukuk.org AND tchat.tukuk.org (one tunnel, every hostname), so stopping it would
# take live hostnames off the internet for the whole sleep — see builder-idle-stop.sh.
UNITS=(tukuk-builder.service)
CONNECTOR=cloudflared.service
WAKE=tukuk-builder-wake.service
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

# The always-on front door (owns :5174, forwards to the builder on :5176, and wakes it on request).
# Installed and started in EVERY mode: it is the thing that replaces the Cloudflare 502 with a
# "warming up" page, so it must never depend on which idle mode was last chosen.
ensure_wake() {
  [ -f "$SRC/$WAKE" ] || { step "MISSING $SRC/$WAKE — git pull first"; return; }
  [ -f "$SRC/builder-wakekeeper.js" ] || { step "MISSING $SRC/builder-wakekeeper.js — git pull first"; return; }
  chmod +x "$SRC/builder-wakekeeper.js" 2>/dev/null || true
  install -m 644 "$SRC/$WAKE" "/etc/systemd/system/$WAKE" && step "installed $WAKE"
  systemctl daemon-reload
  systemctl enable "$WAKE" >/dev/null 2>&1 || true
  systemctl restart "$WAKE" && step "front door up on :5174 -> builder :5176"
}

# Stopping on purpose must not read as a failure. The builder is a Node app that exits 143 after
# SIGTERM, so systemd logged every idle stop as `failed (exit-code)` — and the load governor
# reports any failed unit as CRITICAL every 30 minutes. One deliberate stop on 23 Oct 2026
# produced 65 identical critical alerts over the next day and a half and buried everything else
# that happened in that window. 143 is what this app does when it is asked to stop; a crash
# looks like a different code (1, or 137 when the kernel kills it for memory).
DROPIN=/etc/systemd/system/tukuk-builder.service.d
mkdir -p "$DROPIN"
printf '# An idle stop is a success, not a failure: the app exits 143 after SIGTERM.\n[Service]\nSuccessExitStatus=143\n' \
  > "$DROPIN/exit-codes.conf"
systemctl daemon-reload
step "drop-in written: an idle stop is recorded as success (SuccessExitStatus=143)"

case "$MODE" in
  stop-now)
    systemctl stop "${UNITS[@]}" && step "stopped ${UNITS[*]} (the connector stays up: tchat.tukuk.org rides on it)"
    ;;

  keep)
    rm -f "$KEEP"
    systemctl stop builder-idle-stop.timer 2>/dev/null || true
    systemctl disable builder-idle-stop.timer 2>/dev/null || true
    ensure_wake
    systemctl start "${UNITS[0]}" || step "tukuk-builder did not start — check: journalctl -u tukuk-builder -n 30"
    step "builder is up and the idle timer is OFF — it will not be stopped while you work"
    ;;

  sleep)
    have_units
    ensure_wake
    rm -f "$KEEP"
    systemctl enable --now builder-idle-stop.timer && step "timer enabled — the builder goes to sleep after 3 idle hours"
    systemctl start builder-idle-stop.service
    step "the check that just ran:"
    report
    ;;

  wake)
    ensure_wake
    systemctl start "${UNITS[0]}" "$CONNECTOR" || step "start failed — check: journalctl -u tukuk-builder -n 30"
    for i in $(seq 1 20); do
      curl -fsS -m 3 -o /dev/null http://127.0.0.1:5176/ && { step "builder answering on :5176 after $((i * 2))s"; break; }
      sleep 2
    done
    curl -fsS -m 3 -o /dev/null http://127.0.0.1:5176/ || step "builder still not answering on :5176 — check: journalctl -u tukuk-builder -n 30"
    ;;

  status)
    [ -f /etc/systemd/system/builder-idle-stop.timer ] && step "units installed: yes (timer $(systemctl is-enabled builder-idle-stop.timer 2>/dev/null || echo no))" \
      || step "units installed: no — the builder will run forever until this is run in sleep mode"
    step "front door ($WAKE): $(systemctl is-active $WAKE 2>/dev/null || echo no)  (:5174 -> :5176)"
    step "builder: $(systemctl is-active tukuk-builder.service), holds $(($(systemctl show tukuk-builder.service -p MemoryCurrent --value 2>/dev/null || echo 0)/1048576)) MB"
    [ -e "$KEEP" ] && step "$KEEP exists — the builder is pinned up"
    report
    ;;

  *) step "unknown mode '$MODE' — use: stop-now | keep | sleep | wake | status"; exit 1 ;;
esac

echo
echo "--- what is holding memory now ---"
for u in "${UNITS[@]}" "$WAKE" "$CONNECTOR" tukuk-os.service meilisearch.service; do
  step "$(printf '%-26s' "$u") $(systemctl is-active "$u")  $(($(systemctl show "$u" -p MemoryCurrent --value 2>/dev/null || echo 0)/1048576)) MB"
done
free -m | awk 'NR==2{print "[builder-idle-install] available on the box: " $7 " MB of " $2 " MB"}'
exit 0
