# GCP Failover Mirror + `worker.tukuk.org` brain

This runbook stands up an **independent backup origin** for tukuk.org on Google
Cloud's always-free tier, and re-lights the `tukuk-fallback` Cloudflare Worker as the
**brain** that fails over to it. Nothing here costs money when used within the free
limits — but two account states (below) must be fixed by a human in a browser before
any of it can run.

## Topology (target)

```
                                    ┌──────────────────────────────┐
  visitor ──▶ Cloudflare edge ──┬──▶ │ TUNNEL #1 (home box)         │
                               │     │   tukuk.org (apex) ─▶ box    │  PRIMARY (dynamic)
                               │     │   nginx :3000 ─▶ Node :3001  │
                               │     └──────────────────────────────┘
                               │
                               ├──▶ WORKER (brain) on worker.tukuk.org
                               │      try apex ─▶ 5xx/throw ─▶ R2 snapshot ─▶ GCP mirror ─▶ 503
                               │
                               └──▶ ┌──────────────────────────────┐
                                     │ TUNNEL #2 (GCP VM)           │  BACKUP (static)
                                     │   www.tukuk.org ─▶ VM nginx  │
                                     │   :8080 ─▶ /var/www/tukuk-    │
                                     │   mirror (R2 snapshot, 6h)   │
                                     └──────────────────────────────┘
```

* **`tukuk.org` (apex)** — unchanged. Tunnel #1 → the home box. Full dynamic site.
* **`worker.tukuk.org`** — the brain Worker. Proxies the apex; on origin 5xx or a
  thrown fetch (blackout / dropped connector) it serves the **free R2 static snapshot**
  first, then the **metered GCP mirror** (only when the snapshot has no copy), then `503`.
  Also hosts the `/edge-backup` R2 gateway.
* **`www.tukuk.org`** — a static copy of the site on **Cloud Run** (`x-mirror: gcp-run`),
  rebuilt weekly from the R2 snapshot. The older route — Tunnel #2 on the e2-micro — is
  **parked** (see "Where this actually stands").

> **Read the status section first.** Parts B–G below describe the *VM + Tunnel #2* build of
> rung 3. That build was completed and then superseded: the VM is stopped and rung 3 is a
> Cloud Run service, which needs no DNS record, no tunnel and no external IP. The Parts stay
> as the rebuild recipe if the VM path is ever needed again.

### The one caveat to accept up front
Because you kept **apex unchanged (direct tunnel)**, when the box is down a visitor
typing `tukuk.org` sees the Cloudflare `530` — the backup is reached at `www` /
`worker`. Automatic, transparent failover *on the apex itself* is **Phase 6** (last
section) and needs routing `tukuk.org/*` through the brain — deliberately deferred.

---

## ⚠️ Two blockers — a human must clear these first

1. **~~Open GCP billing.~~ CLEARED 29 Oct 2026** — `billingEnabled` is now `True` and the
   free VM is parked (see the status section above). Original note kept for context: a
   closed billing account (`OPEN: False`) blocks **every** resource, even always-free at $0.
2. **Cloudflare dashboard access.** The `cfut_…` token has **Workers + R2 scope only**
   — it cannot create DNS records, tunnels, public hostnames, or Worker **routes**. So
   every DNS/tunnel/route change below is done in the dashboard. The token *can* deploy
   the Worker code (`wrangler deploy`) and set Worker secrets/vars.

Everything in the repo (Worker code + tests, `mirror-pull.sh`, `setup-mirror.sh`, the
tunnel/unit templates, this runbook) is committed. You run the console/dashboard parts.

---

## ✅ Where this actually stands (29 Oct 2026)

Parts A, B, D, E and F are done, with two deliberate deviations from the text below — read
this before following any later Part.

* **Billing is open** (`billingEnabled: True`). One e2-micro exists: `instance-free`,
  **`us-central1-a`** (not `us-west1-a`/`tukuk-mirror` as Part B says), 30 GB pd,
  tag `tukuk-mirror`, **`TERMINATED` since 29 Oct 08:23 +08, external IP released**.
  It is the *only* instance in the project: the free tier is **one e2-micro instance-month
  in total**, not one per zone, so a second VM (another zone, or the same name in another
  project) is billed. Restart with
  `gcloud compute instances start instance-free --zone=us-central1-a`.
* **The brain is live on `worker.tukuk.org` with no DNS scope at all** — it was attached as
  a Workers **custom domain** (`PUT /accounts/{acc}/workers/domains`), which lets Cloudflare
  create the record itself. `GET /health` proxies the box; `/edge-backup` lists 341 objects
  with the read token and answers 403 without it.
