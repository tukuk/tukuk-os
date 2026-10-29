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
| Cloud Run: 2M requests, 180k vCPU-s, 360k GiB-s **and 1 GB egress** per month | **Rung 3 — the last resort** of the failover ladder: nginx serving the site snapshot at `https://tukuk-mirror-176041010195.us-central1.run.app` (marker `x-mirror: gcp-run`). Reached only when the R2 snapshot has no copy of the page or R2 itself is failing, because it is the one rung with a metered ceiling. Measured usage is printed by `verify-free-tier.sh` (Oct 2026: **88 requests / 1.4 MB of 1 GB**) | us-central1 | `--min-instances=0` (idles to zero), `--max-instances=1`, 256 MiB / 1 vCPU, and `MIRROR_URL=off` to demote the ladder to R2 alone |
| Cloud Build: 2,500 build-minutes per month (e2-standard-2) | Rebuilds that Cloud Run image once a week (~1 min per build) | us-central1 | one build per week via `tukuk-cloudrun-mirror.timer` |
| Artifact Registry: 0.5 GB | Holds the one image (~70 MB) | us-central1 | weekly rebuild replaces, never accumulates |
| Cloud Storage: 5 GB standard + 5 000 class-A ops + 100 GB egress from North America | **Third copy of the backup vault** — `gs://tukuk-os-offsite/r2/backups/` (encrypted identity tarballs, content snapshot, newest 12 data slices) | us-central1 | `gcs-offsite-sync.sh` refuses to mirror past 4 GB; objects deleted after 60 days |
| e2-micro: 1 instance-month (744 h) | The older mirror VM (`instance-free`) — **parked, `TERMINATED` since 29 Oct 2026 08:23 +08, no external IP** | us-central1-a | see "Cost traps" |
| 30 GB standard persistent disk | That VM's boot disk (kept so the identity survives) | us-central1-a | exactly 30 GB — the whole allowance, no headroom |

Timers on the home box (all `Persistent=true`, so a missed run fires after boot):

```bash
systemctl list-timers 'tukuk-*' --no-pager
#  04:25 next Sunday         tukuk-gcs-offsite.timer     (GCS third copy, weekly)
#  04:50 next Sunday         tukuk-cloudrun-mirror.timer (Cloud Run rebuild, weekly)
#  6-hourly                  tukuk-snapshot.timer        (R2 snapshot)
```

Nothing on the box talks to the VM any more: the old `tukuk-mirror-pull.timer` lived *on the
VM* and went to sleep with it. Rung 3 is Cloud Run, rebuilt by the box from the R2 gateway.

## Parked on purpose: the e2-micro

`instance-free` is stopped, not deleted — the boot disk, the identity and the startup script
are still there in case the Cloud Run path ever has to be abandoned:

```bash
# bring it back (start charging ~$0.005/h for an external IP again)
gcloud compute instances start instance-free --zone=us-central1-a

# confirm it is parked
gcloud compute instances list --format="table(name,zone.basename(),status,EXTERNAL_IP)"
# NAME           ZONE           STATUS      EXTERNAL_IP
# instance-free  us-central1-a  TERMINATED
```

A stopped instance bills nothing for compute or network; only its disk counts, and 30 GB is
the free allowance itself.

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
   the VM costs nothing and nothing is lost. It also leaves *zero* headroom: a second
   30 GB disk in the same billing account is billed from the first byte.
1. **Tunnel #2's connector ran on that VM.** With the VM parked it cannot connect, so the
   `www.tukuk.org → VM` route is dead. That is intended — the ladder's metered rung 3 is
   Cloud Run now — but do not "fix" the tunnel before starting the VM again.
1. **Egress is the other meter, and Cloud Run's free egress is only 1 GB/month** from North
   America. At ~128 KB per cached page that is roughly **7,800 mirror views a month** — so on
   29 Oct the ladder was **reordered**: the free R2 snapshot (no egress charge at all, 6 h
   fresh, no cold start) became rung 2, and the metered mirror became rung 3. A blackout drill
   confirmed the new order — `/`, `/about`, `/learn`, `/theme.css` all answered from R2 and
   the Cloud Run host was never dialed. Only a page the snapshot does not contain still
   reaches the mirror, and that returns a 153-byte 404.
1. **Cloud Run egress is measured, not assumed.** `verify-free-tier.sh` sums the mirror's own
   nginx access log (Cloud Logging, free) for the current calendar month and warns past 700 MB.
1. **VM egress is 1 GB/month** from North America; Cloud Storage has its own 100 GB/month
   (NA origins). Serving a 22 MB site copy from Cloud Run is comfortably inside 360k GiB-s of
   memory time — the request count and the egress bytes are the ones to watch.
1. **Unused allowance does not carry over.** Every line resets on the 1st; burning 2,000
   build-minutes in week one leaves 500 for the rest of the month.
1. **Cloudflare R2 stays the vault** (10 GB, zero egress). GCS holds a *bounded slice* of
   it, not a second full copy.

## The Cloudflare side of "free forever" (measured, not assumed)

GCP is only half of the footprint. Cloudflare's free allowances bound the rest, and one of
them was quietly heading for a bill:

