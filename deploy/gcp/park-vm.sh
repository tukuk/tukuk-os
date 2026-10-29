#!/usr/bin/env bash
# park-vm.sh — stop the e2-micro that hosts the old mirror, and prove nothing was lost.
#
# Why: an always-free e2-micro costs nothing, but a RUNNING VM's ephemeral external IPv4 is
# billed at ~$0.005/h (≈ $3.6/month) and is not inside any allowance. Rung 2 of the failover
# ladder is Cloud Run now, so the VM has no job. Stopping it — not deleting it — releases the
# address, keeps the boot disk (30 GB, exactly the free PD allowance) and the machine's
# identity, and is reversible with one command.
#
# Run ON THE HOME BOX as the tukuk user. Requires gcloud; it is not on PATH over ssh.
set -euo pipefail
export PATH="${HOME}/google-cloud-sdk/bin:${PATH}"
export CLOUDSDK_CONFIG="${HOME}/.config/gcloud"

NAME=instance-free
ZONE=us-central1-a

echo "[park] before:"
gcloud compute instances describe "$NAME" --zone="$ZONE" \
  --format='value(name,status,networkInterfaces[0].accessConfigs[0].natIP)' 2>&1

STATUS=$(gcloud compute instances describe "$NAME" --zone="$ZONE" --format='value(status)')
if [ "$STATUS" = "TERMINATED" ]; then
  echo "[park] already parked — nothing to do"
else
  echo "[park] stopping $NAME ($ZONE) ..."
  gcloud compute instances stop "$NAME" --zone="$ZONE" --quiet | tail -2
  for _ in $(seq 1 24); do
    STATUS=$(gcloud compute instances describe "$NAME" --zone="$ZONE" --format='value(status)')
    [ "$STATUS" = "TERMINATED" ] && break
    sleep 5
  done
fi

echo "[park] after:"
gcloud compute instances list --format='table(name,zone.basename(),status,EXTERNAL_IP)' 2>&1 \
  | sed 's/^/  /'

# A stopped instance keeps its disk; that disk must stay inside the 30 GB free allowance.
echo "[park] disks (30 GB total is free — anything beyond is billed):"
gcloud compute disks list --format='value(name,sizeGb,status)' 2>&1 | sed 's/^/  /'

# Unattached static addresses bill even when unused; there should be none.
echo "[park] reserved addresses (must be empty):"
gcloud compute addresses list --format='value(name,address,status)' 2>&1 | sed 's/^/  /'

echo "[park] done. Reverse with:"
echo "  gcloud compute instances start $NAME --zone=$ZONE"
