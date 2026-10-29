#!/bin/bash
# Install the play.tukuk.org origin on this box: the nginx server block, the root-owned
# publisher, and the sudoers grant that lets a detached build call it.
#
# Run as root by scripts/setup-all.sh, or by hand after a repo pull:
#   sudo bash /opt/tukuk-os/deploy/godot/install-on-box.sh
#
# All three pieces are required and none of them is obvious from the running box:
#
#   * /etc/nginx/conf.d/tukuk-play.conf -- the `location = /index.pck.zip` and
#     `= /index.wasm.zip` aliases are the ONLY reason a 480 MB pack and a 39 MB binary
#     get served by Cloudflare instead of streamed through the tunnel per visitor.
#     install-tukuk-front.sh has never copied this file, so a rebuilt box served the
#     game from the wrong root and looked perfectly healthy locally.
#   * /usr/local/sbin/publish-tukuk-play -- the publisher enforces the CDN contract
#     (aliases, mainPack, hash-versioned script tag) and refuses to ship a build that
#     breaks it. Nothing else on the box can publish the game correctly.
#   * /etc/sudoers.d/tukuk-play -- build-web.sh --deploy runs from a detached session
#     with no terminal to prompt on, so this exact privilege has to be NOPASSWD.
#     Handing out `sudo cp` instead would have skipped the alias step entirely.
#
# The publisher additionally drops deploy/godot/sw.js into /var/www/tukuk-play on every
# publish: the worker that keeps the hash-versioned pack and binary in persistent Cache
# Storage, so a revisit does not re-download 500 MB when the browser evicted its HTTP
# cache. Nothing here has to copy it -- but the repo file must exist, or the publish
# warns and players keep re-pulling.
#
# Idempotent: it installs what the repo holds and reloads nginx only if the new config
# passes `nginx -t`, restoring the previous file if it does not.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONF="$REPO/deploy/nginx/tukuk-play.conf"
SBIN=/usr/local/sbin/publish-tukuk-play

[ "$(id -u)" -eq 0 ] || { echo "FATAL: run as root (sudo bash $0)" >&2; exit 1; }
command -v nginx >/dev/null || { echo "FATAL: nginx not installed -- this box is not the play origin yet." >&2; exit 1; }
[ -f "$CONF" ] || { echo "FATAL: missing $CONF -- is this the repo checkout, not a partial copy?" >&2; exit 1; }
[ -f "$HERE/publish-tukuk-play.sh" ] || { echo "FATAL: missing $HERE/publish-tukuk-play.sh" >&2; exit 1; }
[ -f "$HERE/sudoers-tukuk-play" ] || { echo "FATAL: missing $HERE/sudoers-tukuk-play" >&2; exit 1; }

# ── 1. the origin block ────────────────────────────────────────────────────────────
install -d /var/www/tukuk-play
PREV=''
if [ -f /etc/nginx/conf.d/tukuk-play.conf ]; then
  PREV="$(mktemp)"
  cp /etc/nginx/conf.d/tukuk-play.conf "$PREV"
fi
cp "$CONF" /etc/nginx/conf.d/tukuk-play.conf
if ! nginx -t >/dev/null 2>&1; then
  # Leave the box exactly as it was found: a reloaded bad config takes down tukuk.org
  # as well, because both server blocks live on the same :3000 listener.
  [ -n "$PREV" ] && mv -f "$PREV" /etc/nginx/conf.d/tukuk-play.conf
  echo "FATAL: nginx -t rejected the new config; the previous file is back and nginx was not reloaded." >&2
  nginx -t || true
  exit 1
fi
rm -f "$PREV"
systemctl reload nginx
echo "installed: /etc/nginx/conf.d/tukuk-play.conf (nginx reloaded)"

# ── 2. the publisher ───────────────────────────────────────────────────────────────
install -m 0755 "$HERE/publish-tukuk-play.sh" "$SBIN"
echo "installed: $SBIN"

# ── 3. the privilege a detached build needs ────────────────────────────────────────
install -m 0440 "$HERE/sudoers-tukuk-play" /etc/sudoers.d/tukuk-play
visudo -c -f /etc/sudoers.d/tukuk-play >/dev/null
echo "installed: /etc/sudoers.d/tukuk-play (visudo clean)"

# Prove the grant end to end rather than trusting the file: call the publisher as the
# build user with no tty and no password. With no arguments it prints its usage line and
# exits 2 without touching anything, which is only reachable through NOPASSWD.
GRANT_OUT=''
if id -u tukuk >/dev/null 2>&1; then
  GRANT_OUT="$(sudo -u tukuk -n sudo -n "$SBIN" 2>&1 || true)"
  case "$GRANT_OUT" in
    usage*) echo "grant ok: tukuk can run $SBIN without a password." ;;
    *) echo "FATAL: the sudoers grant does not work -- a detached --deploy build will die here." >&2
       echo "       got: $GRANT_OUT" >&2
       exit 1 ;;
  esac
else
  echo "WARN: no tukuk user on this box yet; the sudoers grant is untested." >&2
fi

# The alias has to answer on the origin, or the publisher's edge check is meaningless.
# A freshly parked box has no build in it yet, so 404 here is not an error -- 200 is
# only asserted once something has been published.
CODE=$(curl -4 -s -o /dev/null -w '%{http_code}' -H 'Host: play.tukuk.org' http://127.0.0.1:3000/index.pck.zip || echo 000)
case "$CODE" in
  200) echo "alias live: /index.pck.zip answers 200 on the origin." ;;
  404) echo "alias live: /index.pck.zip is routed (404 only because nothing is published yet)." ;;
  *)   echo "FATAL: /index.pck.zip replied $CODE -- the front proxy or the :3000 listener is not in place." >&2; exit 1 ;;
esac
echo "INSTALL-DONE"
