#!/usr/bin/env bash
# ==============================================================================
# pin-lan-address.sh — give this box a LAN address that does not move.
#
# WHY THIS EXISTS: the box takes enp1s0 and wlp2s0 by DHCP, so both of its LAN
# addresses are whatever the router felt like handing out that boot. On 28 Oct 2026
# that cost us the Cockpit console: the router moved the lease and every handover
# step that had recorded the old address went stale. cockpit-lan-socket.sh made the
# *console* follow the address; this script makes the address stop moving.
#
# The permanent fix is a DHCP reservation on the router (MAC 7c:d3:0a:24:53:2f for
# enp1s0) and it is still the right one — it cannot conflict. This script is the
# half that can be done from inside the box: it ADDS a fixed secondary address to
# the interface that already carries the default route, and leaves DHCP alone.
# The box then answers on both, so a lease change can no longer take SSH, Cockpit or
# `scp` away from whoever needs them at 3am.
#
# Safety, because this script edits the network it is usually invoked over:
#   * the candidate address is probed first and refused if anything answers;
#   * a guard is scheduled BEFORE the change lands: if --confirm is not run within
#     $PIN_GUARD_SECONDS, it reverts the profile by itself;
#   * --revert always works, from any shell, and is what the guard runs.
#
# Usage:
#   sudo bash pin-lan-address.sh                  # add the default fixed address
#   sudo bash pin-lan-address.sh --address 192.168.8.240/24
#   sudo bash pin-lan-address.sh --confirm        # keep it (cancels the guard)
#   sudo bash pin-lan-address.sh --revert         # undo, no questions asked
#   sudo bash pin-lan-address.sh --dry-run        # print the nmcli calls only
# ==============================================================================
set -uo pipefail

FIXED_ADDRESS="${PIN_ADDRESS:-192.168.8.240/24}"
GUARD_SECONDS="${PIN_GUARD_SECONDS:-240}"
MARKER="${PIN_MARKER:-/run/tukuk-net-confirmed}"
GUARD_BIN="${PIN_GUARD_BIN:-/usr/local/sbin/tukuk-net-guard}"
NMCLI="${PIN_NMCLI_BIN:-nmcli}"
IP_BIN="${PIN_IP_BIN:-ip}"
PING_BIN="${PIN_PING_BIN:-ping}"
SCHEDULER="${PIN_SCHEDULER:-systemd-run}"

MODE="apply"
IFACE=""
# The guard must call THIS script, not itself: $0 inside the generated guard is the guard.
SELF="$(readlink -f "$0")"

log()  { printf '[pin-lan] %s\n' "$*"; }
die()  { printf '[pin-lan] %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --address) FIXED_ADDRESS="$2"; shift 2 ;;
    --iface)   IFACE="$2"; shift 2 ;;
    --confirm) MODE="confirm"; shift ;;
    --revert)  MODE="revert"; shift ;;
    --dry-run) MODE="dry"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# An address without a prefix length would silently get /32 and be unreachable.
