#!/usr/bin/env bash
# ==============================================================================
# Put nginx in front of the Tukuk-OS app, in stages that can be checked and undone.
#
#   verify    Install the front proxy on 127.0.0.1:8080 pointing at Node where it
#             lives TODAY (3000). Nothing production uses can break — no traffic
#             goes through 8080 until the next step. Then run the checks.
#   cut       Move Node to 127.0.0.1:3001 and move nginx onto 127.0.0.1:3000, which
#             is what cloudflared already dials. The tunnel config is never touched,
#             because in token mode its routes may live in the Cloudflare dashboard
#             (which this project's API token cannot edit). Brief blip = the Node
#             restart, the same one every deploy already has.
#   rollback  Node back on 3000, nginx back on 8080. One command, no rebuild.
#   status    Show where each layer is listening and whether the cache is answering.
#
# Run over SSH as root:
#   ssh tukuk@<box> "echo <pw> | sudo -S bash /opt/tukuk-os/deploy/nginx/install-tukuk-front.sh verify"
# ==============================================================================
set -uo pipefail
# A root service run through `sudo -S` can have no HOME at all; nothing here needs it,
# but a bare `$HOME` under `set -u` would abort the script mid-cutover.
HOME=${HOME:-/root}
export HOME

APP=/opt/tukuk-os
CONF_SRC=$APP/deploy/nginx/tukuk-front.conf
CONF=/etc/nginx/conf.d/tukuk-front.conf
# The port is moved with a systemd DROP-IN, never by editing the unit. On this box the
# live /etc/systemd/system/tukuk-os.service carries `Environment=PORT=3000` itself (the
# copy in this repo is not what is installed), so a drop-in is both the only clean way to
# override it and the only way to undo it without retyping someone else's file.
DROPIN_DIR=/etc/systemd/system/tukuk-os.service.d
DROPIN=$DROPIN_DIR/60-front-port.conf
CACHE_DIR=/var/cache/nginx/tukuk
NOW_PORT=3000   # where Node listens today
NEW_PORT=3001   # where Node moves on cut-over
VERIFY_PORT=8080
PROD_PORT=3000

step() { echo "   $*"; }
die() { echo "✗ $*"; exit 1; }
# Whether nothing is bound on 127.0.0.1:$1 yet. Defined here, not inside a case branch:
# a shell function declared while running `verify` would not exist in the process that
# later runs `cut`, and `! port_free` would then abort a cutover over a typo.
port_free() { ! ss -ltn 2>/dev/null | grep -q "127\.0\.0\.1:$1 "; }
# Who holds 127.0.0.1:$1, if anyone. Needs root to see the process name.
port_owner() { ss -ltnp 2>/dev/null | awk -v p="127.0.0.1:$1" '$4==p{print $NF}' | head -1; }

[ "$(id -u)" = 0 ] || die "run as root: sudo bash $0 ${1:-status}"
[ -f "$CONF_SRC" ] || die "missing $CONF_SRC — git pull first"
[ -e /etc/systemd/system/tukuk-os.service ] || die "no tukuk-os.service here — not this box?"
command -v nginx >/dev/null || die "nginx is not installed"

# Current state of the installed front proxy: which port it listens on, which it proxies to.
installed_listen() { [ -f "$CONF" ] && grep -m1 -oE 'listen 127\.0\.0\.1:[0-9]+' "$CONF" | cut -d: -f2 || echo none; }
installed_origin() { [ -f "$CONF" ] && grep -m1 -oE 'server 127\.0\.0\.1:[0-9]+' "$CONF" | cut -d: -f2 || echo none; }

# The app answers on $1 within ~60 s (it warms feeds in the background, so give it room).
wait_health() {
  local port=$1 tries=40
  while [ $tries -gt 0 ]; do
    if curl -fsS -m 3 "http://127.0.0.1:$port/health" | grep -q '"status":"ok"'; then return 0; fi
    tries=$((tries - 1)); sleep 2
  done
  return 1
}

place_conf() { # $1 = listen port, $2 = origin port
  # The cache directory has to exist BEFORE the test: nginx creates only the last
  # component of proxy_cache_path, and on Ubuntu /var/cache/nginx is not there at all
  # (its own cache lives under /var/lib/nginx), so `nginx -t` fails with mkdir() ENOENT.
  mkdir -p /var/cache/nginx "$CACHE_DIR" || die "cannot create $CACHE_DIR"
  chown -R www-data:www-data /var/cache/nginx && chmod 700 "$CACHE_DIR"
  sed -e "s/listen 127\.0\.0\.1:[0-9]\+;/listen 127.0.0.1:$1;/" \
      -e "s/listen \[::1\]:[0-9]\+;/listen [::1]:$1;/" \
      -e "s/server 127\.0\.0\.1:[0-9]\+;/server 127.0.0.1:$2;/" "$CONF_SRC" > "$CONF.new"
  # -t tests the WHOLE config, so a bad file can never reach a running nginx.
  if ! mv "$CONF.new" "$CONF" || ! nginx -t >/tmp/nginx-t.log 2>&1; then
    echo "--- nginx -t ---"; cat /tmp/nginx-t.log
    rm -f "$CONF"
    systemctl reload nginx 2>/dev/null || true
    die "config rejected by nginx -t — removed it, nginx reloaded with its old config"
  fi
  step "nginx -t OK"
  systemctl reload nginx || die "nginx reload failed"
  step "nginx reloaded (listen $1 -> origin $2)"
}