* **`MIRROR_READ_TOKEN` exists now.** Before that the deployed build only accepted
  `UPLOAD_SECRET`, so every mirror read came back `forbidden` — the two-tier auth in the
  code was effectively not deployed.
* **Tunnel #2 is token mode, not credentials-file mode.** It is created through the API
  (`POST /accounts/{acc}/cfd_tunnel` with `config_src: cloudflare`) and its ingress is set
  with `PUT /accounts/{acc}/cfd_tunnel/{id}/configurations`, so
  `deploy/cloudflared/gcp-config.yml` is reference-only. Connector installed on the VM with
  `cloudflared service install <token>`; tunnel `16359e22-3a06-4012-abc0-3b1c3cf7204a`.
  **Its connector ran on the VM, so it is offline while the VM is parked** — which is fine,
  nothing routes through it any more.
* **The 6 h puller lives on the VM too** and is idle with it. It read
  `MIRROR_BASE=https://worker.tukuk.org/edge-backup` (92 objects, ~21.9 MB, 0 failed,
  atomic symlink swap, newest 3 releases kept) whenever the VM was up.

### Rung 3 moved to Cloud Run (29 Oct 2026)

A running VM's ephemeral external IPv4 is billed at ~$0.005/h — about **$3.6/month**, the one
recurring charge this design created, and not inside any always-free allowance. A VM without
an external IP would need Cloud NAT (also billed) just to let cloudflared dial out. So rung 3
became a **Cloud Run** service instead, which is inside the always-free tier, scales to zero
when idle, and — crucially — gets a `*.run.app` hostname that **resolves without any DNS
record**, the exact thing we could not create.

```bash
gcloud run services describe tukuk-mirror --region=us-central1 --format='value(status.url)'
# https://tukuk-mirror-176041010195.us-central1.run.app   (x-mirror: gcp-run)
```

`MIRROR_URL` in `wrangler.jsonc` points at that URL, so **the `mirror.tukuk.org` CNAME in the
old plan is no longer required** — do not add it. Rebuild weekly with
`deploy/gcp/cloudrun/cloudrun-mirror-rebuild.sh` (unit `tukuk-cloudrun-mirror.timer`); the
runbook for the free tier as a whole is `deploy/GCP-FREE-TIER.md`.

**Blackout drill, 29 Oct 07:47 (+08)** — `systemctl stop cloudflared` on the box for ~15 s,
probing `worker.tukuk.org` with a unique query string each time:

| request | origin healthy | during the blackout |
|---|---|---|
| `/` | 200, 127,478 B | 200, 127,373 B — the cold snapshot |
| `/about` | 200, 5,893 B | 200, 6,193 B — the cold snapshot |
| `/learn` | 200 | 200, 38,310 B, “Tukuk-OS Academy: Zero to Hero” |
| `/theme.css` | 200 | 200, 6,178 B |
| `/health` | 200 JSON | **503** “API unavailable” — by design |

Recovery was immediate (`cloudflared active`, apex 200, `/` back to 127,478 B). Two defects
surfaced while wiring that drill, both fixed in the same pass:

* the brain looked up `FALLBACK_BUCKET.get(path)`, but the snapshot stores `about.html` and
  `learn/index.html` — so **every deep link 503'd** during a blackout instead of serving its
  cold copy. It now tries `<path>.html`, `<path>/index.html`, then the raw key.
* the mirror's nginx had `try_files $uri $uri/ $uri/index.html`; `$uri` matches an existing
  *directory*, so `/learn` 301'd to `/learn/` before any file was tried, and `/about` never
  resolved at all. The order is now `$uri.html $uri/index.html $uri $uri/`.

The R2 snapshot itself covers 11 pages (`/`, `/about`, `/contact`, `/privacy`, `/terms`,
`/docs`, `/explore`, `/access`, `/nasa`, `/blog`, `/learn`), `search-index.json` and the
`public/` assets — content routes outside that list (e.g. `/art`, `/traffic`) still 503 in a
blackout, which is the accepted trade-off for a 22 MB snapshot.

### The free rung moved in front of the metered one (29 Oct 2026)

The ladder used to try Cloud Run *before* R2. Two things made that the wrong order:

* Cloud Run's always-free allowance ends at **1 GB of outbound egress per month** — the only
  billable path left anywhere in this design. R2 has no egress charge at all.
