# What is actually free in GCP for tukuk.org — and what this project uses

Everything below is the **always-free** tier: a monthly allowance that does not expire
after 90 days and does not require a paid commitment. The billing account
(`017AAF-23F886-A97138`, "tukuk-os") is open because Cloud Run and Cloud Build require a
billing account to exist — being open is not the same as being charged.

A $1 budget with alerts at **1 % / 50 % / 100 %** now watches the project, so a silent
charge cannot run for weeks unnoticed:

```bash
gcloud billing budgets list --billing-account=017AAF-23F886-A97138 \
  --format="table(displayName,budgetAmount.units,thresholdRules[].thresholdPercent)"
# tukuk zero-cost guard  $1
```

## In use today

| Free allowance | What we use it for | Region | Guard rails |
|---|---|---|---|
| Cloud Run: 2M requests, 180k vCPU-s, 360k GiB-s per month | **Rung 2 of the failover ladder** — nginx serving the site snapshot at `https://tukuk-mirror-176041010195.us-central1.run.app` (marker `x-mirror: gcp-run`) | us-central1 | `--min-instances=0` (idles to zero), `--max-instances=1`, 256 MiB / 1 vCPU |
| Cloud Build: 120 build-minutes per day | Rebuilds that Cloud Run image once a week (~1 min per build) | us-central1 | one build per week via `tukuk-cloudrun-mirror.timer` |
| Artifact Registry: 0.5 GB | Holds the one image (~70 MB) | us-central1 | weekly rebuild replaces, never accumulates |
| Cloud Storage: 5 GB standard + 5 000 class-A ops + 100 GB egress from North America | **Third copy of the backup vault** — `gs://tukuk-os-offsite/r2/backups/` (encrypted identity tarballs, content snapshot, newest 12 data slices) | us-central1 | `gcs-offsite-sync.sh` refuses to mirror past 4 GB; objects deleted after 60 days |
| e2-micro: 1 instance-month (744 h) | The older mirror VM (`instance-free`) — **kept in reserve, stopped** | us-central1 | see "Cost traps" |
| 30 GB standard persistent disk | That VM's boot disk | us-central1 | inside the 30 GB total |

Timers on the home box (all `Persistent=true`, so a missed run fires after boot):

```bash
systemctl list-timers 'tukuk-*' --no-pager
#  01:40/07:40/13:40/19:40  tukuk-mirror-pull.timer      (VM rung, 6h)
#  Sun 04:20                 tukuk-gcs-offsite.timer     (GCS third copy, weekly)
#  Sun 04:50                 tukuk-cloudrun-mirror.timer (Cloud Run rebuild, weekly)
#  12:38                     tukuk-snapshot.timer        (R2 snapshot, 6h)
```

## Available but deliberately unused

| Free allowance | Why not (yet) |
|---|---|
| Cloud Functions: 2M invocations, 400k GB-s | Cloud Run already gives us a container with a public URL; a second serverless runtime adds nothing. Worth revisiting if a stateless job appears (image resize, PDF render) that would otherwise eat the box's CPU. |
| Firestore: 1 GiB, 50k reads / 20k writes per day | The site's state lives in `data/*.json` on the box and in D1/R2. Moving it would add a network round-trip to every page for no benefit. |
| BigQuery: 1 TiB queries, 10 GiB storage | Analytics already arrive via Cloudflare Analytics Engine. Only worth it if we ever need SQL over request logs. |
| Cloud Scheduler: 3 jobs | Uptime is already checked from two independent places (the worker and the R2 mirror). A scheduler job hitting `/health` would be a *third* opinion, not a fix. |
| Translation API: 500k chars per month | A real upgrade over the free MyMemory endpoint the chat translator uses today (which returns poisoned/echo answers). Needs a code change and an API key before it can be switched on. |
| Vision 1 000 units, Speech-to-Text 60 min, TTS 4M chars | No current feature needs them. |
| Secret Manager: 6 active versions | The box keeps secrets in root-owned 0600 files; adding Secret Manager means the runtime must fetch them at boot, which is a new failure mode for a single-tenant box. |

## Cost traps to keep in mind

1. **Two e2-micro VMs are not free.** The allowance is *one* instance-month (744 h) in
   total, across the whole billing account — not one per zone and not one per project.
   A second running instance is billed from hour one.
1. **A running VM's external IPv4 is billable** (~$0.005/h ≈ $3.6/month) even though the
   instance itself is free. This is why the mirror moved to Cloud Run, and why the e2-micro
   is stopped rather than left running.
1. **A stopped VM still keeps its disk** — 30 GB stays inside the free 30 GB, so parking
   the VM costs nothing and nothing is lost.
1. **Egress is the other meter.** VM egress is 1 GB/month from North America; Cloud Run and
   Cloud Storage have their own allowances. Serving a 22 MB site copy thousands of times
   from Cloud Run is well inside 360k GiB-s but watch `2M requests` if the mirror ever
   becomes the primary.
1. **Cloudflare R2 stays the vault** (10 GB, zero egress). GCS holds a *bounded slice* of
   it, not a second full copy.

## How to check you are still inside the free tier

```bash
# what exists and what it costs to keep existing
gcloud compute instances list --format="table(name,zone,machineType.basename(),status)"
gcloud run services list --format="table(metadata.name,status.url,spec.template.metadata.annotations)"
gcloud storage du -s gs://tukuk-os-offsite

# the guard itself
gcloud billing budgets list --billing-account=017AAF-23F886-A97138 --format=json | head -40
```

If the budget alert fires, the first three suspects are, in order: a second VM, an
external IP left attached, or egress beyond an allowance.
