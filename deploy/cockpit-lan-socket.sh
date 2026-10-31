#!/usr/bin/env bash
# ==============================================================================
# cockpit-lan-socket.sh — bind Cockpit to the addresses this box has RIGHT NOW.
#
# WHY THIS EXISTS: [8e] of setup-all.sh used to freeze the LAN address it saw at
# install time into cockpit.socket.d/40-lan-only.conf. A DHCP lease change then
# left a socket listening on an address that no longer exists — the console was
# "running" (systemctl is-active: active) and refused every connection from the
# LAN, with only 127.0.0.1 left as a way in. That is a console you cannot reach
# at the exact moment you need it.
#
# So: never store the address. Re-derive it from `ip` and rewrite the drop-in
# whenever the answer changes. Runs at boot and from setup-all.sh.
#
# Scope is unchanged from the original design: loopback + the box's own LAN
# addresses. NOT 0.0.0.0/:: — a public listener is what this drop-in is for
# avoiding, and a wildcard bind would quietly undo that the day the box gets a
# routable address.
# ==============================================================================
set -uo pipefail

# Overridable so the rewrite can be exercised without touching the live socket:
# point CONF at a scratch file and RESTART=0 and the script only renders the drop-in.
CONF="${COCKPIT_SOCKET_CONF:-/etc/systemd/system/cockpit.socket.d/40-lan-only.conf}"
IP_BIN="${COCKPIT_IP_BIN:-ip}"
RESTART="${COCKPIT_SOCKET_RESTART:-1}"

# Root is only needed for the half that rewrites /etc and restarts the socket.
if [[ "${EUID}" -ne 0 && "$RESTART" == "1" ]]; then
  echo "needs root: sudo bash $0   (or COCKPIT_SOCKET_RESTART=0 with COCKPIT_SOCKET_CONF=… for a dry render)" >&2
  exit 1
fi

# Every global IPv4 the box currently holds (ethernet, wifi, whatever is up) — minus any /32.
#
# A /32 is not a LAN segment: it is the far end of a point-to-point tunnel, and on this box that is
# CloudflareWARP's 100.96.0.1/32. Listing it is not harmless, because systemd fails the WHOLE socket
# unit when a single bind() fails — there is no "bind the addresses that still exist" behaviour. So
# the moment that tunnel is gone the console cannot start, and on this box the tunnel does go: WARP
# is disabled here, and its tun device does not survive a reboot. cockpit-lan-socket.service is
# ordered Before=cockpit.socket, so a clean boot regenerates this file after the tun has already
# vanished and the stale entry never reaches systemd — but any `systemctl restart cockpit.socket`
# between the tunnel dying and the next boot would, and a console that only survives when nothing
# else goes wrong is the exact class of bug this script exists to remove.
#
# A /32 *global* address with a live purpose here would be a router-on-a-stick or a /31 point-to-point
# link; neither is how this box is addressed (enp1s0 and wlp2s0 are both /24).
mapfile -t ADDRS < <("$IP_BIN" -4 -o addr show scope global 2>/dev/null |
  awk '{ split($4, a, "/"); if (a[1] != "" && a[2] != 32) print a[1] }' | sort -u)

next="$(mktemp)"
{
  printf '[Socket]\n'
  # systemd list options APPEND, so the empty assignment must come first —
  # otherwise the stock 0.0.0.0/:: listeners stay in the list.
  printf 'ListenStream=\n'
  printf 'ListenStream=127.0.0.1:9090\n'
  for ip in "${ADDRS[@]}"; do
    # A blank line from `ip` parses as one empty address; skip it rather than emit
    # a `ListenStream=:9090` that systemd would reject.
    [[ -n "$ip" ]] || continue
    printf 'ListenStream=%s:9090\n' "$ip"
  done
} > "$next"

mkdir -p "$(dirname "$CONF")"
if [[ -f "$CONF" ]] && cmp -s "$next" "$CONF"; then
  echo "[cockpit-lan] unchanged: ${ADDRS[*]:-no LAN address} + 127.0.0.1"
  rm -f "$next"
  exit 0
fi

install -m 0644 "$next" "$CONF"
rm -f "$next"
# A box with no global IPv4 yet (network-online fires early) would leave only
# loopback behind — say so instead of reporting success.
if [[ "${#ADDRS[@]}" -eq 0 ]]; then
  echo "[cockpit-lan] warning: no global IPv4 found — only 127.0.0.1 is bound, so the LAN console is unreachable" >&2
fi
if [[ "$RESTART" == "1" ]]; then
  systemctl daemon-reload
  # restart, not enable --now: a unit already listening on a dead address must be
  # torn down before it can pick up the new one.
  systemctl restart cockpit.socket 2>/dev/null || systemctl enable --now cockpit.socket 2>/dev/null || true
fi
echo "[cockpit-lan] bound to 127.0.0.1 + ${ADDRS[*]:-<no LAN address>}:9090"
