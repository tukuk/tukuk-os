#!/usr/bin/env bash
# ide-session.sh — the one command an operator needs to open the remote IDE, and the one
# thing that decides whether this box can afford it.
#
# Run as the tukuk user (the units are all User=tukuk; root would start a Studio owned by
# root and then be unable to write its own ~/.gradle):
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh start          # base stack + Studio + shell
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh start --lite   # no Studio: repair shell only
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh status         # what is up, and what it costs
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh stop           # tears down + restores pauses
#
# WHY THE MEMORY GATE IS THE FIRST THING AND NOT A WARNING
#   The box has 6.8 GB and the site is already resident in most of it (Node ~850 MB,
#   MeiliSearch up to 1.5 GB, Chrome pool up to 2 GB, plus the tunnel). Starting a 2-4 GB
#   IDE into that without checking is how a "quick look at the server" turns into swap
#   death for tukuk.org — the exact failure the load governor exists to notice after the
#   fact. So this script refuses, and says what to do about it, instead of optimistically
#   launching the biggest process on the machine.
#
# Pausing heavy units is opt-in (--pause) and reversible: the units this script stopped are
# written to a state file and restarted by `stop`, so a session cannot leave LiteRT down.
# Units that were already stopped before the session are never touched, and never restarted.
set -uo pipefail

CONF=${IDE_ENV:-/etc/tukuk-ide/env}
HERE="$(cd "$(dirname "$0")" && pwd)"
# Fall back to the repo copy so `bash ide-session.sh status` works on a machine where the
# installer has not run yet — useful exactly once, which is the moment right before install.
[ -f "$CONF" ] || CONF="$HERE/ide.env"
[ -f "$CONF" ] || { echo "FATAL: no config (checked $CONF and $HERE/ide.env)" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$CONF"; set +a

TARGET=remote-ide.target
STUDIO=remote-ide-studio.service
TERM=remote-ide-terminal.service
STATE="$HOME/.ide-session.state"
KEEP=/etc/tukuk-ide-keep

say() { echo "[ide] $*"; }
bad() { echo "[ide] $*" >&2; }

# ---------------------------------------------------------------- helpers ----
mem_available_mb() { awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo; }

# IDE_MEM_MAX is written human ("4G"); the gate needs MB.
mem_max_mb() {
  local v=${1:-4G} n unit
  n=$(printf '%s' "$v" | tr -dc '0-9'); unit=$(printf '%s' "$v" | tr -dc 'KMGT')
  [ -n "$n" ] || n=4
  case "$unit" in K) echo $((n/1024)) ;; M) echo "$n" ;; T) echo $((n*1024)) ;; *) echo "$n" ;; esac
}

# Established TCP on the VNC port == a browser tab is attached. This is what the idle timer
# and `status` both read, so "is anyone using this" can never mean two different things.
clients_attached() {
  ss -Htn state established "( sport = :${IDE_VNC_PORT:-5900} )" 2>/dev/null | wc -l | tr -d ' '
}

unit_active() { systemctl is-active --quiet "$1"; }

# Every start/stop below goes through ide-ctl, not systemctl directly: this script is
# written to run as the tukuk user (Studio must own its own ~/.gradle), and an
# unprivileged user cannot start a system unit. deploy/ide/ide-ctl.sh is the narrow,
# root-owned door that makes that possible -- it is the ONLY thing in /etc/sudoers.d/
# tukuk-ide allows, and it refuses any unit that is not on its own allowlist. If this
# fails with "a password is required" or "not in the sudoers file", the installer has
# not been run yet: `sudo bash deploy/ide/install-remote-ide.sh`.
ide_ctl() { sudo -n /usr/local/sbin/ide-ctl "$@"; }

heavy_rss_mb() {
  # Sum the whole stack's cgroups so the number printed is what the box is really paying.
  local total=0 rss
  for u in "$TARGET" "$STUDIO" "$TERM" remote-ide-xvfb.service remote-ide-wm.service \
           remote-ide-vnc.service remote-ide-web.service; do
    rss=$(systemd-cgtop -n1 --all -o mnt 2>/dev/null | awk -v u="$u" '$1 ~ u {print $2}')
    total=$((total + ${rss:-0}))
  done
  echo "$total"
}

