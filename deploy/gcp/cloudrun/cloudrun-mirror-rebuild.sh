#!/usr/bin/env bash
# ==============================================================================
# cloudrun-mirror-rebuild.sh — refresh rung 2 of the failover ladder.
#
# The GCP copy of tukuk.org runs on Cloud Run (always-free tier: 2M requests,
# 180k vCPU-s per month, scales to zero). Its content is baked into the image, so
# "refreshing the mirror" means re-building it from the newest R2 snapshot on a
# timer. Content is pulled through the authenticated R2 gateway with the read-only
# token — no Cloudflare credentials, no DNS record, no tunnel.
#
# WHY CLOUD RUN AND NOT THE e2-micro VM: a *.run.app hostname already resolves, so
# this rung needs no Zone:DNS permission; and a running VM bills its external IPv4
# (~$3.6/mo) even inside the always-free instance allowance.
#
# COST GUARDS: --min-instances=0 (idles to zero), --max-instances=1 (a traffic
# spike cannot fan out), 256 MiB / 1 vCPU. Cloud Build gets 120 min/day free and
# one build here is ~1 minute.
#
# USE:    sudo systemctl start tukuk-cloudrun-mirror.service   (weekly timer)
# VERIFY: curl -sI "$(gcloud run services describe tukuk-mirror --region=us-central1 \
#           --format='value(status.url)')/about" | grep -i x-mirror   # gcp-run
# ==============================================================================
set -uo pipefail
export PATH="/home/tukuk/google-cloud-sdk/bin:${PATH}"
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-/home/tukuk/.config/gcloud}"

PROJECT="${GCP_PROJECT:-polar-office-460107-j9}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCR_SERVICE:-tukuk-mirror}"
WORK="${WORKDIR:-/home/tukuk/cloudrun-mirror}"
TOKEN_FILE="${MIRROR_READ_TOKEN_FILE:-/home/tukuk/.mirror-read-token}"
BASE="${MIRROR_BASE:-https://worker.tukuk.org/edge-backup}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
[[ -n "$TOKEN" ]] || { echo "[cloudrun] ERROR: no read token at $TOKEN_FILE" >&2; exit 1; }
command -v gcloud >/dev/null || { echo "[cloudrun] ERROR: gcloud not found." >&2; exit 1; }

rm -rf "$WORK/site" "$WORK/list.json" "$WORK/keys.txt"
mkdir -p "$WORK/site"

echo "[cloudrun] listing the snapshot through $BASE ..."
curl -fsS --max-time 60 -H "Authorization: Bearer $TOKEN" "$BASE?prefix=" -o "$WORK/list.json" \
  || { echo "[cloudrun] ERROR: list failed — keeping the current revision." >&2; exit 1; }

python3 - "$WORK/list.json" > "$WORK/keys.txt" <<'PY'
import json, sys
objs = json.load(open(sys.argv[1]))['objects']
skip = ('backups/', 'meilisearch/')
for o in objs:
    k = o['key']
    if k.startswith(skip) or k.endswith(('.gz', '.enc', '.snapshot')) or '..' in k or k.startswith('/'):
        continue
    print(k)
PY

ok=0; fail=0
while IFS= read -r k; do
  [[ -n "$k" ]] || continue
  mkdir -p "$WORK/site/$(dirname "$k")"
  if curl -fsS --max-time 120 -H "Authorization: Bearer $TOKEN" "$BASE?key=$k" -o "$WORK/site/$k"; then
    ok=$((ok+1))
  else
    echo "  ! $k"; fail=$((fail+1))
  fi
done < "$WORK/keys.txt"

# A half-downloaded image would replace a working mirror with a broken one.
[[ -s "$WORK/site/index.html" ]] || { echo "[cloudrun] ERROR: index.html missing — refusing to build." >&2; exit 1; }
(( fail == 0 )) || { echo "[cloudrun] ERROR: $fail object(s) failed to download — refusing to build a partial mirror." >&2; exit 1; }
echo "[cloudrun] staged $ok object(s), $(du -sh "$WORK/site" | cut -f1)"

cp "$SRC_DIR/Dockerfile" "$SRC_DIR/nginx.conf" "$WORK/"
printf 'list.json\nkeys.txt\n' > "$WORK/.gcloudignore"

echo "[cloudrun] building and deploying (Cloud Build runs server-side) ..."
cd "$WORK"
gcloud run deploy "$SERVICE" --project="$PROJECT" --source . --region="$REGION" --platform=managed \
  --allow-unauthenticated --max-instances=1 --min-instances=0 --memory=256Mi --cpu=1 --port=8080 \
  --quiet 2>&1 | tail -8

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null | tail -1)"
[[ -n "$URL" ]] || { echo "[cloudrun] ERROR: service URL unknown after deploy." >&2; exit 1; }
echo "[cloudrun] live: $URL"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$URL/")
MARK=$(curl -sI --max-time 30 "$URL/" | grep -i '^x-mirror:' | tr -d '\r' | awk '{print $2}')
echo "[cloudrun] / -> $CODE (x-mirror: ${MARK:-none})"
[[ "$CODE" == "200" && "$MARK" == "gcp-run" ]] || { echo "[cloudrun] ERROR: post-deploy probe failed." >&2; exit 1; }