| Free allowance | Our exposure | Status |
|---|---|---|
| R2: **10 GB stored per account** (all buckets together), 1M Class A / 10M Class B ops per month, **egress is always free** | 7 buckets, 367 objects, **1.644 GB (16.4 %)** — 1.34 GB of it is the 168 hourly `backups/` slots, 242 MB is frozen meili history | `scripts/r2-inventory.sh`, exit 1 past 6 GB or on any unbounded writer |
| Workers: 100k requests/day, free plan | the brain only sees `worker.tukuk.org` traffic, nowhere near 100k/day | watching; exceeding it means the \$5/mo plan, not a per-request bill |
| Zone redirect + proxying | free plan | fine |

**The trap that was actually in there:** `scripts/backup-meili.sh` and `backup-chat.sh` wrote
a **date-stamped key on every run** (`meilisearch/2026/10/28/meili_halaman_web-20261028T221500Z.json.gz`)
and nothing ever deleted those. Meilisearch dumps alone were ~20 MB/day — 600 MB/month, every
month, forever, toward a hard 10 GB ceiling. Left alone it becomes a paid bucket in about a
year. Both scripts now write **slot keys** (`meilisearch/slot-<weekday><hour>/meili_halaman_web.json.gz`),
so the object is overwritten in place: a bounded 7 days of history at 6-hour granularity, at
most ~28 meili + 28 store + 168 chat objects, and no delete API needed. That is the same
design `backup-data.sh` already used for the 168 `backups/` slots. The 17–28 Oct dated objects
(~263 MB) were **left in place** — they are history, they no longer grow, and deleting backups
is not an audit's job.

`scripts/r2-inventory.sh` is the guard. It walks **every bucket in the account** (the 10 GB
is an account ceiling, not a per-bucket one), splits prefixes into *bounded* (slot/fixed
keys) and *date-stamped*, names the biggest objects, and exits 1 if the account is over 60 %
of the ceiling or a date-stamped prefix is **still being written** after the 29 Oct cutover
(`laptop-backup` is exempt — it prunes its own cloud keys). Verified on the box the same day:
`meili-backup.service` and `chat-backup.service` each wrote one `slot-401/…` object and the
inventory lists those prefixes as bounded with 1 object. Because 168 slots each hold one
`data.tar.gz`, the bucket tracks roughly **168 × the size of `data/`**: today that is 18 MB →
1.34 GB, and a ~60 MB `data/` would be what touches 10 GB. The warning fires long before
that. One incidental find: `tukuk-os-backups` holds 22 MB of 6–8 Oct meili/store history from
before the backup worker was repointed at `tukuk-fallback` — frozen, harmless, left alone.

## How to check you are still inside the free tier

One command, read-only, exits non-zero if anything billable appears:

```bash
deploy/gcp/verify-free-tier.sh
# == Cloud Run   minScale: 0 (0 = scale to zero)
# == metered mirror usage   96 requests, 1.40 MB sent — 0.14% of the 1 GB allowance
# == Compute     instance-free  TERMINATED
# == other projects   ai-agent-offline  compute=off (no VMs possible, no spend)
# == domain renewal   tukuk.org expires 2027-09-17 (323 days out)
# RESULT: clean — nothing billable found.

bash scripts/r2-inventory.sh      # the Cloudflare half of the same question
```

To park or un-park the VM (idempotent — safe to run twice):

```bash
deploy/gcp/park-vm.sh
```

Manual equivalents:

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

Two free allowances have already been defused here:

* **`gs://run-sources-polar-office-460107-j9-us-central1`** — Cloud Build parks the deploy
  tarball here on every `gcloud run deploy --source` (~15 MB per build). A 30-day
  auto-delete rule now keeps it from creeping toward the 5 GB limit; at one build a week
  it settles at a handful of objects.
* **The two other projects on this account** (`ai-agent-offline`, `test-1-3fe04`) have the
  Compute Engine API **never enabled**, so they cannot hold a VM and cost nothing. That is
  also why scanning them for instances hangs or errors — not a leak.

## What money still has to buy (two things, and only two)

Everything that runs the site is inside a free allowance. Two dependencies are not free, and
both are worth more than they cost — this is the honest remainder of "free forever":

1. **The domain: ~US\$11–13 a year.** `tukuk.org` expires **2027-09-17** (verified by RDAP,
   and printed by `verify-free-tier.sh`, which warns inside 60 days). Nothing else matters if
   this lapses — the site, the backups and the fallback all point at that name. Check that
   **auto-renew is on** at the registrar, and that the card/paypal behind it is still live.
   Cheapest real option: register for several years in one go if the registrar discounts it.
2. **A UPS for the box + router (one-off, ~RM150–350).** There is no battery anywhere in this
   design: `/sys/class/power_supply` on the box is empty and no USB UPS is attached, so a
   power cut takes the origin down *and* stops the 6-hourly timers that keep the R2 snapshot
   fresh — the failover then serves a stale copy, and every backup job is skipped until power
   returns. The box is an AMD RX-427BB mini/desktop (4 cores, 7 GB, one 512 GB SSD) drawing
   roughly 25–45 W, so a 650 VA / 360 W unit covers the box plus the router for tens of
   minutes — long to ride out a flicker, and long enough to shut down cleanly in a real
   outage. Pair it with `apcupsd` (or NUT) calling `systemctl stop tukuk-os.service` at 20 %
   battery so an outage cannot corrupt `data/*.json` mid-write.

Everything else considered and **rejected as not worth money**: a Cloudflare paid plan (the
free tier is not close to its limits), a VPS as a second origin (Cloud Run already gives an
independent, always-free machine), GPUs or any training hardware (never free in any tier),
and a second GCS bucket (the free 5 GB-month is already shared with `run-sources`).