# ---------------------------------------------------------------- start ------
do_start() {
  local lite=0 pause=0
  for a in "$@"; do
    [ "$a" = "--lite" ] && lite=1
    [ "$a" = "--pause" ] && pause=1
  done

  [ "$(id -u)" -ne 0 ] || { bad "run this as the tukuk user, not root: Studio would then own ~/.gradle and ~/.android as root and the site user could not build. Drop sudo."; exit 1; }

  local need avail
  if [ "$lite" = 1 ]; then need=512; else need=$(( $(mem_max_mb "${IDE_MEM_MAX:-4G}") )); fi
  avail=$(mem_available_mb)
  say "memory: ${avail} MB available, ${need} MB wanted${lite:+ (lite session)}"
  if [ "$avail" -lt "$need" ]; then
    bad "REFUSING to start: the IDE needs ${need} MB and only ${avail} MB is available."
    bad "Options, cheapest first:"
    bad "  1) --lite            repair shell without the IDE (~512 MB) — this covers 'look at"
    bad "     the server and fix something', which is most of what a session is for."
    bad "  2) --pause           stop the units in IDE_PAUSE_UNITS for the length of the session"
    bad "     (${IDE_PAUSE_UNITS:-none}) and restore them on stop."
    bad "  3) lower IDE_GEOMETRY/IDE_MEM_MAX in $CONF, or free memory by hand: sudo systemctl"
    bad "     status litert-lm.service tukuk-chrome-pool.service meilisearch.service"
    exit 1
  fi

  if [ "$pause" = 1 ]; then
    : > "$STATE"
    IFS=',' read -ra units <<< "${IDE_PAUSE_UNITS:-}"
    for u in "${units[@]}"; do
      [ -n "$u" ] || continue
      if unit_active "$u"; then
        ide_ctl stop "$u" && { echo "$u" >> "$STATE"; say "paused $u for this session"; } \
          || bad "could not pause $u (ide-ctl installed? see install-remote-ide.sh) -- continuing anyway"
      fi
    done
  fi

  say "starting the base stack ($TARGET)"
  if ! ide_ctl start "$TARGET"; then
    bad "the base stack failed to come up. The three-line reason is always in the journal:"
    bad "  journalctl -u remote-ide-xvfb.service -u remote-ide-vnc.service -u remote-ide-web.service -n 30 --no-pager"
    [ -s "$STATE" ] && do_restore
    exit 1
  fi

  unit_active "$TERM" || { ide_ctl start "$TERM" && say "repair shell up (xterm on the display)"; }
  if [ "$lite" = 0 ]; then
    if [ ! -x "${IDE_STUDIO_DIR:-/opt/android-studio}/bin/studio.sh" ]; then
      bad "no executable studio.sh at ${IDE_STUDIO_DIR:-/opt/android-studio}/bin/ — the base stack and repair shell are up; Studio is not."
    else
      say "starting Android Studio (first frame takes a minute; look at ide-check.sh rather than watching a blank tab)"
      ide_ctl start "$STUDIO" || bad "studio failed to start — journalctl -u $STUDIO -n 30"
    fi
  fi

  say "open  https://ide.tukuk.org/vnc.html  and enter the VNC password"
  say "(local proof it is listening:  bash $HERE/ide-check.sh)"
}

# ----------------------------------------------------------------- stop ------
do_restore() {
  [ -f "$STATE" ] || return 0
  while read -r u; do
    [ -n "$u" ] || continue
    ide_ctl start "$u" && say "restored $u" || bad "could not restore $u — start it by hand"
  done < "$STATE"
  rm -f "$STATE"
}

do_stop() {
  say "stopping Studio and the shell first, then the display (a JVM torn down after its X"
  say "server dies leaves a zombie that holds its memory until reboot)"
  ide_ctl stop "$STUDIO" 2>/dev/null
  ide_ctl stop "$TERM" 2>/dev/null
  ide_ctl stop "$TARGET" 2>/dev/null
  do_restore
  say "stack down. Nothing IDE-related is running; the site has its memory back."
}

# --------------------------------------------------------------- status ------
do_status() {
  echo "config    $CONF  (display ${IDE_DISPLAY:-:77}, ${IDE_GEOMETRY:-1600x900x24}, scale ${IDE_SCALE:-1/1})"
  printf "studio    %-8s %s\n" "$(systemctl is-active "$STUDIO" 2>/dev/null)" ""
  printf "base      %-8s target=%s  vnc-port=%s web-port=%s\n" \
    "$(systemctl is-active "$TARGET" 2>/dev/null)" "$(systemctl is-active "$TARGET" 2>/dev/null)" \
    "${IDE_VNC_PORT:-5900}" "${IDE_WEB_PORT:-6080}"
  printf "shell     %-8s\n" "$(systemctl is-active "$TERM" 2>/dev/null)"
  echo "attached  $(clients_attached) VNC client(s)"
  echo "memory    $(mem_available_mb) MB available now; stack RSS $(heavy_rss_mb) MB"
  [ -f "$STATE" ] && echo "paused    $(tr '\n' ' ' < "$STATE")(will be restored on stop)"
  [ -f "$KEEP" ] && echo "keep      /etc/tukuk-ide-keep present -> the idle timer will NOT stop this session"
  systemctl is-active --quiet "$TARGET" 2>/dev/null && echo "url       https://ide.tukuk.org/vnc.html"
}

case "${1:-status}" in
  start)  shift; do_start "$@" ;;
  stop)   do_stop ;;
  status) do_status ;;
  *) echo "usage: $0 {start [--lite] [--pause] | stop | status}"; exit 2 ;;
esac