* the mirror's own access log showed it being dialed for pages it could only ever 404
  (`/history/02/07`, `/mountains/bald-mountain-uinta-range` → `404`, 153 B each). Every such
  miss burned metered egress to return nothing.

So the snapshot became rung 2 and Cloud Run rung 3: same cold-copy source, zero egress, ~6 h
fresh, no cold start. Two safety changes shipped with it — `MIRROR_URL` set to `off` now
removes rung 3 entirely without a redeploy, and the `DEFAULT_MIRROR = 'https://www.tukuk.org'`
fallback is gone (that host is a zone redirect to the apex, so during an outage it handed
visitors a `301` straight back into the dead origin).

**Reorder drill, 29 Oct (+08)** — `.artifacts/drill3-reorder.sh`, same ~12 s blackout, rung
detected from the response headers:

| request | during the blackout | rung |
|---|---|---|
| `/` | 200, 127,372 B | `R2-free` |
| `/about` | 200, 6,193 B | `R2-free` |
| `/learn` | 200, 38,310 B | `R2-free` |
| `/theme.css` | 200, 6,178 B | `R2-free` |
| `/health` | **503** | by design |

The Cloud Run service logged **no** request during the drill — the metered host was never
dialed — and the apex was 200 again immediately after restore. 16 worker tests pass
(`npm test` in `cloudflare-worker/tukuk-fallback`).

---

## Part A — Enable the GCP project for the free tier
```bash
# from the box (gcloud is at /home/tukuk/google-cloud-sdk/bin — not on PATH in ssh)
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud auth list                                   # → the operator's Google account (not written here)
gcloud config set project polar-office-460107-j9
gcloud billing projects describe polar-office-460107-j9   # billingEnabled must be true
```
If `billingEnabled` is false, do **not** continue — open billing in the console first.

## Part B — Create the always-free mirror VM
Free tier = **1 × e2-micro, 720 h/mo, only in `us-west1` / `us-central1` / `us-east1`**.
Staying in `us-west1-a` keeps it free. Nothing inbound is needed (cloudflared dials out).
```bash
gcloud compute instances create tukuk-mirror \
  --zone=us-west1-a --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30 --boot-disk-type=pd-balanced \
  --no-address \
  --tags=tukuk-mirror
```
`--no-address` (no external IP) is fine: you will administer it through **IAP SSH**
(`gcloud compute ssh`), and cloudflared only needs *outbound* access, which egresses
via the VPC's default route. If IAP outbound is blocked, give it an ephemeral external
IP instead (still free — the free tier includes one).

Firewall for IAP SSH (one-time):
```bash
gcloud compute firewall-rules create allow-ssh-iap \
  --network=default --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=tukuk-mirror
gcloud compute ssh tukuk-mirror --zone=us-west1-a   # you are in
```

