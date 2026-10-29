#!/usr/bin/env bash
# verify-free-tier.sh — read-only audit of this account's GCP spend posture for tukuk.org.
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

# The invariant that matters: the URL the brain will fetch serves the mirror, marked gcp-run.
if [ -z "$MIRROR_URL" ]; then
  bail "no *.run.app MIRROR_URL found in $WRANGLER"
else
  for p in / /about /learn; do
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$MIRROR_URL$p")
    mark=$(curl -sI -m 20 "$MIRROR_URL$p" | grep -i '^x-mirror:' | tr -d '\r' | awk '{print $2}')
    printf '  %-8s %s x-mirror=%s\n' "$p" "$code" "${mark:-missing}"
    [ "$code" != "200" ] && bail "$MIRROR_URL$p returned $code — rung 2 is down"
    [ "$mark" = "gcp-run" ] || bail "$MIRROR_URL$p is not served by the Cloud Run mirror"
  done
fi

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

echo
if [ "$problems" -eq 0 ]; then
  echo "RESULT: clean — nothing billable found."
else
  echo "RESULT: $problems problem(s) above."
  exit 1
fi
