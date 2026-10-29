#!/usr/bin/env bash
# verify-free-tier.sh — read-only audit of this account's GCP spend posture for tukuk.org,
# plus the Cloudflare-side meters and the domain registration that bound the whole design.
#
# Prints what is running, what is parked, and what would start costing money if it appeared.
# Safe to run anytime: it creates and deletes nothing. Run ON THE HOME BOX as the tukuk user.
#
# Exit code 1 if something is found that breaks the zero-cost posture.
set -uo pipefail
export PATH="${HOME}/google-cloud-sdk/bin:${PATH}"
export CLOUDSDK_CONFIG="${HOME}/.config/gcloud"

PROJ=polar-office-460107-j9
BILLING=017AAF-23F886-A97138
REPO=${REPO:-/opt/tukuk-os}
# `gcloud run services describe` prints the CANONICAL host (…-yich4nzxoq-uc.a.run.app) while
# the brain is configured with the older project-number alias (…-176041010195.us-central1
# .run.app). Both are the same service, so compare what the Worker will actually fetch —
# MIRROR_URL from wrangler.jsonc — instead of hardcoding one spelling.
WRANGLER=$REPO/cloudflare-worker/tukuk-fallback/wrangler.jsonc
MIRROR_URL=$(grep -o 'https://[^"]*\.run\.app' "$WRANGLER" 2>/dev/null | head -1)
# `off` is the cut-out: the ladder then stops at the free R2 snapshot and never dials the
# metered mirror. An unset value means the same thing since DEFAULT_MIRROR was removed.
MIRROR_STATE=$(grep -o '"MIRROR_URL"[[:space:]]*:[[:space:]]*"[^"]*"' "$WRANGLER" 2>/dev/null | tail -1)
problems=0
bail() { echo "  !! $*"; problems=$((problems+1)); }

echo "== project + billing"
gcloud config set project "$PROJ" >/dev/null 2>&1
echo "  project: $PROJ"
echo "  billing: $(gcloud billing projects describe "$PROJ" --format='value(billingEnabled)' 2>&1)"

echo
echo "== Cloud Run (minScale must be 0 — a kept-warm instance is billed)"
CR=$(gcloud run services describe tukuk-mirror --region=us-central1 \
  --format='value(status.url)' 2>&1 | tail -1)
MIN=$(gcloud run services describe tukuk-mirror --region=us-central1 \
  --format='value(spec.template.metadata.annotations["autoscaling.knative.dev/minScale"])' 2>&1 | tail -1)
echo "  canonical: $CR"
echo "  MIRROR_URL in wrangler.jsonc: ${MIRROR_URL:-<not found>}"
MIN=${MIN:-0}
echo "  minScale: $MIN (0 = scales to zero; empty annotation means 0)"
[ "$MIN" != "0" ] && bail "minScale=$MIN — the mirror stays warm and bills vCPU-seconds"

# The invariant that matters: the snapshot is rung 2 (zero egress charge); the metered
# mirror is only rung 3, reached when R2 lacks the page. Probe the mirror when it is on.
if echo "$MIRROR_STATE" | grep -q '"off"'; then
  echo "  rung 3 DISABLED (MIRROR_URL=off) — failover serves from R2 only. Intentional?"
elif [ -z "$MIRROR_URL" ]; then
  bail "no *.run.app MIRROR_URL found in $WRANGLER"
else
  for p in / /about /learn; do
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$MIRROR_URL$p")
    mark=$(curl -sI -m 20 "$MIRROR_URL$p" | grep -i '^x-mirror:' | tr -d '\r' | awk '{print $2}')
    printf '  %-8s %s x-mirror=%s\n' "$p" "$code" "${mark:-missing}"
    [ "$code" != "200" ] && bail "$MIRROR_URL$p returned $code — rung 3 is down (R2 still covers it)"
    [ "$mark" = "gcp-run" ] || bail "$MIRROR_URL$p is not served by the Cloud Run mirror"
  done
fi

# Cloud Run's free tier stops at 1 GB of egress per month. Measure what the mirror really
# served this calendar month from its nginx access log in Cloud Logging (50 GiB/project of
# logs is free), rather than assuming it is near zero.
echo
echo "== metered mirror usage, this calendar month (ceiling 1 GB egress)"
MONTH_START=$(date -u +%Y-%m-01T00:00:00Z)
LOGFILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="tukuk-mirror"'
LOGFILTER="$LOGFILTER AND timestamp>=\"$MONTH_START\""
timeout 90 gcloud logging read "$LOGFILTER" --limit=10000 --format='value(textPayload)' 2>/dev/null \
  | python3 -c '
