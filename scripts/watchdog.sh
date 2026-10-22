#!/usr/bin/env bash
# Tukuk-OS watchdog — keep the search engine always up AND responsive.
#
# systemd `Restart=always` only kicks in when the process dies. This watchdog
# handles the other cases:
#   1. process dead             → systemctl start
#   2. process alive but hung   → systemctl restart
#   3. Meilisearch dead         → cascade restart
#   4. internet/tunnel problem  → just log a warning
#      (the site stays up because the Cloudflare fallback serves from R2)
#
# Run every 2 minutes via a systemd timer.

set -uo pipefail

APP="tukuk-os.service"
MEILI="meilisearch.service"
URL="${WATCHDOG_URL:-http://127.0.0.1:3000/health}"
THRESHOLD="${WATCHDOG_THRESHOLD:-2}"
STAMP="/tmp/tukuk-os-watchdog.fail"

log() { logger -t tukuk-os-watchdog -- "$*"; echo "[watchdog] $*"; }

if ! systemctl is-active --quiet "$MEILI"; then
  log "Meilisearch not active — restart"
  systemctl restart "$MEILI"
fi

# --- tunnel (system service; we can only log, restart needs sudo) ---
if ! systemctl is-active --quiet cloudflared.service 2>/dev/null; then
  log "cloudflared (system) not active — run: sudo systemctl restart cloudflared.service"
fi

# --- public site: detect internet/tunnel drop (not a restart cause) ---
# When the public internet drops, the site still lives via the Cloudflare fallback (R2).
PUB="${WATCHDOG_PUBLIC_URL:-https://tukuk.org/health}"
PUB_STAMP="/tmp/tukuk-os-watchdog.public"
if curl -sf -m 12 -o /dev/null "$PUB"; then
  if [ -f "$PUB_STAMP" ]; then
    log "Internet/tunnel recovered — $PUB answering again"
    rm -f "$PUB_STAMP"
  fi
else
  P=$(cat "$PUB_STAMP" 2>/dev/null || echo 0)
  P=$((P + 1))
  echo "$P" > "$PUB_STAMP"
  # log on the first attempt and every 15th (≈30 min) — avoid spamming the journal
  if [ "$P" -eq 1 ] || [ $((P % 15)) -eq 0 ]; then
    log "Public site not answering (attempt $P) — internet/tunnel? Cloudflare fallback still serving static pages"
  fi
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