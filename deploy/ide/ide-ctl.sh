#!/usr/bin/env bash
# ide-ctl -- the only thing on this box that is allowed to start or stop the remote-IDE
# units, and the reason `ide-session.sh` can run as an unprivileged user at all.
#
# WHY A ROOT-OWNED WRAPPER INSTEAD OF A BROAD SUDOERS RULE
#   `systemctl` is a system-manager client: a rule that hands over `systemctl start *` in
#   any form is a rule that hands over the whole machine, because the argument that decides
#   WHICH unit is entirely under the caller's control. The precedent on this box is
#   /etc/sudoers.d/tukuk-play (see deploy/godot/sudoers-tukuk-play): the privileged work
#   sits behind one root-owned script that validates its own argument, and only that script
#   is NOPASSWD. This is the same shape, widened from one command to a short verb list,
#   because the IDE stack is several units rather than one publisher.
#
# WHAT IS ALLOWED
#   start / stop / restart, and only on a unit named in ALLOW below, plus every unit listed
#   in IDE_PAUSE_UNITS in /etc/tukuk-ide/env (the heavy services a session may be told to
#   step aside for). Nothing else -- no `enable`, no `mask`, no `edit`, no unit outside
#   those two lists. `is-active`, `show`, `status` and the other read-only verbs are NOT
#   here on purpose: they need no privilege, so ide-session.sh calls systemctl directly for
#   those and this script never sees them.
#
# Installed root-owned, mode 0755, by deploy/ide/install-remote-ide.sh.
set -uo pipefail

ALLOW=(
  remote-ide.target
  remote-ide-studio.service
  remote-ide-terminal.service
  remote-ide-xvfb.service
  remote-ide-wm.service
  remote-ide-vnc.service
  remote-ide-web.service
)

# The pause list comes from the same file ide-session.sh reads, so a unit can only ever be
# paused by a session that already knows about it -- not by whoever calls this script.
CONF=/etc/tukuk-ide/env
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  pause_list=$(. "$CONF" >/dev/null 2>&1; printf '%s' "${IDE_PAUSE_UNITS:-}")
  IFS=',' read -ra extra <<< "$pause_list"
  for u in "${extra[@]}"; do
    u="${u//[[:space:]]/}"
    [ -n "$u" ] && ALLOW+=("$u")
  done
fi

allowed() {
  local want=$1 u
  for u in "${ALLOW[@]}"; do
    [ "$u" = "$want" ] && return 0
  done
  return 1
}

verb=${1:-}
shift || true

case "$verb" in
  start|stop|restart) ;;
  *) echo "ide-ctl: verb must be start, stop or restart (got '$verb')" >&2; exit 2 ;;
esac

[ "$#" -ge 1 ] || { echo "ide-ctl: no unit named after the verb" >&2; exit 2; }

for u in "$@"; do
  if ! allowed "$u"; then
    echo "ide-ctl: '$u' is not a remote-IDE unit and is not in IDE_PAUSE_UNITS -- refusing" >&2
    exit 2
  fi
done

# `exec` so systemctl's own exit status and any message reach the caller untouched --
# wrapping it in another layer of shell here would only hide why a start actually failed.
exec systemctl "$verb" "$@"