import sys, re
# nginx combined: IP - - [date] "GET /path HTTP/1.1" STATUS BYTES ...
pat = re.compile(r"^(\S+) \S+ \S+ \[([^\]]+)\] \"(\S+) (\S+)[^\"]*\" (\d{3}) (\d+|-)")
reqs = byts = 0
by_status = {}
for line in sys.stdin:
    m = pat.match(line.rstrip("\n"))
    if not m:
        continue
    reqs += 1
    byts += int(m.group(6)) if m.group(6).isdigit() else 0
    by_status[m.group(5)] = by_status.get(m.group(5), 0) + 1
mb = byts / 1e6
print("  since %s: %d requests, %.2f MB sent, by_status=%s" % (sys.argv[1][:7], reqs, mb, dict(sorted(by_status.items()))))
if mb > 700:
    print("  WARNING: over 70% of the free egress ceiling this month")
else:
    print("  comfortable: %.2f%% of the 1 GB allowance used" % (mb / 10))
' "$MONTH_START" 2>&1

echo
echo "== Compute Engine in $PROJ"
gcloud compute instances list --format='table(name,zone.basename(),status,EXTERNAL_IP)' 2>&1 | sed 's/^/  /'
RUNNING=$(gcloud compute instances list --filter='status=RUNNING' --format='value(name)' 2>&1 | wc -l)
[ "$RUNNING" -gt 0 ] && bail "$RUNNING running instance(s) — external IPv4 on a running VM is billed ~\$3.6/mo"
echo "  disks:"
gcloud compute disks list --format='value(name,sizeGb,status)' 2>&1 | sed 's/^/    /'
echo "  reserved addresses (bill even when unattached):"
gcloud compute addresses list --format='value(name,address,status)' 2>&1 | sed 's/^/    /'

echo
echo "== Cloud Storage"
for b in gs://tukuk-os-offsite gs://run-sources-"$PROJ"-us-central1; do
  printf '  %-52s %s\n' "$b" "$(gcloud storage du -s "$b" 2>&1 | awk '{print $1}' | tail -1)"
done
gcloud storage buckets describe gs://tukuk-os-offsite --format='value(lifecycle_config.rule.action.type,lifecycle_config.rule.condition.age)' 2>&1 | sed 's/^/  offsite lifecycle: /'

echo
echo "== other projects: only spend if the Compute API is on"
for p in $(gcloud projects list --format='value(projectId)' 2>/dev/null | grep -v "^$PROJ$"); do
  on=$(timeout 25 gcloud services list --enabled --project="$p" \
        --filter='config.name:compute.googleapis.com' --format='value(config.name)' 2>/dev/null | head -1)
  if [ -n "$on" ]; then
    n=$(timeout 40 gcloud compute instances list --project="$p" --format='value(name)' 2>/dev/null | wc -l)
    printf '  %-28s compute=on  instances=%s\n' "$p" "$n"
    [ "$n" -gt 0 ] && bail "project $p has $n instance(s) — the free e2-micro is one per billing account"
  else
    printf '  %-28s compute=off (no VMs possible, no spend)\n' "$p"
  fi
done

echo
echo "== budget guard"
gcloud billing budgets list --billing-account="$BILLING" \
  --format='value(displayName,amount.specifiedAmount.units,thresholdRules.len())' 2>&1 | sed 's/^/  /'

# The site being free to run does not mean it is free to *own*: tukuk.org is a registration
# that expires, and a lapse takes the whole thing down for everyone. RDAP is a public
# registry lookup — no account, no key, nothing to pay.
echo
echo "== domain renewal (not a Google cost — the one recurring thing that is not free)"
RDAP=$(timeout 30 curl -sL "https://rdap.org/domain/${DOMAIN:-tukuk.org}" 2>/dev/null)
RDAP_JSON="$RDAP" python3 - <<'PY'
import json, os, sys, datetime
raw = os.environ.get('RDAP_JSON', '')
try:
    d = json.loads(raw)
except Exception:
    print("  lookup failed (no RDAP answer) — check by hand: whois tukuk.org")
    raise SystemExit(0)
exp = next((e['eventDate'] for e in d.get('events', []) if e.get('eventAction') == 'expiration'), None)
if not exp:
    print("  RDAP answered but has no expiration event")
    raise SystemExit(0)
day = exp[:10]
days = (datetime.date.fromisoformat(day) - datetime.date.today()).days
print("  %s expires %s (%d days out); status=%s" % (d.get('ldhName', '?'), day, days, ','.join(d.get('status', []))))
if days < 60:
    print("  WARNING: under 60 days — renew (or confirm auto-renew is on) at the registrar now")
else:
    print("  comfortable: %.1f months of registration left" % (days / 30.4))
PY

echo
if [ "$problems" -eq 0 ]; then
  echo "RESULT: clean — nothing billable found."
else
  echo "RESULT: $problems problem(s) above."
  exit 1
fi
