# Tukuk-OS v2 — Quick Reference (Cheat Sheet & README)

Our own internet portal — web search engine + AI answers + in-browser app & game store + no-code builder + T Chat 2G + radio + studio — built light and high-performance for low-RAM servers (2GB) with cloud integrations (Cloudflare, Google AdSense, Microsoft Ads). Free, no account, works even on weak networks.

> **This is the one focused project.** Do not split attention across other repos.

---

## 🔑 0. WHO OWNS WHAT — read this before touching any account

**The domain `tukuk.org` belongs to `tukuk.co@gmail.com`.** It is NOT `fevianbenjo48@gmail.com` any more — that address used to own the Cloudflare account and it no longer controls this site. Anything you read below that names the old owner is history, not the live state. (Changed / recorded 31 Oct 2026.)

| Thing | Live value (31 Oct 2026) | Where it is stored |
|---|---|---|
| **Domain owner** | `tukuk.co@gmail.com` | this file — it is the only place guaranteed to be read first |
| **Cloudflare account** | `6134c115f7311412314b35f3ccf76166` — displayed as **"Tukuk.co@gmail.com's Account"** | `deploy/env.defaults` → `CLOUDFLARE_ACCOUNT_ID` |
| **Zone** | `tukuk.org` = `4ad6f31b444b19c37d5429da4619c845`, status `active`, NS `nancy`/`wilson.ns.cloudflare.com` (= the real delegation) | read it back: `curl -s -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/zones?name=tukuk.org` |
| **API token** | name `1-dasar-kebenaran-30-10-2026` (`cfat_…`) — Zone read, tunnel read+token, Workers read, R2 read+edit. **NO** DNS edit, **NO** Workers Routes edit, **NO** cache purge → see §9 for the two clicks that need the dashboard | `deploy/env.secrets` (gitignored) → `CLOUDFLARE_API_TOKEN`, shipped to `/opt/tukuk-os/.env` |
| **Tunnel** | `tukuk-tunnel` = `c1d8ea0f-b512-487b-b7e7-ad730c24da9e`, token mode, created 31 Oct 2026 | `deploy/env.secrets` → `CF_TUNNEL_TOKEN` + `CF_TUNNEL_ID` |
| **R2 buckets** | `tukuk-fallback`, `tukuk-fallback-preview`, `tukuk-os-backups` — all in the NEW account | `scripts/r2.env` |
| **Server** | Ubuntu box, LAN **`192.168.8.104`** (user `tukuk`, ssh key `~/.ssh/tukuk_vps_ed25519`, alias `tukuk-vps`), app at `/opt/tukuk-os` | `TUKUK_HOST` env / `~/.ssh/config` |
| **GitHub** | This project's home is **`github.com/tukuk/tukuk-os`** — the `tukuk` account, same owner as the domain, and the identity `test/repo-identity.test.js` enforces (it fails the suite if the older account is named in any file). Measured 31 Oct 2026: `tukuk` exposes exactly one public repo (`email-routing-template`) and `tukuk/tukuk-os` answers **404 to the credential this laptop currently logs in with** (`gh auth status`) — i.e. that login is the *other* account, and it cannot see or push a private `tukuk` repo. Consequence: the deploy pipeline's "GitHub first" step is dead until a `tukuk` token is on the machine, and unpushed commits are only saved by bundle (`deploy/REBUILD.md` Part G) | `git remote -v` in each repo · `gh auth status` |

⚠️ **Two credentials that look alive but are dead** — do not spend time debugging them: the `cfut_…` token that is still sitting in `/opt/tukuk-os/.env` (revoked with the old account; `tokens/verify` → *Invalid API Token*), and `BACKUP_WORKER_URL=https://tukuk-backup.fevianbenjo48.workers.dev` (that worker does not exist in the new account). Backups therefore go **straight to R2** — the current token has R2 Read & Edit, which is what §9 asked for. Verified 31 Oct 2026 by running each track once: `tukuk-data` (1.1 M), `tukuk-identity` (120 K, encrypted), `tukuk-content` (1.0 M) and `tukuk-snapshot` all landed in `tukuk-fallback` via `wrangler r2 object put`.

🚨 **MISSING ASSET — the Android release signing key.** `apk/tukuk-chat-release.jks` + `apk/keystore.env` exist on **no** copy: not this laptop (`find` over the home dir returns only `~/.config/.android/debug.keystore`), not the rebuilt box, not R2 — the new `tukuk-fallback` bucket held only 3 stray HTML files before today's uploads, so the old identity archives that would have carried the key did not survive the account move. `backup-identity.sh` already lists both paths, and on the box it logs `WARN: … absent -- skipped`. **Consequence:** an installed Tukuk app can never be updated by a differently-signed APK — the store rejects the signature mismatch, so users would have to uninstall and reinstall. Until it is settled (recover the old disk, or consciously cut over to a new key), treat `tukuk-chat-release.jks` as lost and do not publish an APK update expecting existing installs to take it.

---

## ⚡ TL;DR — Quick Runbook (read this first)

**Things you RARELY touch but ALWAYS need to know:**

| Want to... | Command / fact |
|---|---|
| Run locally | `npm install` → `npm start` → `http://localhost:3000` |
| Deploy to a NEW SERVER | Bring the code (USB/push) → `sudo bash scripts/install-from-usb.sh`. All automatic (Node, Meili, systemd, tunnel, edge). **No GitHub auth / no `.json` files.** |
| Server running | `192.168.8.104` (user `tukuk`) — LAN address **drifts** (DHCP; was `.100`, then `.105`); scripts read `TUKUK_HOST`. Admin access: `ssh -L 3000:localhost:3000 tukuk@192.168.8.104` → `http://localhost:3000/admin` (email + **WebAuthn passkey**). Public: `https://tukuk.org/admin` |
| Edit static pages (`public/*.html`) | **Just reload the browser** — read on every request. |
| Edit `src/server.js` (routes/`STATIC_PAGES`) | **MUST restart** `node index.js` — routes live in memory. |
| Change config/keys | Non-secret: edit `deploy/env.defaults`. Secret: edit `deploy/env.secrets` (not in git). Then `sudo bash scripts/make-env.sh --force` → `sudo bash scripts/setup-all.sh` (idempotent). |
| Generate app+game from 1 word | `node scripts/satu-kata/generate.mjs [word]` — free CI (GitHub Actions) daily cron → hub served at **`tukuk.org/satu-kata/`** (Cloudflare Pages = optional). See **§12** |
| Check health | `https://tukuk.org/health` (200), `/brain`, `/ask?q=...` |
| Prove the site from **outside** the box | `bash scripts/public-canary.sh` — 0 healthy, 1 wrong, 2 edge down. Checks homepage, sitemaps, the crawl budget (`/sitemap-settlements.xml` must stay ≤ 20 `<loc>`), a real shard item's `noindex`, and that an unapproved account ships no ad unit. Runs every 30 min on GitHub Actions (`.github/workflows/canary.yml`) because every other monitor lives on the box that dies. |
| Public sites now | ✅ `tukuk.org` = **200**; `www.tukuk.org` = **301 → apex** (edge workerless — §9); admin panel = `tukuk.org/admin` |
| Server layout | **One folder.** `/opt/tukuk-os` holds the app *and* its payloads: `apps/builder` (the Builder), `apps/play` (published game), `models/`, `bin/godot`, `game/` (game source). `deploy/paths.sh` is the only place those paths are written; `scripts/consolidate-layout.sh` moves a box onto it (idempotent, `--dry-run`, leaves the old paths as symlinks) and `--prune-links` drops them once nothing names them |

