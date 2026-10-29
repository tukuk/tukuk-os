#!/usr/bin/env bash
# ide-check.sh — staged proof that the remote-IDE stack on this box is actually wired up,
# in the order a failure would really be discovered. Run it any time, as any user, it only
# ever reads:
#
#   bash /opt/tukuk-os/deploy/ide/ide-check.sh
#
# STAGES, cheapest first, so a failure names itself instead of being guessed at:
#   A. the binaries the systemd units exec — a missing package is the most common reason a
#      freshly installed stack will not come up, and it has nothing to do with config.
#   B. config and secrets — the VNC password file in particular: x11vnc's unit will not
#      start at all without it, and "why is remote-ide.target failing" turns into a very
#      confusing half-hour without this line.
#   C. unit files present and daemon-reloaded, and NOT enabled at boot (that is the design,
#      see README.md — an accidental `systemctl enable remote-ide.target` here is a bug).
#   D. live state, only if something is running: each unit's status, the two loopback
#      sockets, and how many browser tabs are attached right now.
#   E. the edge path: nginx knows the host, the noVNC files are reachable, and — the part
#      that is easy to get wrong and impossible to see from the browser — a direct hit on
#      the origin WITHOUT a Cloudflare Access header must be refused. A "200" on that last
#      check means the box answers anyone who can reach port 3000, which is exactly the
#      accident this whole file exists to catch.
set -uo pipefail

CONF=${IDE_ENV:-/etc/tukuk-ide/env}
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$CONF" ] || CONF="$HERE/ide.env"
NGX_CONF=/etc/nginx/conf.d/tukuk-ide.conf

PASS=0
FAIL=0
WARN=0
ok()   { echo "  ok    $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $*"; FAIL=$((FAIL+1)); }
warn() { echo "  warn  $*"; WARN=$((WARN+1)); }
head_() { echo; echo "== $*"; }

# ---------------------------------------------------------------- A. binaries ----
head_ "A. binaries the units exec"
for b in Xvfb openbox x11vnc websockify xterm; do
  if command -v "$b" >/dev/null 2>&1; then ok "$b -> $(command -v "$b")"; else bad "$b is not installed (apt-get install xvfb openbox x11vnc novnc xterm)"; fi
done
if [ -d /usr/share/novnc ] && [ -f /usr/share/novnc/vnc.html ]; then ok "noVNC client files at /usr/share/novnc"; else bad "/usr/share/novnc/vnc.html missing -- the 'novnc' package is not installed"; fi

# ------------------------------------------------------------------ B. config ----
head_ "B. config and secrets"
if [ -f "$CONF" ]; then
  ok "config $CONF"
  # shellcheck disable=SC1090
  set -a; . "$CONF"; set +a
else
  bad "no config found (checked $CONF and $HERE/ide.env)"
fi
if [ -f /etc/tukuk-ide/vnc.pass ]; then
  ok "VNC password file present (its contents are never checked or printed here)"
  perms=$(stat -c '%a %U:%G' /etc/tukuk-ide/vnc.pass 2>/dev/null || echo "?")
  case "$perms" in
    600\ *|640\ *root:*|640\ *:*tukuk*|400\ *) ok "  readable only by root and/or the tukuk group ($perms)" ;;
    *) warn "  permissions look open for a secret: $perms -- want 640 root:tukuk at most" ;;
  esac
else
  bad "/etc/tukuk-ide/vnc.pass is missing -- remote-ide-vnc.service WILL fail to start without it. Set it with:  printf '%s' 'YOURPASS' | x11vnc -storepasswd /etc/tukuk-ide/vnc.pass"
fi
if [ -x "${IDE_STUDIO_DIR:-/opt/android-studio}/bin/studio.sh" ]; then
  ok "studio.sh is executable at ${IDE_STUDIO_DIR:-/opt/android-studio}/bin/"
else
  bad "no executable ${IDE_STUDIO_DIR:-/opt/android-studio}/bin/studio.sh -- remote-ide-studio.service cannot start (--lite sessions do not need it)"
fi

# -------------------------------------------------------------- C. unit files ----
head_ "C. systemd units"
UNITS=(remote-ide.target remote-ide-xvfb.service remote-ide-wm.service remote-ide-vnc.service \
       remote-ide-web.service remote-ide-terminal.service remote-ide-studio.service \
       remote-ide-idle-stop.service remote-ide-idle-stop.timer)
for u in "${UNITS[@]}"; do
  if [ -f "/etc/systemd/system/$u" ]; then ok "/etc/systemd/system/$u"; else bad "$u is not installed -- run install-remote-ide.sh"; fi
