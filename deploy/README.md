# One script, one push — install / update / dev / repair

The owner asked for exactly two mental things: **`npm install` means both "install" and
"update"**, and **whatever lands on GitHub is live on tukuk.org within 30 minutes** — all
of it free. This file documents how that works. The scripts themselves are the contract;
this is the map.

## The one script: `scripts/tukuk.sh`

| Command             | What it does                                                                                       |
|---------------------|----------------------------------------------------------------------------------------------------|
| `npm install`       | **Install AND update.** postinstall pulls GitHub first (`scripts/pull-before-install.sh`), then installs dependencies, then reconciles the whole box (`scripts/setup-all.sh`). Refuses politely (and just installs what is here) on CI runners, bundle/USB boxes with no origin, and dirty working trees. |
| `npm start`         | Local dev server **with auto-repair**: boots `node index.js`, restarts it when it dies, and STOPS after 3 crashes inside 10s (that is a bug, not a hiccup — the error is already on your screen). |
| `npm run update`    | The deploy path on the box (`sudo`). Runs `scripts/auto-update.sh`, then **verifies `/health` answers**, and **rolls back** to the previous commit if the new code does not. A bad push becomes a 30-second incident, not a morning of 503s. |
| `npm run repair`    | One-shot self-heal: pulls if it safely can, fixes dependency drift, starts dead services (meilisearch, tukuk-os, nginx, cloudflared), restarts the app if `/health` is silent, and re-enables the update timer if it died. |
| `bash scripts/tukuk.sh` | No argument = auto: `install` when there is no `node_modules`, `update` when there is.          |

`npm run dev` stays the raw `node index.js` (no supervisor) for when you want to debug
the process itself, and production never touched any of this: the systemd unit runs
`node index.js` directly.

## GitHub → server: 30 minutes, free, pull model

There is no deploy pipeline pushing into the box — the box **pulls**:

```
git push (tukuk-os/main)
    └─▶ tukuk-update.timer on the box fires at :07 and :37 every hour
          └─▶ scripts/auto-update.sh
                ├─ git fetch (bounded 10 min) + merge --ff-only  → no new commits? exit in seconds
                ├─ npm install --omit=dev   ONLY when package.json/lock changed
                ├─ re-run setup-all.sh      ONLY when setup-all.sh itself changed
                │    (this is how unit/timer changes land without a lockfile change)
                ├─ train-brain              at most once a day, not 48 times
                └─ systemctl restart tukuk-os   → /health records the result
```

* **Quiet box cost:** one bounded `git fetch` per half hour. Nothing else runs.
* **Why pull, not GitHub-Actions-push:** the box is behind a home router at
  192.168.8.x — a runner on the internet cannot SSH to it, and exposing SSH to the
  internet to save 30 minutes would be a bad trade. The pull model also survives
  credential rotation: it uses the deploy key the box already has.
* **Watchdog safety net (every 2 min):** reads the update record from `/health`; if the
  timer goes silent for four hours (`STALE_MS` in `src/update-status.js`), the watchdog
  kicks `tukuk-update.service` itself. A wedged timer is now visible within hours, not
  one day.
* Disable the whole chain with `GIT_AUTO_UPDATE=0` in `/opt/tukuk-os/.env`.

## Cloudflare: free, and deliberately minimal

**tukuk.org / www.tukuk.org / tchat.tukuk.org are tunnel-only and workerless** (frozen
decision — an apex Worker route once doubled every zone request and caused a site-wide
429; see the root ops README §3). The edge needs NO deploy when code changes: the tunnel
points at the box, and the box updates itself within 30 minutes. That is the free answer
to "auto update ke cloudflare".

The `tukuk-os` Workers project in the dashboard is where the pain was: it tried
`npm install` on the whole server monolith (Electron, onnxruntime, even the Gemfile's
Ruby gems) and burned ~1.5 build minutes failing. Configure it like this instead:

| Setting          | Value                                                                 |
|------------------|------------------------------------------------------------------------|
| Root directory   | `worker/`                                                              |
| Build command    | `npm install` (installs ONE devDependency: wrangler)                   |
| Deploy command   | `npx wrangler deploy`                                                  |
| Exclude          | `node_modules/**, .git/, ../src`  (keep defaults; the root dir confines it) |
| Observability    | OFF except Issues — already pinned in `worker/wrangler.toml`, so a re-deploy cannot silently re-enable the metered parts |

`worker/` is now self-contained (`worker/package.json`, `worker/wrangler.toml`,
`worker/index.js`) and its `routes = []` keeps it unrouted: deployed, ready as an R2
fallback, never sitting in front of the apex. **Do not add a route for tukuk.org.**
If the project gives no value, freezing (or deleting) it is equally correct — nothing
about the site changes.

The `cf` (Cloudflare CLI beta) experiment briefly parked in `/opt/tukuk-os` (a
`cloudflare.config.ts` that ends in `throw new Error("Migration incomplete")` plus
`"cf"` in devDependencies) does more harm than it looks: while the box's tree is dirty,
`merge --ff-only` refuses and **every auto-update silently skips**. The fix is one line
on the box (as root):

```
git -C /opt/tukuk-os checkout -- package.json package-lock.json
mv /opt/tukuk-os/cloudflare.config.ts /root/   # kept, not deleted
```

## Credentials rule

Passwords and tokens go in the box's `/opt/tukuk-os/.env` (600, root) or the GitHub
secrets — **never into a file this repo ships**, and never pasted into a script. The
chat window is not a vault: a password shared in chat should be rotated once it has
done its job.

## Quick reference

```
npm run update          # sudo, on the box: deploy now (with verify + rollback)
npm run repair          # sudo, on the box: fix what is commonly broken
systemctl list-timers tukuk-update.timer     # when is the next pull
cat /opt/tukuk-os/data/update-status.json    # what the last pull did (also in /health)
journalctl -u tukuk-os -n 50                 # why is the app unhappy
```