**Key file skeleton:** `src/server.js` (all routes) · `public/index.html` (search+dashboard SPA) · `public/editor.html` & `public/editor-video.html` (Studio) · `src/brain/*` (AI + search) · `scripts/setup-all.sh` (auto-setup) · `deploy/env.defaults` (shipped keys & config) · `deploy/cloudflared/config.yml` (tunnel template).

---

## 🚀 1. How to Start Locally (Local Testing)

```bash
# Install dependencies
npm install

# Start the server
npm start
```
* **Search Engine / UI:** `http://localhost:3000`
* **Admin Dashboard:** `http://localhost:3000/admin` (email + **WebAuthn passkey** login — not the old PIN)
* **Health Endpoint:** `http://localhost:3000/test`

---

## 🛠️ 2. Admin Control Center (`/admin`)

After visiting `http://localhost:3000/admin` and logging in (email + WebAuthn passkey), you can access:
- **Server & Security Monitor:** 2GB RAM monitor, CPU usage, and indexed-document stats (30+ base documents).
- **Web Terminal:** Run server commands directly (e.g. `git status`, `uptime`, `npm test`).
- **Add Web Crawl:** Enter a URL to crawl and index new content immediately.
- **Ads (Google & MS):** Google AdSense and Microsoft Advertising Publisher ID settings.
- **UI & Custom Theme:** Change the site title, dark/light logo, background mode, and theme colors.
- **Articles & Blog:** Write and publish new articles.
- **AI Engine & Writer:** Configure the AI API (Google Gemini / Ollama).

---

## 📢 3. Ad Verification (`ads.txt`)

The [ads.txt](public/ads.txt) file in the `public/` directory contains the official authorizations for:
- **Google AdSense:** `pub-8954948214333501`
- **Microsoft Advertising:** `100001`

---

## 💿 4. Server ISO Build (Turnkey ISO for 2GB RAM)

To build a self-booting ISO image (Ubuntu 24.04 LTS Autoinstall with ZRAM & Node.js):
```bash
sudo ./deploy/build-iso.sh
```
* **Output:** `/tmp/tukuk-os-server-24.04.iso` (burn to USB with Rufus / BalenaEtcher).
* **ZRAM Swap:** Configured automatically on the server (75% ZRAM compression) so a 2GB RAM server runs very smoothly without *crashes*.
* ⚠️ **Warning:** the `late-commands` step in the autoinstall *clones* the **private** repo → it will fail without a GitHub token. For a new machine, **use the USB path in §5** (easier, no auth needed).

---

## 🌐 5. Server Deployment & Cloudflare Tunnel

0. **Install from USB (easiest for a new server — no GitHub auth needed):**
   The repo is now **private**, so `git clone` on a new machine needs an SSH key/PAT. Instead, carry the code on a USB and let the server use the internet only for `npm install`:
   ```bash
   # (i) On the dev machine — copy the repo to the USB (without node_modules):
   rsync -a --exclude node_modules --exclude meili_data --exclude .wrangler \
         ./  /media/$USER/USB/tukuk-os/

   # (ii) On the SERVER — copy from the USB & run ONE script:
   cp -r /media/$USER/USB/tukuk-os /tmp/tukuk-os
   sudo bash /tmp/tukuk-os/scripts/install-from-usb.sh   # or: npm run usb
   ```
   The script copies to `/opt/tukuk-os`, builds `.env` from the two halves (`deploy/env.defaults` + `deploy/env.secrets`), and calls `setup-all.sh` (Node→Meili→services→tunnel). **The server must have internet** for this step, and **the secrets file must be on it** — it is not in the repo.
   - **Fully offline (no internet):** `TUKUK_KEEP_NODEMODULES=1 TUKUK_OFFLINE=1 sudo bash scripts/install-from-usb.sh` — but you must also carry `node_modules` (built on an online machine of the same arch) + the `node`/`cloudflared`/`meilisearch` binaries, and enable the systemd services manually.
   - **Tunnel AUTOMATIC (given the secrets half):** `deploy/env.secrets` carries `CF_TUNNEL_TOKEN`; `deploy/env.defaults` carries `CF_TUNNEL_ID` (tunnel `tukuk-os-v2`) and the `CLOUDFLARE_API_TOKEN` lives in the secrets file too — so `setup-all.sh` brings the tunnel up straight away (TOKEN mode, no `.json` files). On a box with no `deploy/env.secrets`, `make-env.sh` exits 3 and names the missing keys: the tunnel cannot register until they arrive. ⚠️ It does **NOT** deploy a Worker on the site — the edge is workerless (§9); `worker/` is kept inert only. `CLOUDFLARE_API_TOKEN` is now used just for the optional R2 cold backup.

1. **Quick Install on an existing Ubuntu Server (LAN IP — `TUKUK_HOST`, now `192.168.8.105`):**
   ```bash
   sudo ./deploy/quick-install.sh
   ```
2. **Cloudflare Tunnel (TOKEN mode — automatic, do not create a new one):**
   The tunnel `tukuk-os-v2` (UUID `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae`) already exists; the ID is in `deploy/env.defaults`, the token in `deploy/env.secrets`. `setup-all.sh` writes `/etc/cloudflared/config.yml` (token + ingress `tukuk.org`/`www`/`tchat`/`agent`/`play`/`build`) and the systemd unit `--config ... tunnel run`. **DNS for those six hostnames is already routed** (the panel is `tukuk.org/admin` — `dashboard.tukuk.org` is retired). Just run `sudo bash scripts/setup-all.sh` — do NOT `tunnel create` a new one.

3. **Front proxy (nginx) — the HTML cache, one cut-over per server:**
   `setup-all.sh` brings up Node and the tunnel, but **not** nginx. Until the cut-over the tunnel's `http://127.0.0.1:3000` target is Node itself: the site works, it is just uncached. The cut-over moves Node to `:3001` and puts nginx on `:3000`, so the tunnel target never changes:
   ```bash
   sudo bash deploy/nginx/install-tukuk-front.sh verify        # nginx on :8080 → Node :3000, no live traffic yet
   sudo node scripts/nginx-front-check.js 8080                # the checks
   sudo bash deploy/nginx/install-tukuk-front.sh cut           # Node → :3001, nginx → :3000
   sudo bash deploy/nginx/install-tukuk-front.sh status        # who holds which port
   # undo with: sudo bash deploy/nginx/install-tukuk-front.sh rollback
   ```
   After the cut-over **every** hostname on the tunnel must point at `http://127.0.0.1:3000` — nginx answers any `Host` and the app decides what each hostname may serve. A hostname left on another port (the `:8080` verify port is the usual accident) answers `error code: 502` from cloudflared.