done
if systemctl is-enabled remote-ide.target >/dev/null 2>&1; then
  bad "remote-ide.target is ENABLED at boot. That is the design's central safety property broken -- the box would start a 4 GB IDE on every reboot. Fix: systemctl disable remote-ide.target"
else
  ok "remote-ide.target is not enabled at boot (correct: nothing pulls it up after a reboot)"
fi
if systemctl is-enabled remote-ide-idle-stop.timer >/dev/null 2>&1; then
  ok "remote-ide-idle-stop.timer is enabled (the one unit that should be)"
else
  bad "remote-ide-idle-stop.timer is not enabled -- a session left open by accident will never be reclaimed"
fi

# ------------------------------------------------------------- D. live state ----
head_ "D. live state"
target_active=$(systemctl is-active remote-ide.target 2>/dev/null || true)
echo "  remote-ide.target: $target_active"
if [ "$target_active" != "active" ]; then
  warn "the stack is not running -- nothing below this line can be checked until it is:  bash $HERE/ide-session.sh start [--lite]"
else
  for u in remote-ide-xvfb.service remote-ide-wm.service remote-ide-vnc.service remote-ide-web.service remote-ide-terminal.service remote-ide-studio.service; do
    st=$(systemctl is-active "$u" 2>/dev/null || true)
    if [ "$st" = "active" ]; then ok "$u is active"; else bad "$u is $st -- journalctl -u $u -n 30 --no-pager"; fi
  done
  for p in "${IDE_VNC_PORT:-5900}" "${IDE_WEB_PORT:-6080}"; do
    if ss -Htln "( sport = :$p )" 2>/dev/null | grep -q '127.0.0.1'; then ok "127.0.0.1:$p is listening"; else bad "nothing listening on 127.0.0.1:$p"; fi
    if ss -Htln "( sport = :$p )" 2>/dev/null | grep -qvE '127.0.0.1|\[::1\]'; then bad "$p is also listening on a NON-loopback address -- this must never happen"; fi
  done
  clients=$(ss -Htn state established "( sport = :${IDE_VNC_PORT:-5900} )" 2>/dev/null | wc -l | tr -d ' ')
  echo "  attached right now: $clients VNC client(s)"
fi

# ---------------------------------------------------------------- E. edge path ----
head_ "E. nginx and the edge path"
if command -v nginx >/dev/null 2>&1; then
  if [ -f "$NGX_CONF" ]; then
    ok "$NGX_CONF is installed"
    if nginx -t >/dev/null 2>&1; then ok "nginx -t is clean"; else bad "nginx -t FAILS -- this affects every hostname on the box, not just this one"; nginx -t 2>&1 | tail -3 | sed 's/^/        /'; fi
  else
    bad "$NGX_CONF is not installed -- ide.tukuk.org has no server block, so the tunnel will hit the default proxy"
  fi
else
  warn "nginx is not on this PATH -- cannot check the edge config"
fi

if [ "$target_active" = "active" ]; then
  code=$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${IDE_WEB_PORT:-6080}/vnc.html" || echo 000)
  if [ "$code" = "200" ]; then ok "websockify serves the noVNC client on :${IDE_WEB_PORT:-6080}"; else bad "GET /vnc.html on :${IDE_WEB_PORT:-6080} replied $code (want 200)"; fi

  # The one check that would otherwise never get run: the origin must refuse a request that
  # never passed Cloudflare Access. This simulates exactly that -- a direct hit on :3000
  # with the right Host header and no Cf-Access-Jwt-Assertion.
  if [ -f "$NGX_CONF" ]; then
    code=$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: ide.tukuk.org" "http://127.0.0.1:3000/vnc.html" || echo 000)
    if [ "$code" = "403" ]; then
      ok "a direct-to-origin hit with no Access header is refused (403) -- layer 2 is doing its job"
    elif [ "$code" = "200" ]; then
      bad "a direct-to-origin hit with NO Access header got through (200). Anyone who can reach :3000 has a path toward a remote desktop -- fix tukuk-ide.conf before opening the tunnel."
    else
      warn "direct-to-origin probe replied $code -- not the 403 (correct) or 200 (broken) this check knows how to read; investigate by hand"
    fi
  fi
fi

echo
echo "== summary: $PASS ok, $WARN warn, $FAIL fail"
[ "$FAIL" -eq 0 ] || echo "at least one hard failure above -- fix it before trusting 'it works in the browser'."
exit $(( FAIL > 0 ? 1 : 0 ))