set_app_port() { # $1 = the port Node should bind, or '' to remove the override again
  if [ -z "$1" ]; then
    rm -f "$DROPIN"
    systemctl daemon-reload
    step "drop-in removed — the unit's own PORT applies again"
    return
  fi
  mkdir -p "$DROPIN_DIR"
  printf '[Service]\n# Written by install-tukuk-front.sh — delete this file to undo the front proxy.\nEnvironment=PORT=%s\nEnvironment=HOST=127.0.0.1\n' "$1" > "$DROPIN"
  systemctl daemon-reload
  step "drop-in says PORT=$1"
}

# What the running process ACTUALLY has in its environment. The drop-in is read after the
# unit file, so it wins — but that precedence is asserted here from /proc, not assumed.
effective_port() {
  local pid
  pid=$(systemctl show -p MainPID --value tukuk-os.service)
  [ "$pid" = 0 ] && { echo none; return; }
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^PORT=//p' | tail -1
}

case "${1:-status}" in
  verify)
    echo "▶ verify — the front proxy beside production, changing nothing that serves traffic"
    if ! port_free "$VERIFY_PORT"; then
      # Re-running verify is normal: our own nginx is then already on the port and this run
      # replaces the config it loaded. A stranger on $VERIFY_PORT is a different matter.
      port_owner "$VERIFY_PORT" | grep -q nginx || die "port $VERIFY_PORT is held by $(port_owner "$VERIFY_PORT") — not nginx, refusing to share"
      step "re-verifying: nginx already holds $VERIFY_PORT, replacing its config"
    fi
    place_conf "$VERIFY_PORT" "$NOW_PORT"
    echo
    echo "   Now run the checks (they drive http://127.0.0.1:$VERIFY_PORT):"
    echo "     node $APP/data/nginx-front-check.js $VERIFY_PORT"
    echo "   If they pass:  sudo bash $0 cut"
    ;;

  cut)
    echo "▶ cut over — Node → :$NEW_PORT, nginx → :$PROD_PORT (what cloudflared dials)"
    [ "$(installed_listen)" = "$VERIFY_PORT" ] || die "run 'verify' first — the proxy must already have passed its checks on $VERIFY_PORT"
    port_free "$NEW_PORT" || die "port $NEW_PORT is taken by something else; refusing to move Node onto it"
    # Back up the tunnel's origin string so a rollback can be compared against it.
    cp -a /etc/cloudflared/config.yml "/etc/cloudflared/config.yml.bak-front-$(date +%s)" 2>/dev/null \
      && step "cloudflared config backed up (it is NOT modified)"

    echo "▶ moving Node to $NEW_PORT"
    set_app_port "$NEW_PORT"
    systemctl restart tukuk-os.service || die "tukuk-os failed to restart — roll back with: bash $0 rollback"
    wait_health "$NEW_PORT" || die "Node is not answering on $NEW_PORT — roll back with: bash $0 rollback"
    [ "$(effective_port)" = "$NEW_PORT" ] || die "the process still has PORT=$(effective_port) — the drop-in did not win; roll back with: bash $0 rollback"
    step "Node healthy on $NEW_PORT, and /proc says PORT=$(effective_port)"

    echo "▶ moving nginx onto $PROD_PORT (it must bind it only now that Node has released it)"
    place_conf "$PROD_PORT" "$NEW_PORT"
    wait_health "$PROD_PORT" || die "the app is not reachable THROUGH nginx on $PROD_PORT — roll back with: bash $0 rollback"
    step "healthy through nginx on $PROD_PORT"

    echo
    echo "▶ live check — is HTML actually being served from the cache?"
    for u in /bendera /alat/unit /theme.css /health; do
      first=$(curl -s -o /dev/null -m 20 -D- "https://tukuk.org$u" | grep -im1 '^x-cache-status' | tr -d '\r' | cut -d' ' -f2)
      second=$(curl -s -o /dev/null -m 20 -D- "https://tukuk.org$u" | grep -im1 '^x-cache-status' | tr -d '\r' | cut -d' ' -f2)
      step "https://tukuk.org$u  nginx: ${first:-none} → ${second:-none}"
    done
    echo
    echo "   Full regression: node $APP/data/nginx-front-check.js $PROD_PORT"
    ;;

  rollback)
    echo "▶ rollback — Node back on $NOW_PORT, nginx back on $VERIFY_PORT, tunnel untouched"
    # nginx must give port $PROD_PORT up BEFORE Node is restarted onto it, so this
    # moves the proxy aside first and only then moves the app back. One restart.
    if [ -f "$CONF" ]; then
      place_conf "$VERIFY_PORT" "$NOW_PORT"
      rm -rf "$CACHE_DIR" && step "cache cleared (a stale page must not survive a rollback)"
    fi
    set_app_port ''                       # drop-in gone → the unit's own PORT=3000 applies
    systemctl restart tukuk-os.service || step "WARNING: tukuk-os restart reported an error"
    wait_health "$NOW_PORT" && step "✓ serving directly again on $NOW_PORT (PORT=$(effective_port) in the live process), as before" \
      || step "✗ still unhealthy on $NOW_PORT — check: systemctl status tukuk-os"
    ;;

  status)
    echo "nginx listens: $(installed_listen)   proxies to: $(installed_origin)"
    step "PORT in the live process: $(effective_port)   drop-in: $([ -f "$DROPIN" ] && echo present || echo absent)"
    for p in 3000 3001 8080; do
      step ":$p → $(ss -ltnp 2>/dev/null | awk -v p="127.0.0.1:$p" '$4==p{print $NF}' | head -1)"
    done
    echo "--- cache on disk ---"
    du -sh "$CACHE_DIR" 2>/dev/null | sed 's/^/   /' || echo "   (no cache yet)"
    echo "--- last 6 requests it served ---"
    tail -6 /var/log/nginx/tukuk-front.log 2>/dev/null | sed 's/^/   /' || echo "   (no log yet)"
    ;;

  *) die "usage: $0 verify|cut|rollback|status" ;;
esac
exit 0