4. **Auto-sync — `/opt/tukuk-os` is now a REAL `git clone` (deploy = push, not rsync):**
   The script `scripts/setup-autosync.sh` turns the install directory into a git repo authenticated with a **read-only SSH deploy key** (`/root/.ssh/tukuk_deploy`, registered on the repo → can only `pull`, no token in the URL, no interactive login). After that the existing **`tukuk-update.timer` (root, ~04:30)** (enabled by `setup-all.sh` unless `GIT_AUTO_UPDATE=0`) actually works:
   ```bash
   # Automatic cycle (daily, root): fetch origin/main → merge --ff-only → npm install
   sudo bash scripts/auto-update.sh          # or: sudo systemctl start tukuk-update.service
   npm run update                            # same, but needs root
   ```
   New workflow: **commit + push from the dev machine → VPS self-pulls** (cron, or trigger it immediately as above). `data/`, `.env`, `node_modules` are NOT tracked by git (`.gitignore`) → `merge --ff-only` stays clean (working tree not polluted by runtime files). `git reset --hard origin/main` during setup keeps untracked files. ⚠️ **Do not rsync tracked files** into `/opt/tukuk-os`: tracked files there then differ from HEAD, and `merge --ff-only` refuses whenever a path it must write is modified locally (measured against git — dirt on a path the merge does not touch goes straight through). So the box carries on updating normally until the day `main` edits one of those same files, and from then the merge is skipped every night while the unit still exits 0. `deploy/remote-deploy.sh` is exactly that script; it now REFUSES to run unless `TUKUK_FORCE_RSYNC_DEPLOY=1` and is kept only for provisioning a machine that has no clone yet.
   > **`auto-update.sh` is now efficient:** no new commit → exits immediately; new commits → `npm install` **only when `package.json`/`package-lock.json` actually changed** (avoids downloading heavy native binaries like onnxruntime ~300MB that can *hang* on slow networks), then `systemctl restart tukuk-os` to load the new code. So the word cron (`generated/`) & code/README edits **never** carry a daily `npm install`.

   > ✅ **STATUS (29 Oct 2026, later): the self-pull path works again.** For a while it did not: the read-only deploy key had vanished from `/root/.ssh` along with root's `config`, so `git fetch` had no identity to offer, and `origin` inside `/opt/tukuk-os` had been repointed at the **handover bundle on the box's own disk** — which is a remote that always answers, and answers about the code it already has. The nightly timer was reporting `Already up to date` while four commits waited on GitHub. Worth naming precisely, because the diagnosis was wrong at first: the box reaches GitHub fine (`github.com:22` and `ssh.github.com:443` both connect, `api.github.com` answers 200), so this was **auth, not network** — "the VPS cannot reach GitHub" was written here on the strength of a failing `git fetch` and it was not true.
   > **What is in place now:** a fresh ed25519 keypair at `/root/.ssh/tukuk_deploy`, registered on the repo as a **read-only** deploy key, and `/root/.ssh/config` selecting it for `github.com` (`IdentitiesOnly yes`). `origin` is `git@github.com:tukuk/tukuk-os.git` again, and the bundle is kept as a second remote, `handover`, for the day GitHub is genuinely unreachable. `git push` from a box is refused **by GitHub** (`ERROR: The key you are authenticating with has been marked as read only`) — the guard is server-side, so re-enabling push means deleting the key, not editing a file nobody reads.
   > **So the dev-machine workflow is `bash scripts/ship-to-box.sh`**, which asks the box which transport it has (`remote get-url origin` + `git ls-remote origin` as root) rather than trusting this paragraph: on the GitHub path it pushes, starts `tukuk-update.service` and stops; on the degraded path it also rebuilds the full-history bundle, copies it (byte count compared at the far end, `git bundle verify` run inside `/opt/tukuk-os`, previous bundle kept as `.pre-<sha>`), points `origin` at it **for the duration only**, and puts it back on the `EXIT` trap — because a box left fetching a bundle is the failure this whole note is about. Both paths refuse to call it done until `/opt/tukuk-os` reports the shipped sha and `/health` shows the matching update record. Idempotent (already-live sha → exit 0 before any transport work), and it refuses a branch that is behind `origin/main`, because a bundle built without those commits leaves them out of production permanently. **Both transports have run for real:** `4c86a37` over GitHub, then `dcad3d6` with root's ssh config deliberately moved aside — the probe refused (`Permission denied (publickey)`), the bundle shipped end to end, and the last line of output was `origin put back at git@github.com:tukuk/tukuk-os.git`. That rehearsal is also why the fallback is the fallback: repacking a full-history bundle cost the box **495.9 MB peak RSS and 10.7 s CPU** where GitHub's incremental of the same commits cost **32.7 MB and 2.2 s** (identical 7 s wall), and that work happens on a machine that is serving traffic.

---

## 🧠 6. AI Chat (Ask) — how it works & how to configure

The **"AI Chat"** widget (💬 at the corner of `/`) calls `GET /ask?q=...`.

**Chain:** `/ask` (`src/server.js`) → `rag.ask()` (`src/brain/rag.js`) → `provider` (`src/brain/provider.js`).

`provider.activeBackend()` picks a backend automatically (no Ollama/model required — suits a **CPU-only server**):
1. **Cloud LLM** (Gemini / OpenRouter / OpenAI / xAI / Cloudflare / Hugging Face …) — when a key exists. The server makes just 1 HTTP call; processing happens in the cloud, CPU ≈ 0.
2. **Local Ollama** — when `OLLAMA_HOST` (default `127.0.0.1:11434`) is reachable.
3. **Extractive answer** — if neither exists: quotes the most relevant sentences from the search results (`extractiveAnswer` in `src/brain/quality.js`). **0 models, 0 cost, always on.** (Out-of-the-box default, which is why `No answer` no longer happens.)

**Cloud + Ollama run CONCURRENTLY** (`rag.js` hybrid race): when both tiers exist, the cloud rotation and the local model chain generate **in parallel** and the first coherent answer wins — the loser is aborted instantly (no wasted tokens/CPU). Cloud normally wins in ~1–2s; the local model still fills the gap when every cloud provider is cooling/blipped, instead of the old sequential path that burned the whole `BRAIN_BUDGET_MS` on slow local generation and then fell to extractive with zero time left for cloud. `BRAIN_LOCAL_FIRST=1` no longer delays cloud — it only removes the ~1.2s cloud head-start so the local model begins immediately.

Self-referential questions ("what is tukuk-os", "endpoints", etc.) are answered from fixed knowledge (`src/brain/knowledge.js`) without an LLM.

**How to configure the cloud (pick one, then restart `node index.js`):**
- **Admin → AI Settings:** `aiProvider=gemini`, `aiApiKey=<your key>`, `aiModel=gemini-2.5-flash`; **or**
- **env:** `GEMINI_API_KEY=...` (also `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`). They go in `deploy/env.secrets`, never in `env.defaults` — a provider key is a bill.

**⚠️ Groq is vetoed.** The owner does not want it. `src/brain/provider.js` filters it out as the **last** step of `providerOrder()` via `LLM_DISABLED_PROVIDERS` (default `groq`), so a leftover `GROQ_API_KEY`, an `LLM_CLOUD_ORDER` entry, or an admin `aiProvider` setting can never re-admit it. Three tests in `test/brain-provider.test.js` pin that. It is also absent from the Builder's `ENABLED_PROVIDERS` (`bolt.diy/app/lib/modules/llm/manager.ts`), which is what removes it from the picker.

**Check / test:** `GET /brain` → `provider` (`gemini|openrouter|openai|ollama|extractive`) & `online`; `GET /ask?q=question`.

