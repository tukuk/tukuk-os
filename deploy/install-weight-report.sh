#!/usr/bin/env bash
# Put the daily weight measurement on the box.
#
#   sudo bash /opt/tukuk-os/deploy/install-weight-report.sh on       # install units + enable timer
#   sudo bash /opt/tukuk-os/deploy/install-weight-report.sh run      # one report, right now, to stdout
#   sudo bash /opt/tukuk-os/deploy/install-weight-report.sh last     # the most recent one from the journal
#   sudo bash /opt/tukuk-os/deploy/install-weight-report.sh off      # timer disabled (units stay installed)
#
# `run` prints to your terminal instead of the journal, which is what you want when you are
# deciding whether a change worked: sections 1 and 3 are the two numbers to compare before and
# after. Nothing here is ever public — the report contains server internals by definition.
set -uo pipefail

SRC=/opt/tukuk-os/deploy
MODE=${1:-status}

step() { echo "[weight-report-install] $*"; }
have_units() {
  for u in weight-report.service weight-report.timer; do
    [ -f "$SRC/$u" ] || { step "MISSING $SRC/$u — git pull first"; exit 1; }
    install -m 644 "$SRC/$u" "/etc/systemd/system/$u" && step "installed $u"
  done
  [ -x /opt/tukuk-os/scripts/weight-report.sh ] || { step "MISSING or not executable: scripts/weight-report.sh"; exit 1; }
  systemctl daemon-reload
}
last() { journalctl -t weight-report --no-pager -n 200 2>/dev/null | sed 's/^[^ ]* [^ ]* [^ ]* weight-report: //'; }

case "$MODE" in
  on)
    have_units
    systemctl enable --now weight-report.timer && step "timer enabled — the next report goes to the journal at the scheduled hour"
    step "running one now so there is a baseline to compare against (a oneshot start waits for it):"
    systemctl start weight-report.service
    last
    ;;

  run)
    bash /opt/tukuk-os/scripts/weight-report.sh
    ;;

  last)
    last
    ;;

  off)
    systemctl disable --now weight-report.timer 2>/dev/null || true
    step "timer disabled — the script is still there to run by hand"
    ;;

  status)
    if [ -f /etc/systemd/system/weight-report.timer ]; then
      step "units installed: yes (timer $(systemctl is-enabled weight-report.timer 2>/dev/null || echo no))"
      step "last run: $(systemctl show weight-report.service -p ExecMainStartTimestamp --value)"
      step "next:     $(systemctl list-timers weight-report.timer --no-legend --no-pager 2>/dev/null | awk '{print $1, $2}')"
    else
      step "units installed: no — run this script with 'on' to get the daily measurement"
    fi
    ;;

  *) step "unknown mode '$MODE' — use: on | run | last | off | status"; exit 1 ;;
esac
exit 0