[[ "$FIXED_ADDRESS" == */* ]] || die "'$FIXED_ADDRESS' needs a prefix length, e.g. 192.168.8.240/24"
FIXED_IP="${FIXED_ADDRESS%/*}"

# ── the interface that actually carries the default route ─────────────────────
if [[ -z "$IFACE" ]]; then
  IFACE="$("$IP_BIN" -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')"
fi
[[ -n "$IFACE" ]] || die "no default route — refusing to guess which interface to pin"

# ── the NetworkManager connection on that interface ───────────────────────────
CONN="$("$NMCLI" -t -f NAME,DEVICE connection show --active 2>/dev/null | awk -F: -v d="$IFACE" '$2==d {print $1; exit}')"
[[ -n "$CONN" ]] || die "no active NetworkManager connection on $IFACE (is NetworkManager running?)"

has_address() {
  "$IP_BIN" -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{print $4}' | grep -qx "$FIXED_ADDRESS"
}

run() {
  if [[ "$MODE" == "dry" ]]; then
    printf '  would run: %s\n' "$*"
  else
    "$@"
  fi
}

# ── --confirm: keep what was applied, disarm the guard ────────────────────────
if [[ "$MODE" == "confirm" ]]; then
  has_address || { log "confirm refused: $FIXED_ADDRESS is not on $IFACE, so there is nothing to keep"; exit 1; }
  install -m 0644 /dev/null "$MARKER"
  log "confirmed: $FIXED_ADDRESS stays on $IFACE ($CONN); the guard will now stand down"
  exit 0
fi

# ── --revert: what the guard runs, and what a human runs when unsure ──────────
if [[ "$MODE" == "revert" ]]; then
  log "reverting: removing $FIXED_ADDRESS from $CONN"
  if "$NMCLI" -t -f ipv4.addresses connection show "$CONN" 2>/dev/null | grep -qF "$FIXED_IP"; then
    "$NMCLI" connection modify "$CONN" -ipv4.addresses "$FIXED_ADDRESS" || die "removing the address failed"
    # reapply is enough for addresses; a full `con up` would also re-run DHCP
    "$NMCLI" device reapply "$IFACE" 2>/dev/null || "$NMCLI" connection up "$CONN" 2>/dev/null || true
  else
    log "not present on $CONN — nothing to revert"
  fi
  rm -f "$MARKER"
  if systemctl is-active --quiet tukuk-net-guard.service 2>/dev/null; then
    systemctl stop tukuk-net-guard.service 2>/dev/null || true
  fi
  "$IP_BIN" -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{print "  still on " $4}'
  exit 0
fi

# ── apply ─────────────────────────────────────────────────────────────────────
if has_address; then
  log "$FIXED_ADDRESS is already on $IFACE — nothing to do (use --revert to undo)"
  exit 0
fi

# Occupancy probe. On the local subnet `ping -I` has to ARP first, so ANY reply means
# another device owns the address — a DHCP pool that overlaps our choice is exactly the
# case that must abort, and a conflict would be intermittent rather than obvious.
if "$PING_BIN" -c 2 -W 1 -I "$IFACE" "$FIXED_IP" >/dev/null 2>&1; then
  die "$FIXED_IP answers on $IFACE — another device owns it. Pick another address, or set a DHCP reservation on the router (this is the real fix)."
fi
log "probe: $FIXED_IP is free on $IFACE"

# Guard FIRST. If the change below costs us the network, nothing else can undo it.
if [[ "$MODE" != "dry" ]]; then
  mkdir -p "$(dirname "$GUARD_BIN")"
  cat > "$GUARD_BIN" <<GUARD
#!/bin/bash
# Installed by pin-lan-address.sh. If the change was never confirmed, put it back.
[[ -f "$MARKER" ]] && exit 0
exec /bin/bash $SELF --revert --address $FIXED_ADDRESS --iface $IFACE >>/var/log/tukuk-net-guard.log 2>&1
GUARD
  chmod 0755 "$GUARD_BIN"
  rm -f "$MARKER"
  "$SCHEDULER" --unit=tukuk-net-guard --on-active="${GUARD_SECONDS}s" "$GUARD_BIN" || \
    log "warning: could not schedule the guard — confirm within $GUARD_SECONDS s or revert by hand"
  log "guard armed: auto-revert in ${GUARD_SECONDS}s unless you run --confirm"
fi

# DAD on purpose: if another host is coming up with the same address, NetworkManager
# refuses the assignment instead of fighting over it.
run "$NMCLI" connection modify "$CONN" ipv4.dad-timeout 2000
run "$NMCLI" connection modify "$CONN" +ipv4.addresses "$FIXED_ADDRESS"

# reapply keeps the existing DHCP lease; `con up` would re-run DHCP and drop the link
# for a moment on a box that may be serving traffic. So: try reapply, and only fall back
# to a full bounce when the address did not take (some NM versions ignore address changes
# on reapply). The guard is already armed for exactly that moment.
if [[ "$MODE" != "dry" ]]; then
  "$NMCLI" device reapply "$IFACE" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8; do
    has_address && break
    sleep 1
  done
  if ! has_address; then
    log "reapply did not take the address — restarting $CONN (DHCP re-runs; the guard is armed)"
    "$NMCLI" connection up "$CONN" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      has_address && break
      sleep 1
    done
  fi
fi

if [[ "$MODE" == "dry" ]]; then
  exit 0
fi

if ! has_address; then
  die "the address did not land on $IFACE — the guard will revert in ${GUARD_SECONDS}s (or run --revert now)"
fi

# Cockpit binds a fixed list re-derived from `ip` (deploy/cockpit-lan-socket.sh), so the
# console has to be told about the new address or it stays unreachable there.
if [[ -x /usr/local/sbin/cockpit-lan-socket ]]; then
  /usr/local/sbin/cockpit-lan-socket >/dev/null 2>&1 && log "cockpit re-bound to the new address list"
fi

log "done: $IFACE now answers on $FIXED_ADDRESS (and keeps its DHCP address)"
log "CONFIRM within ${GUARD_SECONDS}s:  sudo bash $0 --confirm"
log "nothing to confirm?               sudo bash $0 --revert"
