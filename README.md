# Tukuk-OS v2 — Quick Reference (Cheat Sheet & README)

Our own internet portal — web search engine + AI answers + in-browser app & game store + no-code builder + T Chat 2G + radio + studio — built light and high-performance for low-RAM servers (2GB) with cloud integrations (Cloudflare, Google AdSense, Microsoft Ads). Free, no account, works even on weak networks.

> **This is the one focused project.** Do not split attention across other repos.

---

## ⚡ TL;DR — Quick Runbook (read this first)

**Things you RARELY touch but ALWAYS need to know:**

| Want to... | Command / fact |
|---|---|
| Run locally | `npm install` → `npm start` → `http://localhost:3000` |
| Deploy to a NEW SERVER | Bring the code (USB/push) → `sudo bash scripts/install-from-usb.sh`. All automatic (Node, Meili, systemd, tunnel, edge). **No GitHub auth / no `.json` files.** |
| Server running | `192.168.8.105` (user `tukuk`) — LAN address **drifts** (DHCP; was `.100`); scripts read `TUKUK_HOST`. Admin access: `ssh -L 3000:localhost:3000 tukuk@192.168.8.105` → `http://localhost:3000/admin` (email + **WebAuthn passkey**). Public: `https://dashboard.tukuk.org/admin` |
| Edit static pages (`public/*.html`) | **Just reload the browser** — read on every request. |
| Edit `src/server.js` (routes/`STATIC_PAGES`) | **MUST restart** `node index.js` — routes live in memory. |
| Change config/keys | Edit `deploy/env.defaults` (private repo) → `sudo bash scripts/setup-all.sh` (idempotent). |
| Generate app+game from 1 word | `node scripts/satu-kata/generate.mjs [word]` — free CI (GitHub Actions) daily cron → hub served at **`tukuk.org/satu-kata/`** (Cloudflare Pages = optional). See **§12** |
| Check health | `https://tukuk.org/health` (200), `/brain`, `/ask?q=...` |
| Public sites now | ✅ `tukuk.org`, `dashboard.tukuk.org` = **200**; `www.tukuk.org` = **301 → apex** (edge workerless — §9) |

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

