#!/usr/bin/env bash
# Tukuk-OS watchdog — keep the search engine always up AND responsive.
#
# systemd `Restart=always` only kicks in when the process dies. This watchdog
# handles the other cases:
#   1. process dead             → systemctl start
#   2. process alive but hung   → systemctl restart
#   3. Meilisearch dead         → cascade restart
#   4. edge problem (Cloudflare 429/1027 zone block, tunnel/internet drop) → log LOUDLY.
#      tukuk.org is WORKERLESS now (no R2 fallback to lean on), so a non-2xx at the
#      public edge means real visitors are getting an error page even if Node is fine.
#   5. daily update gone quiet  → nudge tukuk-update.service (see below)
#
# Run every 2 minutes via a systemd timer.

set -uo pipefail

APP="tukuk-os.service"
MEILI="meilisearch.service"
URL="${WATCHDOG_URL:-http://127.0.0.1:3000/health}"
THRESHOLD="${WATCHDOG_THRESHOLD:-2}"
STAMP="/tmp/tukuk-os-watchdog.fail"

log() { logger -t tukuk-os-watchdog -- "$*"; echo "[watchdog] $*"; }

# --- 0. the management plane must always be reachable -----------------------
# A box you cannot log into is a box you cannot fix. On 29 Oct 2026 the site was
# healthy while sshd dropped every SYN and cockpit.socket refused connections on
# the address the box actually held — the socket was still bound to the one it had
# at boot (see deploy/cockpit-lan-socket.sh), and the firewall no longer allowed 22.
# Neither is visible through Cloudflare, because the tunnel is outbound-only, so no
# other check in this stack ever notices. Runs FIRST, so it still fires on the
# early-exit paths below, and on a 30-minute stamp: a healthy box pays one `ss`
# call and nothing else, while a locked-out box is fixed within 2 minutes.
ACCESS_STAMP="/tmp/tukuk-os-watchdog.access"
if [ ! -f "$ACCESS_STAMP" ] || [ -n "$(find "$ACCESS_STAMP" -mmin +30 2>/dev/null)" ]; then
  MISSING=""
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE '[:.]22[[:space:]]'   || MISSING="ssh"
    ss -ltn 2>/dev/null | grep -qE '[:.]9090[[:space:]]' || MISSING="${MISSING:+$MISSING+}cockpit"
  fi
  if [ -n "$MISSING" ]; then
    log "🔑 admin access missing ($MISSING) — re-asserting via scripts/selfheal-access.sh"
    bash "$(dirname "$0")/selfheal-access.sh" 2>&1 | while IFS= read -r l; do log "  $l"; done
    touch "$ACCESS_STAMP"
  fi
fi

if ! systemctl is-active --quiet "$MEILI"; then
  log "Meilisearch not active — restart"
  systemctl restart "$MEILI"
fi

# --- tunnel (system service; we can only log, restart needs sudo) ---
if ! systemctl is-active --quiet cloudflared.service 2>/dev/null; then
  log "cloudflared (system) not active — run: sudo systemctl restart cloudflared.service"
fi

