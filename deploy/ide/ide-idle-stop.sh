#!/usr/bin/env bash
# ide-idle-stop.sh — put the whole remote-IDE stack to sleep when the browser tab closes.
#
# WHAT "IDLE" MEANS HERE, AND WHY IT IS NOT A LOG LINE
#   builder-idle-stop.sh counts Vite request lines. There is nothing to count here:
#   a VNC session is one long-lived WebSocket that carries mouse moves and screen
#   rectangles, not discrete requests, and x11vnc's own log says nothing useful
#   about whether anyone is actually LOOKING. The one signal that cannot lie is the
#   TCP table: x11vnc is bound to loopback, so every ESTABLISHED connection on
#   IDE_VNC_PORT is exactly one attached noVNC tab (websockify's client side). This
#   is the same count ide-session.sh's `status` prints, so "is anyone using this"
#   can never mean two different things in two different places.
#
# WHY IT TEARS DOWN THE WHOLE TARGET, NOT JUST STUDIO
#   Stopping only the JVM leaves Xvfb, openbox, x11vnc and websockify holding a
#   few hundred MB for a display nobody can see, which is worse than doing nothing
#   at all: the next `ide-session.sh start` then reuses half-dead units and the
#   operator cannot tell whether the stack is fresh or leftover. PartOf= on every
#   unit in remote-ide.target already makes stopping the target stop its members,
#   so the cheap thing to do is also the correct thing to do.
#
#   bash deploy/ide/ide-idle-stop.sh            # decide and act (what the timer runs)
#   bash deploy/ide/ide-idle-stop.sh --dry-run  # only report the verdict, change nothing
#
# Escape hatch for a long session:  sudo touch /etc/tukuk-ide-keep
# Bring it back by hand:            bash /opt/tukuk-os/deploy/ide/ide-session.sh start
set -uo pipefail

CONF=/etc/tukuk-ide/env
[ -f "$CONF" ] || CONF="$(cd "$(dirname "$0")" && pwd)/ide.env"
[ -f "$CONF" ] || { echo "[ide-idle] no config at $CONF -- nothing installed yet, nothing to stop" ; exit 0; }
# shellcheck disable=SC1090
set -a; . "$CONF"; set +a

IDLE_MIN=${IDE_IDLE_MIN:-15}
DRY=${1:-}
TARGET=remote-ide.target
STUDIO=remote-ide-studio.service
TERM=remote-ide-terminal.service
KEEP=/etc/tukuk-ide-keep

step() { echo "[ide-idle] $*"; }
die()  { echo "[ide-idle] $*"; exit 0; }   # never exit non-zero: a timer failure would mask the next run

[ "$(systemctl is-active "$TARGET")" = active ] || die "$TARGET is not running -- nothing to do"
[ -e "$KEEP" ] && die "$KEEP exists -- the owner pinned the stack up, leaving it alone"

# 1. Has it been up long enough to judge at all? Measured off the target's own unit,
#    not Studio's: on a `--lite` session Studio never started, and its absence must not
#    be read as "the stack is too young to stop" forever.
started=$(systemctl show "$TARGET" -p ExecMainStartTimestamp --value)
started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
if [ "$started_epoch" = 0 ]; then
  step "could not read the target's start time ($started) -- skipping, because guessing here would stop a live session"
  exit 0
fi
up_min=$(( ( $(date +%s) - started_epoch ) / 60 ))
if [ "$up_min" -lt "$IDLE_MIN" ]; then
  die "up only $up_min min (< $IDLE_MIN) -- too young to judge"
fi

# 2. Is anyone attached? A missing `ss` must never be read as "nobody is here" --
#    that is the exact bug class that turns a monitoring gap into a live outage.
if ! command -v ss >/dev/null 2>&1; then
  step "ss is not installed -- refusing to decide on silence"
  exit 0
fi
clients=$(ss -Htn state established "( sport = :${IDE_VNC_PORT:-5900} )" 2>/dev/null | wc -l | tr -d ' ')
if [ "${clients:-0}" -gt 0 ]; then
  die "$clients VNC client(s) attached -- in use, leaving it up"
fi

# 3. There is no log-based history check here on purpose. x11vnc runs with -quiet in
#    remote-ide-vnc.service, so "was a client here 4 minutes ago" is not recoverable
#    from the journal. That makes the timer's own interval the safety margin: it has
#    to fire often enough that a reconnect inside one gap is caught by the next tick,
#    which is why remote-ide-idle-stop.timer runs every 3 minutes against a 15-minute
#    idle window rather than once at the end of it. A tab that flaps (a laptop
#    sleeping between keystrokes) is seen attached by whichever tick lands during a
#    reconnect, and the decision to stop is then deferred, not forced.
step "no client attached now; up $up_min min; idle window ${IDLE_MIN} min"

if [ "$DRY" = "--dry-run" ]; then
  step "DRY RUN -- would stop: $STUDIO $TERM $TARGET"
  exit 0
fi

systemctl stop "$STUDIO" "$TERM" "$TARGET" \
  && step "stack down -- the site has its memory back" \
  || step "systemctl stop failed -- check: systemctl status $TARGET"
exit 0