The [ads.txt](file:///home/fevian/AndroidStudioProjects/tukuk-os-v2/public/ads.txt) file in the `public/` directory contains the official authorizations for:
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
   The script copies to `/opt/tukuk-os`, generates `.env` from `deploy/env.defaults`, and calls `setup-all.sh` (Node→Meili→services→tunnel). **The server must have internet** for this step.
   - **Fully offline (no internet):** `TUKUK_KEEP_NODEMODULES=1 TUKUK_OFFLINE=1 sudo bash scripts/install-from-usb.sh` — but you must also carry `node_modules` (built on an online machine of the same arch) + the `node`/`cloudflared`/`meilisearch` binaries, and enable the systemd services manually.
   - **Tunnel AUTOMATIC:** `deploy/env.defaults` already contains `CF_TUNNEL_TOKEN` + `CF_TUNNEL_ID` (tunnel `tukuk-os-v2`) and `CLOUDFLARE_API_TOKEN` — so `setup-all.sh` brings the tunnel up straight away (TOKEN mode, no `.json` files). **No manual steps needed** on a new server. ⚠️ It does **NOT** deploy a Worker on the site — the edge is workerless (§9); `worker/` is kept inert only. `CLOUDFLARE_API_TOKEN` is now used just for the optional R2 cold backup.

1. **Quick Install on an existing Ubuntu Server (LAN IP — `TUKUK_HOST`, now `192.168.8.105`):**
   ```bash
   sudo ./deploy/quick-install.sh
   ```
2. **Cloudflare Tunnel (TOKEN mode — automatic, do not create a new one):**
   The tunnel `tukuk-os-v2` (UUID `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae`) already exists & its token is stored in `deploy/env.defaults`. `setup-all.sh` writes `/etc/cloudflared/config.yml` (token + ingress `tukuk.org`/`www`/`dashboard`) and the systemd unit `--config ... tunnel run`. **DNS for `tukuk.org`/`dashboard`/`www` is already routed.** Just run `sudo bash scripts/setup-all.sh` — do NOT `tunnel create` a new one.

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
   New workflow: **commit + push from the dev machine → VPS self-pulls** (cron, or trigger it immediately as above). `data/`, `.env`, `node_modules` are NOT tracked by git (`.gitignore`) → `merge --ff-only` stays clean (working tree not polluted by runtime files). `git reset --hard origin/main` during setup keeps untracked files. ⚠️ **Do not rsync tracked files** into `/opt/tukuk-os` anymore — that dirties the tree and `auto-update` will `skip` (for safety).
   > **`auto-update.sh` is now efficient:** no new commit → exits immediately; new commits → `npm install` **only when `package.json`/`package-lock.json` actually changed** (avoids downloading heavy native binaries like onnxruntime ~300MB that can *hang* on slow networks), then `systemctl restart tukuk-os` to load the new code. So the word cron (`generated/`) & code/README edits **never** carry a daily `npm install`.

   > ✅ **STATUS (29 Oct 2026, later): the self-pull path works again.** For a while it did not: the read-only deploy key had vanished from `/root/.ssh` along with root's `config`, so `git fetch` had no identity to offer, and `origin` inside `/opt/tukuk-os` had been repointed at the **handover bundle on the box's own disk** — which is a remote that always answers, and answers about the code it already has. The nightly timer was reporting `Already up to date` while four commits waited on GitHub. Worth naming precisely, because the diagnosis was wrong at first: the box reaches GitHub fine (`github.com:22` and `ssh.github.com:443` both connect, `api.github.com` answers 200), so this was **auth, not network** — "the VPS cannot reach GitHub" was written here on the strength of a failing `git fetch` and it was not true.
   > **What is in place now:** a fresh ed25519 keypair at `/root/.ssh/tukuk_deploy`, registered on the repo as a **read-only** deploy key, and `/root/.ssh/config` selecting it for `github.com` (`IdentitiesOnly yes`). `origin` is `git@github.com:fevian448/tukuk-os-v2.git` again, and the bundle is kept as a second remote, `handover`, for the day GitHub is genuinely unreachable. `git push` from a box is refused **by GitHub** (`ERROR: The key you are authenticating with has been marked as read only`) — the guard is server-side, so re-enabling push means deleting the key, not editing a file nobody reads.
   > **So the dev-machine workflow is `bash scripts/ship-to-box.sh`**, which asks the box which transport it has (`remote get-url origin` + `git ls-remote origin` as root) rather than trusting this paragraph: on the GitHub path it pushes, starts `tukuk-update.service` and stops; on the degraded path it also rebuilds the full-history bundle, copies it (byte count compared at the far end, `git bundle verify` run inside `/opt/tukuk-os`, previous bundle kept as `.pre-<sha>`), points `origin` at it **for the duration only**, and puts it back on the `EXIT` trap — because a box left fetching a bundle is the failure this whole note is about. Both paths refuse to call it done until `/opt/tukuk-os` reports the shipped sha and `/health` shows the matching update record. Idempotent (already-live sha → exit 0 before any transport work), and it refuses a branch that is behind `origin/main`, because a bundle built without those commits leaves them out of production permanently. **Both transports have run for real:** `4c86a37` over GitHub, then `dcad3d6` with root's ssh config deliberately moved aside — the probe refused (`Permission denied (publickey)`), the bundle shipped end to end, and the last line of output was `origin put back at git@github.com:fevian448/tukuk-os-v2.git`. That rehearsal is also why the fallback is the fallback: repacking a full-history bundle cost the box **495.9 MB peak RSS and 10.7 s CPU** where GitHub's incremental of the same commits cost **32.7 MB and 2.2 s** (identical 7 s wall), and that work happens on a machine that is serving traffic.

---

## 🧠 6. AI Chat (Ask) — how it works & how to configure

The **"AI Chat"** widget (💬 at the corner of `/`) calls `GET /ask?q=...`.

**Chain:** `/ask` (`src/server.js`) → `rag.ask()` (`src/brain/rag.js`) → `provider` (`src/brain/provider.js`).

`provider.activeBackend()` picks a backend automatically (no Ollama/model required — suits a **CPU-only server**):
1. **Cloud LLM** (Groq / Gemini / OpenAI / …) — when a key exists. The server makes just 1 HTTP call; processing happens in the cloud, CPU ≈ 0.
2. **Local Ollama** — when `OLLAMA_HOST` (default `127.0.0.1:11434`) is reachable.
3. **Extractive answer** — if neither exists: quotes the most relevant sentences from the search results (`extractiveAnswer` in `src/brain/quality.js`). **0 models, 0 cost, always on.** (Out-of-the-box default, which is why `No answer` no longer happens.)

**Cloud + Ollama run CONCURRENTLY** (`rag.js` hybrid race): when both tiers exist, the cloud rotation and the local model chain generate **in parallel** and the first coherent answer wins — the loser is aborted instantly (no wasted tokens/CPU). Cloud normally wins in ~1–2s; the local model still fills the gap when every cloud provider is cooling/blipped, instead of the old sequential path that burned the whole `BRAIN_BUDGET_MS` on slow local generation and then fell to extractive with zero time left for cloud. `BRAIN_LOCAL_FIRST=1` no longer delays cloud — it only removes the ~1.2s cloud head-start so the local model begins immediately.

Self-referential questions ("what is tukuk-os", "endpoints", etc.) are answered from fixed knowledge (`src/brain/knowledge.js`) without an LLM.

**How to configure the cloud (pick one, then restart `node index.js`):**
- **Admin → AI Settings:** `aiProvider=gemini`, `aiApiKey=<your key>`, `aiModel=gemini-2.5-flash`; **or**
- **env:** `GEMINI_API_KEY=...` (also `GROQ_API_KEY`, `OPENAI_API_KEY`). Put it in `deploy/env.defaults` (private repo) so `npm install` auto-provisions.

**Check / test:** `GET /brain` → `provider` (`gemini|groq|openai|ollama|extractive`) & `online`; `GET /ask?q=question`.

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
- **Dedicated domain `tchat.tukuk.org`** (`2e4b400`): hostname gateway in `src/server.js` (`TCHAT_HOST`/`TCHAT_ALLOWED`/`CSP_TCHAT`) — only T Chat assets are routed, strict CSP (no ads/analytics, `frame-ancestors 'none'`), `X-Robots-Tag: noindex`, its own entry page deliberately takes **no proxy cache** (a private space is not shareable content), everything else 302 → `tukuk.org`. ⚠️ **TOKEN-mode** tunnels ignore the local `ingress:` → a hostname on the main tunnel must be added in the **Zero Trust dashboard**. Live route: it rides the **legacy build tunnel** instead (local ingress → `http://127.0.0.1:3000`, the nginx front) — both ways are written out in `.env.example` + `deploy/cloudflared/config-build.example.yml`, and that is why `deploy/builder-idle-stop.sh` stops only `tukuk-builder.service`, never the connector.
- **Cross-OS app:** native WebView APK **beta** (`public/downloads/tukuk-chat.apk`, ±65 KB, gains new features automatically without a rebuild — built by `scripts/build-apk.sh` without Gradle); PWA (`manifest.json`/`manifest-chat.json` + `sw.js`). **The `/download` page** (`public/download.html`, clean URLs §8) = one button **auto-picked by the visitor's OS**: direct APK (Android/Huawei/ChromeOS), PWA `beforeinstallprompt` (Windows/Linux/macOS), or *Add to Home Screen* instructions (iOS) + QR/share link. Links are on `/apps`, the `/` tile, and ⚙️ → Apps. A **stable** version has not been released yet (per user instruction: beta first).
- **Backups:** `deploy/chat-backup.service` + timer (R2 snapshot `scripts/backup-chat.sh`; `User=tukuk` so `$HOME` is not unbound).
- **Google Play:** new apps require an **AAB** + **target SDK 36** (from Aug 31, 2026). The manifest `apk/app/AndroidManifest.xml` is already set (code 2, target 36); `scripts/build-apk.sh` also produces a `.aab` when `bundletool` exists; store copy EN in `fastlane/metadata/android/`. Full runbook + account gates (USD 25 fee, Play App Signing, Console forms): **`PLAYSTORE.md`**. Recommended release starts with **Internal testing** (consistent with the beta-first policy).

---

## 🧩 8. Maintenance Notes (for you & any AI editing this code later) — IMPORTANT

- **Express routes = in memory.** After editing `src/server.js` (adding a path/`STATIC_PAGES`) → **MUST restart** `node index.js`. Otherwise: `public/*.html` looks changed already (read on every request), but the new route gives **404**.
- **Clean URLs for static pages** are registered through `STATIC_PAGES` (`src/server.js` ~L114): add a name (without `.html`) → `/name` serves `public/name.html`.
- **One-command setup:** `npm install` → `scripts/setup-all.sh` (postinstall) auto-generates `.env` from `deploy/env.defaults`, installs services & the tunnel. Repo is **private** → keys can live in `deploy/env.defaults`.
- **Admin** = email + **WebAuthn passkey** (not a PIN). `ADMIN_EMAIL=fevianbenjo48@gmail.com`. WebAuthn only works over **HTTPS** or `localhost`.
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

### 🚫 EDGE IS WORKERLESS — do NOT route a Worker on `tukuk.org` again
Both `tukuk.org` and `www.tukuk.org` are **plain CNAMEs to the tunnel** (`87e7e77f…cfargotunnel.com`, proxied) → nginx → Node. **No Cloudflare Worker sits on the request path.** `worker/wrangler.toml` has `routes = []` for exactly this reason — leave it empty.
- **Why:** the old `tukuk-www-worker` route proxied by `fetch()`ing `url.hostname = "tukuk.org"` — the SAME zone it was routed on. Every page therefore hit the zone **twice** (client request + Worker subrequest), which tripped Cloudflare's zone **rate-limiting** rule and returned **`HTTP 429 · error code: 1027` for every visitor**, while Node/nginx stayed perfectly healthy. `www` was a Worker *Custom Domain* (which auto-creates a read-only `AAAA 100::` DNS record the Zones API can't edit until the Custom Domain is deleted) and blocked the same way.
- **Recovery that worked:** delete the routes via `DELETE /zones/{Z}/workers/routes/{id}`, delete the Custom Domain via `DELETE /accounts/{ACC}/workers/domains/{id}` (both with a *Workers Scripts: Edit* token — WAF scope is **not** needed for these), then repoint `www` to the tunnel CNAME. The deployed `tukuk-www-worker` script has since been deleted; its source stays in `worker/` (inert) so it can be revived **without an apex route** if ever needed.
- **Failover replacement (no Worker):** nginx serves a branded `503 Under maintenance` (`@down`) / JSON (`@down_json` on `/api` + `/health`) when the origin is unreachable and there is no stale cache — `deploy/nginx/tukuk-front.conf`. This lives one hop **before** the tunnel, so it is invisible to zone security rules and adds zero requests (it can never cause a 429). The `scripts/watchdog.sh` public-edge check classifies `429/1027` vs tunnel-down vs non-2xx and logs the edge-block case loudly.