# --- public edge: is tukuk.org actually answering VISITORS through Cloudflare? ----------
# The local :3000 check further down cannot see an EDGE fault. This box once sat behind a
# zone-wide Cloudflare 429 "error code: 1027" (a Worker route fetching its own zone tripped
# the rate-limit) with Node perfectly healthy — a purely-local watchdog would never notice.
# Since the site is workerless (no R2 fallback), anything other than a 2xx here means real
# visitors are being served an error, so a sustained problem is logged loudly (first attempt
# and then every 15th ≈ 30 min) and every state change (healthy→bad, bad→healthy) is logged
# once. The status code, not `curl -f`, decides: 429 is called out as the edge-block case.
probe_edge() { # $1 = url → echoes the HTTP code, or 000 when curl itself could not connect
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "$1" 2>/dev/null); echo "${c:-000}";
}
PUB="${WATCHDOG_PUBLIC_URL:-https://tukuk.org/health}"
PUB_ASSET="${WATCHDOG_PUBLIC_ASSET:-https://tukuk.org/libs/leaflet.min.js}"
PUB_STAMP="/tmp/tukuk-os-watchdog.public"
CODE=$(probe_edge "$PUB")
PREV=$(cat "$PUB_STAMP" 2>/dev/null || echo ok)
case "$CODE" in
  2??)
    [ "$PREV" != ok ] && { log "Public edge RECOVERED — $PUB answering HTTP $CODE (was: $PREV)"; rm -f "$PUB_STAMP"; }
    ;;
  429)
    N=${PREV#429:}; N=$(( ${N:-0} + 1 )); echo "429:$N" > "$PUB_STAMP"
    [ "$N" -eq 1 ] || [ $((N % 15)) -eq 0 ] && log "⛔ CLOUDFLARE EDGE BLOCK (429/error 1027): $PUB — a zone rate-limit/WAF rule is blocking EVERY visitor; Node is NOT the cause (attempt $N). Check tukuk.org → Security → Events + WAF → Rate limiting rules."
    ;;
  000)
    N=${PREV#000:}; N=$(( ${N:-0} + 1 )); echo "000:$N" > "$PUB_STAMP"
    [ "$N" -eq 1 ] || [ $((N % 15)) -eq 0 ] && log "⚠ Public edge UNREACHABLE — curl to $PUB failed (tunnel/internet down, not an app fault) (attempt $N)"
    ;;
  *)
    N=${PREV#err:}; N=$(( ${N:-0} + 1 )); echo "err:$N" > "$PUB_STAMP"
    [ "$N" -eq 1 ] || [ $((N % 15)) -eq 0 ] && log "⚠ Public edge answered HTTP $CODE (non-2xx) — bad deploy or origin error surfacing through Cloudflare (attempt $N)"
    ;;
esac
# A self-hosted vendored library missing at the edge (the exact class of bug that blanked
# the /traffic map) — catch it here so a broken /libs/ path never waits for a human report.
ACODE=$(probe_edge "$PUB_ASSET")
case "$ACODE" in
  2??) ;;
  *) log "⚠ Public self-hosted asset $PUB_ASSET returned HTTP $ACODE — a vendored /libs/ file may be missing or misconfigured" ;;
esac

# --- 5. did the daily update actually run? -----------------------------------
# The update is silent by design, so a timer that died in March looks exactly like
# "nothing to do today": a wedged fetch sat in the oneshot unit for 31 hours on 24 Oct 2026
# and nothing anywhere said so. /health carries the last attempt now, and this is the only
# thing that reads it. One nudge per six hours — a stale record means the last run never
# finished, and starting it every two minutes would only pile up attempts.
UPD_STAMP="/tmp/tukuk-os-watchdog.update"
HEALTH_JSON="$(curl -sf -m 10 "$URL" 2>/dev/null || true)"
if [ -n "$HEALTH_JSON" ]; then
  UPD_STATE="$(printf '%s' "$HEALTH_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).update;if(!u){process.stdout.write("none");return}process.stdout.write((u.stale?"stale":"fresh")+" "+(u.ageSeconds===null?"?":u.ageSeconds)+"s "+(u.stage||"?"))}catch{process.stdout.write("unknown")}})' 2>/dev/null)"
  case "$UPD_STATE" in
    stale*)
      if [ ! -f "$UPD_STAMP" ] || [ -n "$(find "$UPD_STAMP" -mmin +360 2>/dev/null)" ]; then
        log "Daily update looks stale ($UPD_STATE) — starting tukuk-update.service"
        systemctl start --no-block tukuk-update.service || log "could not start tukuk-update.service"
        touch "$UPD_STAMP"
      fi
      ;;
    unknown)
      if [ ! -f "$UPD_STAMP" ] || [ -n "$(find "$UPD_STAMP" -mmin +1440 2>/dev/null)" ]; then
        log "Update record is present but unreadable — check src/update-status.js and data/update-status.json"
        touch "$UPD_STAMP"
      fi
      ;;
  esac
fi

if ! systemctl is-active --quiet "$APP"; then
  log "Search engine not active — start"
  systemctl start "$APP"
  rm -f "$STAMP"
  exit 0
fi

if curl -sf -m 10 -o /dev/null "$URL"; then
  if [ -f "$STAMP" ]; then
    log "Healthy again after $(cat "$STAMP") consecutive failures"
    rm -f "$STAMP"
  fi
  exit 0
fi

COUNT=$(cat "$STAMP" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$STAMP"
log "Health check failed (attempt $COUNT/$THRESHOLD): $URL"

if [ "$COUNT" -ge "$THRESHOLD" ]; then
  log "Threshold exceeded — restart $APP"
  systemctl restart "$APP"
  rm -f "$STAMP"
fi

exit 0