**Flags:** `BRAIN_ENABLED=false` disables `/ask` (503). `BRAIN_FAST_MODE=true` (default) + Ollama with **no cloud key** → extractive immediately (skips the weak small model). `LLM_CHAIN` = Ollama failover list. `BRAIN_BUDGET_MS` (default 9000) = hard time budget for the whole LLM phase, after which extractive answers instantly (with a 3s floor so slow web-search retrieve can't starve the race).

**International (all languages):** `/ask` answers in the language of the question at ALL layers, not just Malay/English:
- High class (LLM): prompt instruction "SAME LANGUAGE as the QUESTION" (language-agnostic).
- Low floor (no-LLM fallback): `src/lang.js` → `detectLocale()` detects script (CJK/Japanese/Korean/Arabic/Cyrillic/Devanagari/Thai/Latin-hint) + `t()` provides refusal/web-list/source-label strings in 15 languages (en ms id ja ko zh ru ar hi bn th fr de es pt).
- Sentence cutting & Unicode-aware tokenization (`splitSentencesUnicode`, `tokenizeQuery`): `。！？`/`।॥`/`ฯ` cut correctly; space-less scripts (CJK) are tokenized character by character with separate isEcho/score thresholds.
- Web search: `looksRelevant` no longer drops non-Latin characters; Bing is NOT forced to `setmkt=en-us` for non-English queries (avoids decoys); Wikipedia is searched on the query language's domain (`ja.wikipedia.org` etc.).

---

## 🎛 7. Tukuk Studio (in-browser tool suite, no upload)

- **`/editor`** (`public/editor.html`) — full **IMAGE** editor: filters + temperature/vignette/grain; **Smart**: 🪄 auto-fix (gray-world white balance + auto levels), 🎚 curves (draggable point curves + presets), 📊 live RGB+tonal histogram; 💧 repeating text water-mark (size/opacity/angle/spacing); shape annotations (pen/line/arrow/rectangle/ellipse + fill toggle) + text outline; brush; emoji stickers; straighten, sharpen (convolution), mosaic; ratio crop; frames; resize; draggable text; rounded corners + **round/oval shape masks**; adjustable **JPG quality**; batch; save/open **.json projects (v3, + shape/outline)**; undo/redo. All client-side.
- **`/editor-video`** (`public/editor-video.html`) — **VIDEO** editor: In/Out trim, filters + vignette, rotate/flip, aspect ratios (1:1/16:9/9:16/4:5/4:3), speed, captions; **PNG snapshot** of a frame & **WebM export** (`canvas.captureStream` + `MediaRecorder`, **real-time** recording). **Local** files only (external URLs taint the canvas → export fails).
- **`/cari`** — search **RESULTS** page (the same SPA `index.html` on a separate URL). **AD-FREE** surface (AdSense policy compliant); **`/`** = the original content dashboard (ad-worthy).
- **`/cc?q=...`** — **Creative Commons** asset search API (Wikimedia Commons, no key) → `{title,thumb,full,license,author}`; shown in the **"🧩 CC Assets"** tab and can be opened directly in `/editor?img=`.
- **`/api/image?url=`** — **same-origin** image proxy so the canvas is not "tainted" (important for export/lightbox/editing external images).
- **`studio.html`** = tool hub; display tiles live on the `/` dashboard.
- **`/store`** (`public/store.html`) — **Tukuk Store**: catalog of apps & games from **4 sources** (`GET /api/store` → `storeCatalog()`): **🏠 Built-in** (mini apps `public/apps/*.html` — only ones whose files actually exist, `storeBawaan()`), **⚡ Satu Kata** (app+game pairs from `generated/manifest.json`, cached by mtime, `storeSatuKata()`), **🕹️ Arcade** (Builder game templates → `/builder?tpl=<name>` links; the Builder loads the template straight into Try mode) and **👥 Community** (`/a/<slug>` publications). Tabs **All / Apps / Games** + source filter + search + sort (newest / most viewed / A–Z), **view** counts (`publish-views.json`, 5s debounce on `/a/<slug>` hits), `Cache-Control: public, max-age=30`. The `kind` category is sent by the Builder on publish (`inferKind()`: canvas-only game → `game`; classic fallback = title regex `GAME_TITLE_RE`) and stored in `.meta.json`. Community items open in the `/a/<slug>` sandbox.

---

## 💬 7½. T Chat — multi-user messenger + cross-OS app

**T Chat** (formerly "Tukuk Chat") = a real messenger in the browser, not a local demo. Back end `src/chat.js` (`mount(app)` called from `src/server.js`); single-file client `public/apps/chat.html`; JSON storage (`generated`/`data` — `chat.json`), sessions are **Bearer tokens in localStorage** (no cookies → isolated origins). UI & logo brand **"T Chat"** / **"TukuCaller™"** — do not use third-party names.

- **Basics:** register with just name + password → permanent numeric **Tukuk ID** (`/api/whoami`); DM/groups/public rooms, text messages + images/video/files (📎, compressed client-side), voice messages (MediaRecorder), reply/forward/reaction/edit, in-message search, read receipts, typing, block/unblock, friend list (by ID), stickers, polls, wallpaper & sounds, 2G/3G data-saver mode + offline outbox.
- **WebRTC calls:** P2P video/voice in DMs with **TURN/ICE** signaling from the server; the incoming screen shows **TukuCaller**-style caller ID (name, ID, friend?) before answering; **prank mode** (`🎭`) — a full-screen fake incoming call, works even offline.
- **Social layer (`📰` Feed):** posts + comments + likes + **repost/quote (X-style ♻️)** + filterable tags; **24-hour stories** (`📕`); **status (temporary mood)** — emoji + text ≤80 chars with a **selectable TTL** (`STATUS_TTL`: 30 min…7 days/forever; `setStatus`/`effStatus` in `src/chat.js`) shown on your own profile, others' profiles, the friend list & the composer, expiring automatically (client 60s tick); SSE events `social/kind:status` to followers + self. Rate limit `lim(...)` on every write.
- **Dedicated domain `tchat.tukuk.org`** (`2e4b400`): hostname gateway in `src/server.js` (`TCHAT_HOST`/`TCHAT_ALLOWED`/`CSP_TCHAT`) — only T Chat assets are routed, strict CSP (no ads/analytics, `frame-ancestors 'none'`), `X-Robots-Tag: noindex`, its own entry page deliberately takes **no proxy cache** (a private space is not shareable content), everything else 302 → `tukuk.org`. ⚠️ **TOKEN-mode** tunnels ignore the local `ingress:` → a hostname is added in the **Zero Trust dashboard** (Networks → Routes, connector `87e7e77f`). It rides the **one tunnel** together with `build`, `play` and `agent` — the legacy `a3af5bb4` build tunnel was retired, because a second unit is a second thing to forget on a rebuild and a second way for a live hostname to 530. That is also why `deploy/builder-idle-stop.sh` stops only `tukuk-builder.service`, never the connector.
- **Cross-OS app:** native WebView APK **beta** (`public/downloads/tukuk-chat.apk`, ±65 KB, gains new features automatically without a rebuild — built by `scripts/build-apk.sh` without Gradle); PWA (`manifest.json`/`manifest-chat.json` + `sw.js`). **The `/download` page** (`public/download.html`, clean URLs §8) = one button **auto-picked by the visitor's OS**: direct APK (Android/Huawei/ChromeOS), PWA `beforeinstallprompt` (Windows/Linux/macOS), or *Add to Home Screen* instructions (iOS) + QR/share link. Links are on `/apps`, the `/` tile, and ⚙️ → Apps. A **stable** version has not been released yet (per user instruction: beta first).
- **Backups:** `deploy/chat-backup.service` + timer (R2 snapshot `scripts/backup-chat.sh`; `User=tukuk` so `$HOME` is not unbound).
- **Google Play:** new apps require an **AAB** + **target SDK 36** (from Aug 31, 2026). The manifest `apk/app/AndroidManifest.xml` is already set (code 2, target 36); `scripts/build-apk.sh` also produces a `.aab` when `bundletool` exists; store copy EN in `fastlane/metadata/android/`. Full runbook + account gates (USD 25 fee, Play App Signing, Console forms): **`PLAYSTORE.md`**. Recommended release starts with **Internal testing** (consistent with the beta-first policy).

---

## 🧩 8. Maintenance Notes (for you & any AI editing this code later) — IMPORTANT

- **Express routes = in memory.** After editing `src/server.js` (adding a path/`STATIC_PAGES`) → **MUST restart** `node index.js`. Otherwise: `public/*.html` looks changed already (read on every request), but the new route gives **404**.
- **Clean URLs for static pages** are registered through `STATIC_PAGES` (`src/server.js` ~L114): add a name (without `.html`) → `/name` serves `public/name.html`.
- **One-command setup:** `npm install` → `scripts/setup-all.sh` (postinstall) builds `.env` by merging `deploy/env.defaults` (publishable) with `deploy/env.secrets` (never in git), then installs services & the tunnel. Keys do not live in the repo, private or otherwise.
- **Admin** = email + **WebAuthn passkey** (not a PIN). The address is in `deploy/env.secrets` as `ADMIN_EMAIL`. WebAuthn only works over **HTTPS** or `localhost`.
- **Language:** UI is **English** (the site is English-only by owner decision); code comments and docs follow the harness (English). Stay consistent.
- **Assets & ads:** prefer **CC**-licensed assets; do **not** place ads on third-party search result pages (`/cari`).
- **Check JS syntax inside HTML:** `awk '/<script>/{f=1;next}/</script>/{f=0} f' public/FILE.html > /tmp/x.js && node --check /tmp/x.js`.
- **Git:** never commit/push without user instruction. (So far all Studio/AI/video-fix work **has been committed & pushed** to `origin/main`.)
- **Two-layer CSP: ENFORCED (structure only) + REPORT-ONLY (fully strict)** (`src/server.js`: `Content-Security-Policy-Report-Only` + endpoint `POST /csp-report`). What is ENFORCED today = structural directives ONLY (`frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self';`) — deliberately WITHOUT `default-src`/`script-src`/`style-src` so AdSense + inline `<script>` + `style=` do NOT break, while still blocking clickjacking & external `<base>`/`<object>`/form injection. The fully strict policy stays REPORT-ONLY (`POST /csp-report`) because `index.html` has one big inline `<script>` + 62 `style="…"` — `unsafe-inline` must remain. **To enforce later:** extract inline scripts → external files (`/app.js`) + nonce/hash, then switch the `...-Report-Only` header → `Content-Security-Policy` and drop `unsafe-inline`. Violation reports accumulate in logs (`CSP_REPORTS=0` to disable). The original headers (`X-Frame-Options`, `nosniff`, HSTS, COOP, Referrer-Policy) are still ENFORCED. **FULL ENFORCEMENT (script-src 'self' without unsafe-inline/unsafe-eval) is now active** for proven-clean static pages: `/about`, `/privacy`, `/terms`, `/docs`, `/access` (+ legacy aliases `tentang`/`terma`/`privasi`/`dokumen`) — see `CSP_STRICT_PAGES`/`CSP_STRICT` in `src/server.js`. Interactive pages (`/`, `/apps`, `/nasa`, `/editor`, `/studio`) deliberately stay structure+report-only because they have big inline `<script>`s, inline handlers, and `new Function` (could silently break without browser QA).
- **Dependabot:** `.github/dependabot.yml` — npm (root + `cloudflare-worker/tukuk-fallback`) + github-actions, weekly (Tue 03:45 MYT), minor/patch grouped, major manual, limited PRs.
- **`public/llms.txt`:** agent-friendly summary (served statically at `/llms.txt`) — update when adding/removing big APIs/pages.

---

## ☁️ 9. Cloudflare — Facts, Audit & Rules (DO NOT blindly revamp)

**Zone:** `tukuk.org` · **Plan:** *Free Website* (Cloudflare Free) · **Origin bind:** `127.0.0.1:3000` = nginx front (Node itself on a box that has not run the cut-over; Node sits on `127.0.0.1:3001` after it — §5#3). Loopback-only → public access ONLY through the tunnel.

### 🚨 STATUS 31 OCT 2026 — the apex is NOT workerless right now, and that is a bug
The zone now lives in **`Tukuk.co@gmail.com's Account`** (`6134c115f7311412314b35f3ccf76166`, zone `4ad6f31b444b19c37d5429da4619c845`, NS `nancy`/`wilson` — confirmed live delegation). Measured through that zone:
- `GET /zones/{Z}/workers/routes` returns **`tukuk.org/* → tukuk-fallback`** (id `1a47c440dbd64c478032a99abccdee3f`) — a Worker on the apex again, the exact thing the section below forbids.
- Proof from the request path: `www.tukuk.org/<anything>` **is** logged by nginx on the box (it reaches Node and 301s to the apex), while `tukuk.org/<anything>` never appears in `/var/log/nginx/tukuk-front.log`, answers `HTTP 503 "API unavailable — server offline"` on `/health` (that string exists only in `cloudflare-worker/tukuk-fallback/src/index.ts`) and serves a 29 Oct copy of `/theme.js` (9 282 B, `etag: 6ae30028-2442`) instead of the live 11 795 B file.
- **Fix = one click, and no API token here can do it** (the `cfat_…` token gets `403 No access to the specified resource` on `DELETE /zones/{Z}/workers/routes/{id}`): dashboard → zone `tukuk.org` → **Workers & Pages → Routes** → delete `tukuk.org/*`. Or grant that token **Zone · Workers Routes · Edit** and the delete is one command. Do **not** point the Worker at the box instead: `ORIGIN` cannot reach it (there is no `origin.tukuk.org` record, and a loop back into the same zone is what caused the 1027s below).
- Missing pieces inherited from the account move: `tchat`, `agent`, `play`, `build` have **neither a DNS record nor a tunnel route** (only `@` and `www` do), and the old `tukuk-backup` upload worker does not exist in the new account (`BACKUP_WORKER_URL` is dead → send backups straight to R2, which this token *can* write).

### 🚫 EDGE IS WORKERLESS — do NOT route a Worker on `tukuk.org` again
Both `tukuk.org` and `www.tukuk.org` are **plain CNAMEs to the tunnel** (`87e7e77f…cfargotunnel.com`, proxied) → nginx → Node. **No Cloudflare Worker sits on the request path.** `worker/wrangler.toml` has `routes = []` for exactly this reason — leave it empty.
- **Why:** the old `tukuk-www-worker` route proxied by `fetch()`ing `url.hostname = "tukuk.org"` — the SAME zone it was routed on. Every page therefore hit the zone **twice** (client request + Worker subrequest), which spent the account's **daily free Worker request cap** (Workers Free = 100,000 requests/day, reset 00:00 UTC) and returned **`HTTP 429 · error code: 1027` for every visitor**, while Node/nginx stayed perfectly healthy. 1027 is the *plan-limit* page, not a WAF/rate-rule verdict — the tell is that it clears by itself at midnight UTC. `www` was a Worker *Custom Domain* (which auto-creates a read-only `AAAA 100::` DNS record the Zones API can't edit until the Custom Domain is deleted) and blocked the same way.
- **Recovery that worked:** delete the routes via `DELETE /zones/{Z}/workers/routes/{id}`, delete the Custom Domain via `DELETE /accounts/{ACC}/workers/domains/{id}` (both with a *Workers Scripts: Edit* token — WAF scope is **not** needed for these), then repoint `www` to the tunnel CNAME. The deployed `tukuk-www-worker` script has since been deleted; its source stays in `worker/` (inert) so it can be revived **without an apex route** if ever needed.
- **Failover replacement (no Worker):** nginx serves a branded `503 Under maintenance` (`@down`) / JSON (`@down_json` on `/api` + `/health`) when the origin is unreachable and there is no stale cache — `deploy/nginx/tukuk-front.conf`. This lives one hop **before** the tunnel, so it is invisible to zone security rules and adds zero requests (it can never cause a 429). The `scripts/watchdog.sh` public-edge check classifies `429/1027` vs tunnel-down vs non-2xx and logs the edge-refusal case loudly.

### 🧊 R2 DISASTER-RESTORE RUNBOOK (workerless — nothing auto-serves a fallback now)
Because there is no fallback Worker on the request path, R2 is now purely a **cold copy**: it recovers data/box loss, it does NOT keep visitors served during an outage (that is nginx `@down`'s job above). Two independent tracks, both into bucket `tukuk-fallback`:
- **Dynamic data — `data/`** (chat, plays, comments, publishes, stats): written **hourly** by `tukuk-data-backup.timer` → `scripts/backup-data.sh` to rotating keys `backups/tukuk-data-<day><hour>.tar.gz` (168 slots = 7 days, self-overwriting, no delete API). **Restore:** `bash scripts/restore-data.sh [slot]` (empty slot → current-hour copy). It is safe — the existing `data/` is moved to `data.broken-<ts>/` before extracting — then `sudo systemctl restart tukuk-os`.
- **Static site snapshot:** written **every 6 hours** by `tukuk-snapshot.timer` → `scripts/snapshot-r2.sh` (rendered HTML/assets mirror). This is a **last-resort static mirror** only if the origin box is gone entirely — nothing serves it live any more.
- **If the whole box dies:** re-provision a fresh Ubuntu host → `git clone` → `sudo bash scripts/install-from-usb.sh`/`setup-all.sh` (brings tunnel + nginx + Node up) → then `scripts/restore-data.sh` to pull the freshest `data/` from R2. The workerless edge needs **no Worker re-deploy** — DNS is the tunnel CNAMEs on the one tunnel (`@`, `www`, `tchat`, `agent`, `play`, `build`).
- **Both tracks default to the backup-Worker upload path** (`BACKUP_WORKER_URL` + `BACKUP_UPLOAD_SECRET`) because the VPS token has **no R2 scope**; the `wrangler r2 object` branch only works with an R2:Edit token. `GET`/`PUT` on `tukuk-fallback` therefore go through that upload worker, not `wrangler`.
- **⚠ STATUS (was "BLOCKED", corrected 30 Oct 2026 — the track works; the reading did not).** For a week the hourly timers failed while `*.workers.dev` answered 429, and the conclusion written down was that a Worker zone-route on `tukuk.org/_path*` and custom domains on new subdomains (`tukuk-sync`, `ping`) each answered **429 · error 1027 from the first request**, so "the zone has a security/rate rule that no machine credential can read or edit" and **the edge must stay workerless**. That misread cost a week of off-site copies. `429 · error code: 1027` is Cloudflare's **plan-limit page** — Workers Free gets **100,000 requests/day for the whole account**, resetting at **00:00 UTC**. Proof, by crossing the reset: at 23:59 UTC four of the account's five workers returned 429/1027 (including `ping.tukuk.org`, whose `workers/domains` binding had been `enabled: true` all along — so there was never a route to bind), and at 00:02 UTC the same URLs answered the worker's own `403 forbidden`, after which all four box tracks (`data`, `identity`, `content`, `meili`) landed their slots in R2 inside one minute. The cap is spent by *something* on this account and the source is still unidentified — Workers analytics left the GraphQL API, so read dashboard → Workers & Pages → Analytics for that day (or enable Logpush). Keeping `tukuk.org` workerless matters precisely because a visitor would otherwise *be* a billable Worker request. `scripts/backup-laptop.sh` remains the Workers-independent copy (wrangler OAuth writes straight to R2, zero Worker requests) — keep it running, because on a cap day all four box tracks fail together. It runs nightly at 03:45 via systemd-user timer `tukuk-laptop-backup.timer`, `Persistent=true`, 14 dailies in `~/tukuk-backups/`. **REVIVED (Oct 27): the laptop now also pushes each nightly archive straight into R2** — its `wrangler` OAuth token has full R2 put/get/delete on `tukuk-fallback` (unlike every API token), keys under `laptop-backup/data-YYYYMMDD.tar.gz`, verified by an md5 round-trip. So offsite R2 copies exist again with ZERO dashboard changes. The VPS timers' own track still needs ONE optional dashboard action: grant the VPS `CLOUDFLARE_API_TOKEN` an **Account · R2 Storage · Read & Edit** scope — the five upload scripts self-heal (after the throttled workers.dev POST exhausts retries they fall through to the direct `wrangler r2 object put` path, verified live), giving hourly offsite without anyone editing `/opt/tukuk-os/.env`. (There is no "zone rule that 1027s new hostnames" to go finding — that was the misread.)

**Tunnel (ONE only now):** `tukuk-tunnel` · UUID `c1d8ea0f-b512-487b-b7e7-ad730c24da9e` · **TOKEN mode** (no `.json` files) · created 31 Oct 2026 in the new account. *(The previous tunnel was `tukuk-os-v2` · `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae`, in the old `fevianbenjo48@gmail.com` account — every `87e7e77f…` reference below and in the DNS table is that dead tunnel; read it as `c1d8ea0f…`.)*
- Token = `cloudflared tunnel token 87e7e77f…` (uses `~/.cloudflared/cert.pem`). Stored in `deploy/env.secrets` as `CF_TUNNEL_TOKEN`; the ID sits in `deploy/env.defaults`.
- `/etc/cloudflared/config.yml` is written by `setup-all.sh` (token + ingress) + the systemd unit `--config … tunnel run`. **`cloudflared service install` REJECTS `token:` configs** — that is why the unit is written directly.
- **The VPS has no `cert.pem`**, so every cert-authenticated `cloudflared` subcommand (`tunnel list`, `tunnel status`, `tunnel route dns`) dies with *"Cannot determine default origin certificate path"*. Do not read that as an outage — it is the missing laptop credential, not the tunnel. What actually means something: `systemctl is-active cloudflared` and a request that goes through the edge (`curl -sI https://tukuk.org/health` → 200 + `server: cloudflare`). Both measured 29 Oct 2026; `scripts/ship-to-box.sh` checks the second one after every deploy because a healthy restart and a dead connector are indistinguishable from loopback.
- **Do NOT `tunnel create` a new one** — that is how `a3af5bb4` happened, and it cost a second credential plus a second unit. To serve a new hostname = one dashboard route on `87e7e77f` (Zero Trust → Networks → Routes, service = HTTP `localhost:3000`) **and** the matching `ingress` line in `deploy/cloudflared/config.yml`, which stays the canonical list. `npm test` fails if a second connector file reappears (`test/one-tunnel.test.js`), and `node scripts/cloudflared-audit.js` compares the file against the live edge when a token is present.

**DNS inventory & meaning (13 records):**
| Record | For | Delete? |
|---|---|---|
| `CNAME @ (tukuk.org) → 87e7e77f…cfargotunnel` (proxy) | Main site | ❌ NEVER |
| ~~`CNAME dashboard → 87e7e77f…`~~ **deleted** | Panel was `/admin` on the apex anyway — one hostname bought nothing and could 502 on its own | ✅ gone (delete the record if it is still there) |
| `CNAME www → 87e7e77f…cfargotunnel` (proxy) | www mirror → Node 301 to apex (workerless) | ❌ NEVER |
| `MX ×3 → route1/2/3.mx.cloudflare.net` | Cloudflare Email Routing | ❌ NEVER |
| `TXT @ → v=spf1 include:_spf.mx.cloudflare.net` | Email SPF | ❌ NEVER |
| `TXT cf2024-1._domainkey` (DKIM) · `TXT _dmarc` | Email DKIM/DMARC | ❌ NEVER |
| `CAA @ → 0 issue "digicert.com"` | Allow Cloudflare certs | ❌ NEVER |
| `CNAME github/gitlab/bitbucket → *.com` (proxy) | Convenience aliases (not needed by Tukuk-OS) | ⚠️ can delete if unused |

**Already cleaned (this session) — do not try to re-enable:** DNS `api.tukuk.org` & `mqtt.tukuk.org` (pointing at a dead tunnel → 530) **deleted**; dead tunnels `5ee04cc8` (cloudflare-os), `b400ad84` (iot-audit), `168a53af` (tukuk-os) **deleted**. Only 1 active tunnel remains.

**Security:** `cert.pem` (`~/.cloudflared`) contains an `apiToken` `cfut_…` — **never commit**; permissions 600 only. The same token is kept in `deploy/env.secrets`, which is gitignored, for auto-DNS/edge.

---

## 🆓 10. Free Stack (Free Tier) — all already connected

None of it needs payment at small scale. Here is the list + where each is set:
| Service | Free plan | Where / how |
|---|---|---|
| **Cloudflare DNS + Tunnel** | Free | Zone `tukuk.org` (account `6134c115…` = `tukuk.co@gmail.com`); tunnel `tukuk-tunnel` `c1d8ea0f…` (token mode) |
| **Cloudflare Workers** | 100k req/day | ⚠️ **NOT on `tukuk.org`** — edge is workerless (§9). `cloudflare-worker/tukuk-backup` writes R2 snapshots; `worker/` source is kept inert (`routes=[]`, undeployed) |
| **Cloudflare R2** | 10 GB storage | Snapshots `scripts/snapshot-r2.sh` (6-hour timer) — file `scripts/r2.env` |
| **Cloudflare Email Routing** | Free | MX/SPF/DKIM/DMARC active (hello@tukuk.org) |
| **Cloudflare Zero Trust** | 50 users free | Tunnel + access; admin passkeys |
| **Meilisearch** | Open-source | Index search (self-host, low RAM + ZRAM) |
| **IndexNow** | Free (Bing/Yandex/DuckDuckGo) | `scripts/indexnow.sh` + key `public/bd8f0317….txt` |
| **Google Search Console** | Free | Verification files `public/*.html` (bingbot etc.) — register & submit `sitemap.xml` |
| **Microsoft Clarity** | Free (cookieless analytics) | Token once shared — put the ID in Admin if you want session recording |
| **NASA APOD API** | Free (DEMO_KEY) | `src/nasa.js` / `public/nasa.html` |
| **GitHub Actions** | 2,000 min/mo (private) · unlimited (public) | Cron brain + `satu-kata` deploy → `.github/workflows/satu-kata.yml` |
| **GitLab CI** | ~400 min/mo | Weekly `satu-kata` mirror → `.gitlab-ci.yml` |
| **Cloudflare Pages** | Free (static) | App+game hub `tukuk-satu-kata` (`generated/public/`) — §12 |
| **Google AdSense / Microsoft Ads** | Free (revenue) | `public/ads.txt` + `src/config.js:adsense` |

**All of these come up automatically after `npm install`** on a box that has `deploy/env.secrets` (the USB install does; a fresh clone does not — copy it in or set `TUKUK_SECRETS`). What NEEDS manual dashboard action (cannot be automated): register Search Console, submit to AdSense, enable the Clarity tag.

---

## 💰 11. Google AdSense — Status & Honest Answer: "will it pass?"

**Infrastructure ALREADY ready (✓):**
- Real `ads.txt`: `ca-pub-8954948214333501` (Google, verified). Microsoft line removed until a real Monetize/Xandr (`appnexus.com, <memberId>, DIRECT, f5ab79cb980f11d1`) account ID is available.
- **Ads are OFF site-wide until the account is approved** — `adsenseOn()` returns nothing unless `config.adsense.approved` is true (`ADSENSE_APPROVED=1`). The loader, the three in-page units, the Funding Choices tag and the client `/api/public/settings` feed all read that one function, and the five static pages that used to hardcode the library tag now carry a comment instead. Serving units on pages that hold one sentence is the "ads on screens without publisher content" violation, and the review reads the LIVE markup.
- **Crawl budget** — a cluster item page is one encyclopaedia extract plus a fact table. Item pages of any cluster larger than `CRAWL_INDEX_MAX_ITEMS` (default **1500**) are served `noindex,follow` and dropped from that cluster's sitemap; hubs and continent pages stay indexable. That takes 684,567 of the 816,527 item URLs out of the index in one rule. Lower the env var to tighten further (250 → ~28k indexable item pages, 0 → hubs only).
- `sitemap.xml` lists hubs + posts only; `robots.txt` allows Googlebot/AdsBot; Privacy/About/Contact/Terms present; HTTPS; mobile-friendly.
- Content worth reviewing: `/blog` has **100 original articles**, plus the `/academy`, `/learn`, `/docs`, `/alat`, `/elements` and `/countries` surfaces.

**What Google still evaluates on its own (✗ code cannot guarantee):**
1. **Real organic traffic** — needs actual visitors for a few weeks. New sites without traffic often land in "Pending/Not ready".
2. **Enough content & not copied** — 48 articles is good, but avoid duplicate/low-value content; steer clear of thin auto-generated pages.
3. **Clear navigation** — menus/links between pages (Studio/blog/about) must exist.
4. **Domain & history** — a mature `tukuk.org` with no prior rejections helps.
5. **Real ad slots** — currently `slotTop/InArticle/Bottom` are the same (`2206273113` = placeholder). After approval, create **3 distinct ad units** in AdSense & set their IDs (or leave them auto).

**Straight answer:** the technical policy conditions are now met, but approval is still not guaranteed — and the single biggest risk is not code: **the site must be up**. A Cloudflare 530/1033 (tunnel down) on `/`, `/apps` or `/sitemap.xml` fails the review before anyone reads a word. **Before applying:** (a) confirm `curl -o /dev/null -w '%{http_code}' https://tukuk.org/` returns 200 for a few days straight, (b) register Search Console and submit the sitemap, (c) decide whether `CRAWL_INDEX_MAX_ITEMS=1500` is tight enough — at 1500 roughly 132k thin item pages remain indexable and a reviewer sampling the sitemap can still land on one, so **250 is the safer line before a re-application**. Set `ADSENSE_APPROVED=1` only AFTER the approval email arrives.

---

## 🧩 12. Satu Kata — agent skills + free CI/CD (1 word → app + game)

Turn **one word** into **one web-app + one web-game** ready live — **with no build step**. Generation runs on a free runner (GitHub Actions), so the VPS is not burdened by *builds*. **Primary hosting = straight from the site:** the hub is served at **`https://tukuk.org/satu-kata/`** (static mount of `generated/public` in `src/server.js`) — **no Cloudflare Pages or API token needed**. Cloudflare Pages (`tukuk-satu-kata`) is only **optional/decorative**.

**How to use:**
- `node scripts/satu-kata/generate.mjs [word] [--unity] [--dry]` — writes `generated/public/<slug>/{app,game}/index.html`, updates the **hub** `generated/public/index.html` + `generated/manifest.json`.
- **Agent skills:** `kilo satu-kata [word]` — see `.kilo/command/satu-kata.md` (same format as other Kilo commands).
- No word given → auto-picks the **next** word in `scripts/satu-kata/words.txt` not yet in the manifest (this is what the cron runs daily). Output is **idempotent** (slug → same, updates rather than duplicates).
- App = **Preact+htm** (React style, single HTML). Game = **Phaser** (canvas). Theme (palette + genre) is **deterministic** from a hash of the slug.

**CI/CD — who does what:**
| Role | Source (free) | File |
|---|---|---|
| Daily cron `03:15 MYT` + manual trigger | **GitHub Actions** | `.github/workflows/satu-kata.yml` |
| Hosting + deploy | **primary: `tukuk.org/satu-kata`** (static mount, no token) · optional: Cloudflare Pages `tukuk-satu-kata` | `src/server.js` (`GENERATED_DIR`) |
| Weekly mirror (limited) | **GitLab CI** (~400 min/mo → schedule-only, does not change GitHub state) | `.gitlab-ci.yml` |
| "Serious" games (manual opt-in) | **Unity Cloud** | `scripts/satu-kata/templates/unity-GameMain.cs.tpl` |

**Setup (done & verified green):** Secrets `CLOUDFLARE_API_TOKEN` (a token scoped to **`Cloudflare Pages: Edit`**) + `CLOUDFLARE_ACCOUNT_ID` were set against the **old** account `391d9aa59cfcc5ec44c3d25c855c45cb`; since the 31 Oct move the live account is `6134c115f7311412314b35f3ccf76166`, so the Actions secret has to be re-saved with the new account id + a token from that account before the Pages step can work again (the primary hosting path `tukuk.org/satu-kata` is token-free and unaffected). One full run (`workflow_dispatch`) succeeded: generate word → **Pages deploy OK** → bot `git push`es the manifest back to `main`. The daily cron `03:15 MYT` now updates **Cloudflare Pages (`tukuk-satu-kata.pages.dev`)** AND commits the next word automatically. The Pages step is `continue-on-error: true` so the cron still commits even if the Pages deploy has trouble. **Primary hosting `tukuk.org/satu-kata` stays token-free** (second path / redundancy). The workflow has no `push` trigger → no CI loops. ⚠️ `generated/` (a new word each cron) reaches the VPS via **auto-git-pull** (`/opt/tukuk-os` is already a `git clone` — see §5#4): bot commits the manifest → `tukuk-update.timer` pulls → the `tukuk.org/satu-kata` hub updates itself.

**Why the default is not Unity:** Unity needs a licensed editor + heavy builds → unsuitable for "1 day 1 game" automation on free CI without burdening the server. Web (Phaser) = the automatic default; Unity stays a manual opt-in scaffold.

**⚠️ Git gotcha:** pushing `.github/workflows/*` files **requires** the `workflow` scope — `gh auth refresh -h github.com -s workflow`; otherwise GitHub will **reject** the push (`refusing to allow an OAuth App to create or update workflow ... without workflow scope`).

**Word ordering:** edit `scripts/satu-kata/words.txt` (`word | emoji | tagline`). `generated/` is committed (small; HTML only) so CI knows which words are already used.

---

## 🧪 12½. Own AI models (Kaggle → Hugging Face) + ARC Prize 2026

Two things live here that are **not** the cloud rotation: our **own** weights, and a
research project. Both run on Kaggle's free tier and cost nothing.

### A. Train our own model, store it on Hugging Face

```bash
KAGGLE_ID=<username> bash scripts/kaggle-train-model.sh          # train on a free T4
KAGGLE_ID=<username> bash scripts/kaggle-train-model.sh --pull   # …and install it here
```

| Step | What happens | Where |
|---|---|---|
| 1 | LoRA fine-tune of `Qwen2.5-Coder-1.5B-Instruct` on a **public** dataset (no private text leaves the server) | `kaggle-jobs/tukuk-builder-mini.py` |
| 2 | merge → GGUF f16 → `llama-quantize` Q4_K_M, `metrics.json` with **measured** loss / wall-clock / sha256 / GPU | same kernel |
| 3 | push GGUF + model card + `metrics.json` to the hub | needs `HF_TOKEN` as a **Kaggle secret** |
| 4 | pull, verify sha256 against the published `metrics.json`, install to `models/` inside the app folder, `ollama create` | `sudo bash scripts/hf-model-pull.sh tukuk-builder-mini` |

One-time prerequisites (browser, cannot be automated): open a Kaggle GPU session once
(the API silently runs CPU-only until you do), and add `HF_TOKEN` under
**Kaggle → Add-ons → Secrets**. Without the token the kernel still trains and stops with
a **HOLD** message, and `scripts/publish-model-hf.sh` uploads the artefacts later.

`ai-models/registry.json` is the single source of truth for what we publish.
`src/brain/modelhub.js` reads it (no network at request time) and the result is visible
as `publishedModels` in `GET /api/models` and as the **“Published models (Kaggle →
Hugging Face)”** card on `/models`.

**These weights are not part of the `/ask` rotation** — they are served by Ollama and
picked up locally. A model that is on the hub but not installed reports
`installed: false`, which is the point (no invented state).

### B. ARC Prize 2026 — Paper Track

`arc-2026/` is a complete entry: solver, 19 unit tests, a holdout evaluator, measured
results and the write-up. Deadline **2026-11-09**. See `arc-2026/README.md`.

```bash
bash arc-2026/fetch-data.sh                                   # public ARC data
cd arc-2026 && python3 -m unittest discover -s tests -v
python3 -m arc.evaluate --dir data/ARC-AGI-2/data/evaluation --holdout --out results/x.json

cd ..
bash scripts/arc-2026-push.sh --dry-run                       # build + verify, submit nothing
KAGGLE_ID=<username> bash scripts/arc-2026-push.sh --public   # the linked code submission
```

Measured, not claimed (`arc-2026/results/*.json`): pass@2 **7.27%** on ARC-AGI-1
training holdout, **0.56%** on ARC-AGI-1 evaluation holdout, **0.00%** on ARC-AGI-2
evaluation holdout. The paper is about why consistency and accuracy decouple — the
ARC-AGI-2 number stays 0% in the write-up. The Kaggle notebook is **generated** from
`arc-2026/arc/*.py` and byte-compiled before every push, so the submission cannot drift
from the code that produced those numbers.

---

## 🔮 13. Future Roadmap
- ✅ **1 Day 1 App + Game:** **DONE** — see **§12** (GitHub Actions cron generates an app+game for every word, every day, automatically).
- **Unity Cloud Games:** Opt-in scaffold exists (**§12**); next = connecting a Unity WebGL *build* (needs a license + paid/manual CI minutes) into the Tukuk-OS games tab.
- ✅ **Kaggle CLI:** **DONE** — free GPU training → Hugging Face hub → install on the server, see **§12½-A** (`scripts/kaggle-train-model.sh`).
- ✅ **ARC Prize 2026 Paper Track:** **DONE (code + measured results)** — see **§12½-B**; what remains is the Kaggle submission fields in `arc-2026/paper/writeup.md`.