### 🧊 R2 DISASTER-RESTORE RUNBOOK (workerless — nothing auto-serves a fallback now)
Because there is no fallback Worker on the request path, R2 is now purely a **cold copy**: it recovers data/box loss, it does NOT keep visitors served during an outage (that is nginx `@down`'s job above). Two independent tracks, both into bucket `tukuk-fallback`:
- **Dynamic data — `data/`** (chat, plays, comments, publishes, stats): written **hourly** by `tukuk-data-backup.timer` → `scripts/backup-data.sh` to rotating keys `backups/tukuk-data-<day><hour>.tar.gz` (168 slots = 7 days, self-overwriting, no delete API). **Restore:** `bash scripts/restore-data.sh [slot]` (empty slot → current-hour copy). It is safe — the existing `data/` is moved to `data.broken-<ts>/` before extracting — then `sudo systemctl restart tukuk-os`.
- **Static site snapshot:** written **every 6 hours** by `tukuk-snapshot.timer` → `scripts/snapshot-r2.sh` (rendered HTML/assets mirror). This is a **last-resort static mirror** only if the origin box is gone entirely — nothing serves it live any more.
- **If the whole box dies:** re-provision a fresh Ubuntu host → `git clone` → `sudo bash scripts/install-from-usb.sh`/`setup-all.sh` (brings tunnel + nginx + Node up) → then `scripts/restore-data.sh` to pull the freshest `data/` from R2. The workerless edge needs **no Worker re-deploy** — DNS is just two tunnel CNAMEs (`@`, `www`) + `dashboard`.
- **Both tracks default to the backup-Worker upload path** (`BACKUP_WORKER_URL` + `BACKUP_UPLOAD_SECRET`) because the VPS token has **no R2 scope**; the `wrangler r2 object` branch only works with an R2:Edit token. `GET`/`PUT` on `tukuk-fallback` therefore go through that upload worker, not `wrangler`.
- **⚠ STATUS (Oct 2026): the VPS's own R2 upload track is BLOCKED (hourly timers still 429) — but offsite was REVIVED Oct 27 via the laptop→R2 OAuth path described below, so nightly cloud copies DO land again.** `*.workers.dev` now 429s *permanently* (7+ days of failed timers in journalctl). Re-routing attempts all hit the same wall: a Worker zone-route on `tukuk.org/_path*` and custom domains on new subdomains (`tukuk-sync`, `ping`) each answer **429 · error 1027 from the first request** — the zone has a security/rate rule that no machine credential (VPS token, Pages token, wrangler OAuth) can read or edit. **Do not add more routes; the edge stays workerless.** Interim second-device copy: `scripts/backup-laptop.sh` (nightly 03:45 via systemd-user timer `tukuk-laptop-backup.timer`, `Persistent=true`, 14 dailies in `~/tukuk-backups/`). **REVIVED (Oct 27): the laptop now also pushes each nightly archive straight into R2** — its `wrangler` OAuth token has full R2 put/get/delete on `tukuk-fallback` (unlike every API token), keys under `laptop-backup/data-YYYYMMDD.tar.gz`, verified by an md5 round-trip. So offsite R2 copies exist again with ZERO dashboard changes. The VPS timers' own track still needs ONE optional dashboard action: grant the VPS `CLOUDFLARE_API_TOKEN` an **Account · R2 Storage · Read & Edit** scope — the five upload scripts self-heal (after the throttled workers.dev POST exhausts retries they fall through to the direct `wrangler r2 object put` path, verified live), giving hourly offsite without anyone editing `/opt/tukuk-os/.env`. (Alternative: find & exception the zone rule that 1027s new hostnames.)

**Tunnel (ONE only now):** `tukuk-os-v2` · UUID `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae` · **TOKEN mode** (no `.json` files).
- Token = `cloudflared tunnel token 87e7e77f…` (uses `~/.cloudflared/cert.pem`). Already stored in `deploy/env.defaults` (`CF_TUNNEL_TOKEN` + `CF_TUNNEL_ID`).
- `/etc/cloudflared/config.yml` is written by `setup-all.sh` (token + ingress) + the systemd unit `--config … tunnel run`. **`cloudflared service install` REJECTS `token:` configs** — that is why the unit is written directly.
- **The VPS has no `cert.pem`**, so every cert-authenticated `cloudflared` subcommand (`tunnel list`, `tunnel status`, `tunnel route dns`) dies with *"Cannot determine default origin certificate path"*. Do not read that as an outage — it is the missing laptop credential, not the tunnel. What actually means something: `systemctl is-active cloudflared` and a request that goes through the edge (`curl -sI https://tukuk.org/health` → 200 + `server: cloudflare`). Both measured 29 Oct 2026; `scripts/ship-to-box.sh` checks the second one after every deploy because a healthy restart and a dead connector are indistinguishable from loopback.
- **Do NOT `tunnel create` a new one.** To serve a new hostname = add an `ingress` line in `deploy/cloudflared/config.yml` + `cloudflared tunnel route dns tukuk-os-v2 <subdomain>`.

**DNS inventory & meaning (13 records):**
| Record | For | Delete? |
|---|---|---|
| `CNAME @ (tukuk.org) → 87e7e77f…cfargotunnel` (proxy) | Main site | ❌ NEVER |
| `CNAME dashboard → 87e7e77f…` (proxy) | Panel/admin | ❌ NEVER |
| `CNAME www → 87e7e77f…cfargotunnel` (proxy) | www mirror → Node 301 to apex (workerless) | ❌ NEVER |
| `MX ×3 → route1/2/3.mx.cloudflare.net` | Cloudflare Email Routing | ❌ NEVER |
| `TXT @ → v=spf1 include:_spf.mx.cloudflare.net` | Email SPF | ❌ NEVER |
| `TXT cf2024-1._domainkey` (DKIM) · `TXT _dmarc` | Email DKIM/DMARC | ❌ NEVER |
| `CAA @ → 0 issue "digicert.com"` | Allow Cloudflare certs | ❌ NEVER |
| `CNAME github/gitlab/bitbucket → *.com` (proxy) | Convenience aliases (not needed by Tukuk-OS) | ⚠️ can delete if unused |

**Already cleaned (this session) — do not try to re-enable:** DNS `api.tukuk.org` & `mqtt.tukuk.org` (pointing at a dead tunnel → 530) **deleted**; dead tunnels `5ee04cc8` (cloudflare-os), `b400ad84` (iot-audit), `168a53af` (tukuk-os) **deleted**. Only 1 active tunnel remains.

**Security:** `cert.pem` (`~/.cloudflared`) contains an `apiToken` `cfut_…` — **never commit**; permissions 600 only. The API token is also kept in `deploy/env.defaults` (private) for auto-DNS/edge.

---

## 🆓 10. Free Stack (Free Tier) — all already connected

None of it needs payment at small scale. Here is the list + where each is set:
| Service | Free plan | Where / how |
|---|---|---|
| **Cloudflare DNS + Tunnel** | Free | Zone `tukuk.org`; tunnel `tukuk-os-v2` (token mode) |
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

**All of these come up automatically after `npm install`** because keys live in `deploy/env.defaults` (private repo). What NEEDS manual dashboard action (cannot be automated): register Search Console, submit to AdSense, enable the Clarity tag.

---

## 💰 11. Google AdSense — Status & Honest Answer: "will it pass?"

**Infrastructure ALREADY ready (✓):**
- Real `ads.txt`: `ca-pub-8954948214333501` (Google, verified). Microsoft line removed until a real Monetize/Xandr (`appnexus.com, <memberId>, DIRECT, f5ab79cb980f11d1`) account ID is available.
- `ADSENSE_ENABLED=true`, client `ca-pub-8954948214333501` (`src/config.js`); slots placed **only on content/blog pages** (`server.js:822`), **not** on `/cari` (search results) → policy compliant (no ads on third-party content).
- `sitemap.xml` (route exists), correct `robots.txt` (allows Googlebot/AdsBot), **48 original articles** (28 blog + 20 archive), Privacy/About/Contact/Terms pages present, HTTPS, mobile-friendly.

**What Google still evaluates on its own (✗ code cannot guarantee):**
1. **Real organic traffic** — needs actual visitors for a few weeks. New sites without traffic often land in "Pending/Not ready".
2. **Enough content & not copied** — 48 articles is good, but avoid duplicate/low-value content; steer clear of thin auto-generated pages.
3. **Clear navigation** — menus/links between pages (Studio/blog/about) must exist.
4. **Domain & history** — a mature `tukuk.org` with no prior rejections helps.
5. **Real ad slots** — currently `slotTop/InArticle/Bottom` are the same (`2206273113` = placeholder). After approval, create **3 distinct ad units** in AdSense & set their IDs (or leave them auto).

**Straight answer:** **GOOD** odds technically (all major policy conditions are met), but **approval is not guaranteed** — Google wants organic traffic & content age/originality. **Recommended steps:** (a) register Search Console + submit the sitemap, gather some real traffic (IndieHackers/Reddit/your own products), (b) make sure navigation links work, (c) then apply for AdSense for `tukuk.org`. Do not paste AdSense code before the account is approved (it can trigger a rejection).

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

**Setup (done & verified green):** Secrets `CLOUDFLARE_API_TOKEN` (a token scoped to **`Cloudflare Pages: Edit`**) + `CLOUDFLARE_ACCOUNT_ID` (`391d9aa59cfcc5ec44c3d25c855c45cb`) are set; **Workflow permissions = Read and write** is enabled. One full run (`workflow_dispatch`) succeeded: generate word → **Pages deploy OK** → bot `git push`es the manifest back to `main`. The daily cron `03:15 MYT` now updates **Cloudflare Pages (`tukuk-satu-kata.pages.dev`)** AND commits the next word automatically. The Pages step is `continue-on-error: true` so the cron still commits even if the Pages deploy has trouble. **Primary hosting `tukuk.org/satu-kata` stays token-free** (second path / redundancy). The workflow has no `push` trigger → no CI loops. ⚠️ `generated/` (a new word each cron) reaches the VPS via **auto-git-pull** (`/opt/tukuk-os` is already a `git clone` — see §5#4): bot commits the manifest → `tukuk-update.timer` pulls → the `tukuk.org/satu-kata` hub updates itself.

**Why the default is not Unity:** Unity needs a licensed editor + heavy builds → unsuitable for "1 day 1 game" automation on free CI without burdening the server. Web (Phaser) = the automatic default; Unity stays a manual opt-in scaffold.

**⚠️ Git gotcha:** pushing `.github/workflows/*` files **requires** the `workflow` scope — `gh auth refresh -h github.com -s workflow`; otherwise GitHub will **reject** the push (`refusing to allow an OAuth App to create or update workflow ... without workflow scope`).

**Word ordering:** edit `scripts/satu-kata/words.txt` (`word | emoji | tagline`). `generated/` is committed (small; HTML only) so CI knows which words are already used.

---

## 🔮 13. Future Roadmap
- ✅ **1 Day 1 App + Game:** **DONE** — see **§12** (GitHub Actions cron generates an app+game for every word, every day, automatically).
- **Unity Cloud Games:** Opt-in scaffold exists (**§12**); next = connecting a Unity WebGL *build* (needs a license + paid/manual CI minutes) into the Tukuk-OS games tab.
- **Kaggle CLI:** Use the Kaggle CLI to process heavy AI data/training when the laptop's RAM is limited.
