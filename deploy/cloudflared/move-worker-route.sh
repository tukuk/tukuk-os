#!/usr/bin/env bash
# Move the failover Worker OFF the apex and onto its own hostname.
#
# WHY THIS EXISTS
#   cloudflare-worker/tukuk-fallback proxies every request to DEFAULT_ORIGIN, and
#   DEFAULT_ORIGIN is https://tukuk.org — the same hostname the Worker is routed on. A
#   subrequest cannot re-enter the Worker, so `fetch` throws, the ladder drops to the R2
#   snapshot, and the site LOOKS fine while every dynamic path dies:
#     /health, /api/*, /search, all POSTs, login, chat, admin  ->  503 "API unavailable"
#   Moving the route to worker.tukuk.org gives the Worker a hostname it can fetch through,
#   and gives tukuk.org back to the tunnel. It is also where the code says it lives and where
#   scripts/gcs-offsite-sync.sh already reads from (https://worker.tukuk.org/edge-backup).
#
# USAGE
#   bash deploy/cloudflared/move-worker-route.sh            # dry run: show what would change
#   bash deploy/cloudflared/move-worker-route.sh --apply    # change it, verify, roll back on failure
#   bash deploy/cloudflared/move-worker-route.sh --verify    # verification only
#
# REQUIRES a token with **Zone -> Workers Routes -> Edit** on zone tukuk.org. The box's
# CLOUDFLARE_API_TOKEN has Routes *Read* only and answers 403 on write; the 31 Oct DNS token
# (cfut_) has no Workers scope at all. Create one, then:
#   CLOUDFLARE_API_TOKEN=... bash deploy/cloudflared/move-worker-route.sh --apply
set -u

ZONE_ID=${ZONE_ID:-4ad6f31b444b19c37d5429da4619c845}
API=https://api.cloudflare.com/client/v4
SCRIPT_NAME=${SCRIPT_NAME:-tukuk-fallback}
BAD_PATTERN=${BAD_PATTERN:-tukuk.org/*}     # the route that shadows the tunnel
GOOD_PATTERN=${GOOD_PATTERN:-worker.tukuk.org/*}

mode=plan
case "${1:-}" in
  --apply)  mode=apply ;;
  --verify) mode=verify ;;
  "")       mode=plan ;;
  *) echo "unknown option $1 (use --apply or --verify)" >&2; exit 2 ;;
esac

say()  { printf '%s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

TOKEN=${CLOUDFLARE_API_TOKEN:-}
if [ -z "$TOKEN" ] && [ -r /opt/tukuk-os/.env ]; then
  TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' /opt/tukuk-os/.env | cut -d= -f2- | tr -d '"'"'"'\r')
fi
[ -n "$TOKEN" ] || die "no CLOUDFLARE_API_TOKEN in the environment or /opt/tukuk-os/.env"

cf() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

# id <TAB> pattern <TAB> script, one line per route. Empty output means no routes at all.
route_table() {
  cf "$API/zones/$ZONE_ID/workers/routes" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("UNPARSABLE"); raise SystemExit
if not d.get("success"):
    err = (d.get("errors") or [{}])[0].get("message", "unknown")
    print("DENIED\t" + err); raise SystemExit
for r in (d.get("result") or []):
    print("%s\t%s\t%s" % (r.get("id", ""), r.get("pattern", ""), r.get("script") or "-"))
'
}

verify() {
  local h w ok=1 i
  say "verifying (routes can take a few seconds to propagate)"
  for i in 1 2 3 4 5 6; do
    h=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://tukuk.org/health || echo 000)
    w=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://worker.tukuk.org/edge-backup || echo 000)
    [ "$h" = "200" ] && [ "$w" = "403" ] && { ok=0; break; }
    sleep 5
  done
  say "  tukuk.org/health             -> $h   (want 200, a JSON body from the app)"
  say "  worker.tukuk.org/edge-backup -> $w   (want 403, an auth answer not 522)"
  return $ok
}

create_route() { # pattern -> prints the new id or an error
  cf -X POST -d "{\"pattern\":\"$1\",\"script\":\"$SCRIPT_NAME\"}" \
    "$API/zones/$ZONE_ID/workers/routes" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("success"):
    print((d.get("result") or {}).get("id", ""))
else:
    print("ERR: " + ((d.get("errors") or [{}])[0].get("message", "unknown")))
'
}

delete_route() { # id
  cf -X DELETE "$API/zones/$ZONE_ID/workers/routes/$1" >/dev/null 2>&1
}

if [ "$mode" = "verify" ]; then
  verify && { say "OK"; exit 0; } || { say "STILL WRONG"; exit 1; }
fi

say "zone $ZONE_ID, script $SCRIPT_NAME"
table=$(route_table)
case "$table" in
  UNPARSABLE) die "could not read the route list (response was not JSON)" ;;
  DENIED*)    die "token cannot read Workers Routes: ${table#DENIED	}" ;;
esac

say "current routes:"
if [ -z "$table" ]; then say "  (none)"; else
  printf '%s\n' "$table" | awk -F'\t' '{printf "  %-24s -> %s\n", $2, $3}'
fi

bad_id=$(printf '%s\n' "$table" | awk -F'\t' -v p="$BAD_PATTERN"  '$2 == p {print $1; exit}')
good_id=$(printf '%s\n' "$table" | awk -F'\t' -v p="$GOOD_PATTERN" '$2 == p {print $1; exit}')

[ -n "$bad_id" ]  && say "plan: delete route $BAD_PATTERN (currently shadowing the tunnel)"
[ -z "$good_id" ] && say "plan: create route $GOOD_PATTERN -> $SCRIPT_NAME"
[ -z "$bad_id" ] && [ -n "$good_id" ] && { say "already in the wanted shape; verifying instead"; \
  verify && { say "OK (nothing to change)"; exit 0; } || die "route looks right but the site does not"; }

if [ "$mode" = "plan" ]; then
  say "dry run — nothing changed. Re-run with --apply."
  exit 0
fi

# --- apply ---------------------------------------------------------------------------------
origin_table="$table"   # exact pre-change state, used for rollback
if [ -z "$good_id" ]; then
  say "creating $GOOD_PATTERN"
  out=$(create_route "$GOOD_PATTERN")
  case "$out" in
    ERR:*) die "create failed: ${out#ERR: }  (token needs Workers Routes:Edit)" ;;
    "")    die "create returned no id" ;;
    *)     good_id="$out"; say "  created $good_id" ;;
  esac
fi

if [ -n "$bad_id" ]; then
  say "deleting $BAD_PATTERN ($bad_id)"
  delete_route "$bad_id"
fi

if verify; then
  say "OK — apex is back on the tunnel, failover brain is on worker.tukuk.org"
  exit 0
fi

say "VERIFY FAILED — rolling back to the previous route table"
[ -n "$good_id" ] && delete_route "$good_id"
printf '%s\n' "$origin_table" | awk -F'\t' -v s="$SCRIPT_NAME" '$2 != "" && $3 == s {print $2}' | while read -r p; do
  [ -n "$p" ] && { say "  restoring $p"; create_route "$p" >/dev/null; }
done
die "rolled back; the edge is as it was"
