#!/usr/bin/env bash
# builder-idle-stop.sh — stop the Tukuk Builder when nobody is using it.
#
# Why this exists and why it is allowed to ACT when the load governor is not:
# the governor watches shared infrastructure, and acting there could take the site down.
# This unit owns exactly one thing — a development-only service whose whole job is to be
# started, used, and forgotten. Stopping it is not destructive: the next request is met
# with a page saying the builder is asleep, and `systemctl start` brings it back in seconds.
#
# What is being saved, measured on the box rather than guessed (cgroup memory.stat):
#   tukuk-builder  anon 508 MB + file 179 MB   (the workerd it spawns is inside the same cgroup)
# Anonymous memory is the part that actually cannot be reclaimed, and the builder holds it
# while serving nothing: 14 days of its own log show 0 requests on 7 of those days.
#
# The rule: if tukuk-builder has served no request line for BUILDER_IDLE_MIN minutes, and
# has been running at least that long (so a builder that was just started is never killed
# mid-boot), stop it and its tunnel.
#
# Escape hatch for a long session:  sudo touch /etc/tukuk-builder-keep
# Bring it back by hand:            sudo systemctl start tukuk-builder.service cloudflared-build.service
#
#   bash deploy/builder-idle-stop.sh            # decide and act (what the timer runs)
#   bash deploy/builder-idle-stop.sh --dry-run  # only report the verdict, change nothing
set -uo pipefail

IDLE_MIN=${BUILDER_IDLE_MIN:-180}          # 3 hours: far longer than any gap inside a real session
DRY=${1:-}
UNITS=(tukuk-builder.service cloudflared-build.service)
KEEP=/etc/tukuk-builder-keep

step() { echo "[builder-idle] $*"; }
die()  { echo "[builder-idle] $*"; exit 0; }   # never exit non-zero: a timer failure would mask the next run

[ "$(systemctl is-active tukuk-builder.service)" = active ] || die "tukuk-builder is not running — nothing to do"
[ -e "$KEEP" ] && die "$KEEP exists — the owner pinned the builder up, leaving it alone"

# 1. Has it been up long enough to judge at all?
started=$(systemctl show tukuk-builder.service -p ExecMainStartTimestamp --value)
started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
if [ "$started_epoch" = 0 ]; then
  step "could not read the start time ($started) — skipping, because guessing here would stop a live service"
  exit 0
fi
up_min=$(( ( $(date +%s) - started_epoch ) / 60 ))
if [ "$up_min" -lt "$IDLE_MIN" ]; then
  die "up only $up_min min (< $IDLE_MIN) — too young to judge"
fi

# 2. Any request in the idle window? Vite logs one line per request, so the journal IS the
#    counter — which also means an unreadable journal must never be read as "no requests".
if ! journalctl -u tukuk-builder -n 1 --no-pager >/dev/null 2>&1; then
  step "the journal for tukuk-builder cannot be read — refusing to decide on silence"
  exit 0
fi
since=$(date -d "-${IDLE_MIN} minutes" '+%Y-%m-%d %H:%M:%S')
recent=$(journalctl -u tukuk-builder --since "$since" --no-pager 2>/dev/null | grep -cE ' (GET|POST) ')
if [ "${recent:-0}" -gt 0 ]; then
  die "$recent request(s) in the last $IDLE_MIN min — in use, leaving it up"
fi

# 3. How long ago was it really last touched? (reported, so the decision can be argued with)
last_iso=$(journalctl -u tukuk-builder --since '7 days ago' --no-pager -o short-iso 2>/dev/null | grep -E ' (GET|POST) ' | tail -1 | awk '{print $1, $2}')
step "no request in $IDLE_MIN min; last one logged at ${last_iso:-none in the last 7 days}; up $up_min min"

if [ "$DRY" = "--dry-run" ]; then
  step "DRY RUN — would stop: ${UNITS[*]}"
  exit 0
fi

systemctl stop "${UNITS[@]}" && step "stopped ${UNITS[*]} — build.tukuk.org and dashboard.tukuk.org/ now show a Cloudflare error until it is started again"
step "bring it back: sudo systemctl start ${UNITS[0]} ${UNITS[1]}"
exit 0