## Part C — Create Tunnel #2 and point `www.tukuk.org` at the VM
This is **dashboard** work (the token can't). Key difference from the box: this tunnel
uses a **local config file with `ingress:`** (legacy-connector style), *not* token mode —
so hostname routes come from `deploy/cloudflared/gcp-config.yml` and cannot be shadowed
by the box tunnel.

On the VM (as the admin user, then `sudo` where noted):
```bash
# 1. Install cloudflared (setup-mirror.sh in Part D also does this; either is fine).
# 2. Authenticate to your Cloudflare account (opens a browser URL you paste back):
cloudflared tunnel login
# 3. Create a brand-new tunnel with its OWN name (do NOT reuse the box's tunnel):
cloudflared tunnel create tukuk-gcp-mirror
#    -> writes ~/.cloudflared/<TUNNEL_ID>.json ; prints the TUNNEL_ID (a UUID)
# 4. Copy the credentials where the service (root) reads them:
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
sudo chmod 600 /etc/cloudflared/<TUNNEL_ID>.json
```
**Do NOT `tunnel route dns` yet, and do NOT touch the box tunnel.** We cut `www` over in
Part G only after the mirror is verified serving.

## Part D — Bootstrap the VM (nginx + cloudflared + timer), then run it
Copy the four source files onto the VM in one directory and bootstrap. From your
**laptop** (which has the repo), scp them via IAP:
```bash
gcloud compute ssh tukuk-mirror --zone=us-west1-a --command 'mkdir -p ~/mirror-deploy'
for f in deploy/cloudflared/gcp-config.yml scripts/mirror-pull.sh \
         deploy/gcp/tukuk-mirror-pull.service deploy/gcp/tukuk-mirror-pull.timer \
         deploy/gcp/setup-mirror.sh; do
  gcloud compute scp "$f" "tukuk-mirror:~/mirror-deploy/" --zone=us-west1-a
done
```
Then **on the VM**:
```bash
cd ~/mirror-deploy
sudo TUNNEL_ID=<TUNNEL_ID> bash setup-mirror.sh
```
This installs nginx on `127.0.0.1:8080` (serving `/var/www/tukuk-mirror`, marker header
`x-mirror: gcp`), a placeholder index so the tunnel can be tested before the first pull,
the cloudflared config (from `gcp-config.yml`, `<TUNNEL_ID>` substituted), and the 6h
`tukuk-mirror-pull.timer`.

## Part E — The two secrets (write vs read) and the worker vars
The brain needs to know *where* to proxy and *where* to fail over to; the VM needs a
**read-only** key so a stolen VM cannot poison a backup.

1. **Generate a read token** and a write secret (if you don't already have the write
   secret the box's backup timers use):
   ```bash
   openssl rand -hex 24   # MIRROR_READ_TOKEN  → give to the VM AND the worker
   openssl rand -hex 24   # UPLOAD_SECRET      → the box's backup timers already set this
   ```
2. **On the VM**, drop the read token into the env file `setup-mirror.sh` created:
   ```bash
   sudo tee /etc/tukuk-mirror.env >/dev/null <<EOF
   MIRROR_READ_TOKEN=<read token>
   MIRROR_BASE=https://worker.tukuk.org/edge-backup
   EOF
   sudo chmod 600 /etc/tukuk-mirror.env
   ```
3. **On the Worker** (from the repo's `cloudflare-worker/tukuk-fallback/`), set secrets +
   vars. The token has Workers scope, so this works from the box/laptop:
   ```bash
   cd cloudflare-worker/tukuk-fallback
   wrangler secret put UPLOAD_SECRET          # paste write secret (write path)
   wrangler secret put MIRROR_READ_TOKEN      # paste read token (the GET path)
   # optional (code already defaults these; set only to override):
   #   ORIGIN=https://tukuk.org   MIRROR_URL=https://www.tukuk.org
   ```
4. Do a **first manual pull** on the VM to confirm it works before trusting the timer:
   ```bash
   sudo systemctl start tukuk-mirror-pull.service
   journalctl -u tukuk-mirror-pull.service -b --no-pager | tail -30
   ```
   You should see it list objects, copy the pages, and `✓ swapped`. If it says "no mirror
   objects listed", the box's `tukuk-snapshot.timer` has not populated R2 yet — run
   `bash scripts/snapshot-r2.sh` on the box.

## Part F — Route the brain on `worker.tukuk.org`
1. **Deploy** the worker code (Workers-scope token is enough):
   ```bash
   cd cloudflare-worker/tukuk-fallback && wrangler deploy
   ```
2. **Dashboard** (token can't): Workers & Pages → `tukuk-fallback` → **Routes** →
   add `worker.tukuk.org/*` (zone `tukuk.org`, environment Production). Cloudflare
   prompts to create the `worker.tukuk.org` DNS record (proxied) — accept.

Verify the brain is in front of `worker.tukuk.org`:
```bash
curl -sS -o /dev/null -D- https://worker.tukuk.org/            # 200 via proxy while apex healthy
curl -sS  https://worker.tukuk.org/health                      # JSON from the origin, not the mirror
```

## Part G — Cut `www.tukuk.org` over to the GCP mirror (safely)
Do this **only after** Part D/H show the mirror serving real content.
1. **Dashboard → Zero Trust → Networks → Tunnels → `tukuk-gcp-mirror` → Public Hostname**
   → add `www.tukuk.org` → `HTTP://localhost:8080` (this is Tunnel #2's route; the VM's
   local `ingress:` also declares it — either path works, but with a credentials-file
   tunnel the dashboard route is what Cloudflare enforces, so add it there to be explicit).
2. Confirm `www` now comes from GCP:
   ```bash
   curl -sS -D- -o /dev/null https://www.tukuk.org/ | grep -i x-mirror   # -> x-mirror: gcp
   ```
3. **Remove `www.tukuk.org` from the home box tunnel** (Dashboard → Tunnel #1 → delete the
   www public hostname), and later delete the `www` ingress line from the box's
   `/etc/cloudflared/config.yml`. From this point `www` no longer depends on the box.

## Part H — Verification + fault drill
1. Normal: apex 200, `worker.tukuk.org/` proxies apex (200, no `x-mirror`),
   `www.tukuk.org/` serves GCP (`x-mirror: gcp`).
2. **Blackout drill** — simulate the tunnel/box dying *briefly*:
   ```bash
   # on the home box:
   sudo systemctl stop cloudflared
   curl -sS -D- -o /dev/null https://worker.tukuk.org/ | grep -i x-mirror   # -> gcp  (mirror)
   curl -sS https://worker.tukuk.org/ | grep -i 'backup mirror\|tukuk'       # mirror body
   sudo systemctl start cloudflared                                         # restore fast
   ```
   **Prove it at the bytes/marker layer, not just `200`** — the front-proxy cache can
   serve a fast 200 that never left the box. Keep the `stop` window short.
3. Confirm free-tier headroom: `gcloud compute instances describe tukuk-mirror` (zone is
   `us-west1-a`), disk < 30 GB, and Workers requests < 100k/day.

## Part I — What "the 20 free things" really is (limits you must respect)
| Resource | Free limit | This design uses |
|---|---|---|
| GCP e2-micro VM | 720 h/mo, **only us-west1/us-central1/us-east1** | 1 VM, in `us-west1-a` → free |
| GCP standard persistent disk | 30 GB total | 30 GB `pd-balanced` (watch `pd-ssd` is a smaller 10 GB pool) |
| GCP outbound (VM) | 1 GB/mo to most places free | tiny (pulls from Cloudflare edge; may bill as egress — keep the snapshot small) |
| Cloudflare Workers | 100,000 requests/day | the brain only — apex traffic does NOT go through it |
| Cloudflare R2 | 10 GB storage, **0 egress** | the mirror + backups already live here |
| Cloudflare Tunnel | free, unlimited tunnels | Tunnel #2 is free |

Keep the VM strictly on `us-west1-a` and sized e2-micro, or the "free" guarantee lapses.

## Part J — Failure modes & rollback
* **Mirror stale** (pull failing): `journalctl -u tukuk-mirror-pull.service`. Usually the
  read token is empty in `/etc/tukuk-mirror.env`, or the box hasn't run `snapshot-r2.sh`.
* **Brain loops / returns nothing**: check the worker `ORIGIN` var isn't accidentally set
  to `worker.tukuk.org` (must be the apex `https://tukuk.org`). The `global_fetch_strictly_public`
  flag means `ORIGIN` must be a *public* hostname not behind this same worker route.
* **`www` 502 from cloudflared**: the VM nginx isn't on `127.0.0.1:8080`, or the tunnel
  route points elsewhere. `sudo systemctl status nginx`; `curl 127.0.0.1:8080` on the VM.
* **Rollback**: re-add `www.tukuk.org` to the home box tunnel (Part C step it removed) and
  delete the `worker.tukuk.org` route — the site is exactly as it was before this project.
  Nothing here removes the box's `www` until Part G, and G is reversible.

## Part K — (Optional) Phase 6: transparent apex failover
To make `tukuk.org` itself fall back automatically (so visitors never see `530`), the
brain must sit **in front of the apex**, and it must proxy to an origin hostname that is
*not* itself worker-routed (or Cloudflare loops back into the worker).
1. Add a **non-worker-routed** `origin.tukuk.org` public hostname → box `localhost:3000`.
2. Set the worker var `ORIGIN=https://origin.tukuk.org` and add a Worker route
   `tukuk.org/*`. Now apex traffic hits the brain → box, and degrades to the mirror/R2 on
   outage. This changes apex DNS, so do it **only after Parts A–H are proven**.

---

## Files this project ships (already in the repo)
* `cloudflare-worker/tukuk-fallback/src/index.ts` — env `ORIGIN`/`MIRROR_URL`,
  GCP-mirror → R2 fallback ladder, dropped `www→apex` 301, two-tier `/edge-backup` auth.
* `cloudflare-worker/tukuk-fallback/test/index.spec.ts` — 11 vitest cases for the ladder,
  API/mutation policy, and read/write secret enforcement (`npx vitest run` in that dir).
* `scripts/mirror-pull.sh` — VM puller (read-only key, atomic symlink swap, hard-fail on
  zero objects).
* `deploy/gcp/setup-mirror.sh` — VM bootstrap (nginx `:8080`, marker header, releases
  layout, cloudflared, timer).
* `deploy/gcp/tukuk-mirror-pull.{service,timer}` — 6h refresh, `Persistent=true`.
* `deploy/cloudflared/gcp-config.yml` — Tunnel #2 ingress (`www → 127.0.0.1:8080`).
* Edits: `scripts/snapshot-r2.sh` + `deploy/cloudflared/config.yml` comments reflect the
  mirror being a live fallback again.
