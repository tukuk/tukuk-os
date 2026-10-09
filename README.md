# Tukuk-OS v2 — Panduan Rujukan Pantas (Cheat Sheet & README)

Enjin carian web bebas, ringan, dan berkuasa tinggi yang dioptimumkan untuk pelayan RAM rendah (2GB) dan integrasi awan (Cloudflare, Google AdSense, Microsoft Ads).

> **Ini satu-satunya projek yang difokuskan.** Jangan pecah tumpuan ke repo lain.

---

## ⚡ TL;DR — Runbook Pantas (baca ini dulu)

**Benda yang anda JARANG sentuh tapi SELALU perlu tahu:**

| Nak buat... | Arahan / fakta |
|---|---|
| Jalankan tempatan | `npm install` → `npm start` → `http://localhost:3000` |
| Deploy ke SERVER BARU | Bawa kod (USB/push) → `sudo bash scripts/install-from-usb.sh`. Semua auto (Node, Meili, systemd, tunnel, edge). **Tiada auth GitHub / tiada fail `.json`.** |
| Server sedang berjalan | `192.168.8.100` (user `tukuk`). Akses admin: `ssh -L 3000:localhost:3000 tukuk@192.168.8.100` → `http://localhost:3000/admin` (e-mel + **passkey WebAuthn**). Awam: `https://dashboard.tukuk.org/admin` |
| Ubah halaman statik (`public/*.html`) | **Hanya reload browser** — dibaca setiap request. |
| Ubah `src/server.js` (route/`STATIC_PAGES`) | **WAJIB restart** `node index.js` — route dalam memori. |
| Tukar config/kunci | Edit `deploy/env.defaults` (repo private) → `sudo bash scripts/setup-all.sh` (idempotent). |
| Jana app+game dari 1 kata | `node scripts/satu-kata/generate.mjs [kata]` — CI percuma (GitHub Actions) cron harian → hub disajikan di **`tukuk.org/satu-kata/`** (Cloudflare Pages = pilihan). Lihat **§12** |
| Semak kesihatan | `https://tukuk.org/health` (200), `/brain`, `/ask?q=...` |
| Situs awam kini | ✅ `tukuk.org`, `dashboard.tukuk.org`, `www.tukuk.org` = **200** (Cloudflare Free) |

**Rangka fail kunci:** `src/server.js` (semua route) · `public/index.html` (SPA carian+dashboard) · `public/editor.html` & `public/editor-video.html` (Studio) · `src/brain/*` (AI + carian) · `scripts/setup-all.sh` (auto-setup) · `deploy/env.defaults` (kunci & config terbawa) · `deploy/cloudflared/config.yml` (templat tunnel).

---

## 🚀 1. Cara Mula Tempatan (Local Testing)

```bash
# Pasang dependensi
npm install

# Mulakan pelayan
npm start
```
* **Enjin Carian / UI:** `http://localhost:3000`
* **Admin Dashboard:** `http://localhost:3000/admin` (login e-mel + **WebAuthn passkey** — bukan PIN lama)
* **Endpoint Kesihatan:** `http://localhost:3000/test`

---

## 🛠️ 2. Pusat Kawalan Admin (`/admin`)

Selepas melayari `http://localhost:3000/admin` dan login (e-mel + passkey WebAuthn), anda boleh mengakses:
- **Server & Security Monitor:** Pemantau RAM 2GB, penggunaan CPU, dan statistik dokumen terindeks (30+ dokumen asas).
- **Web Terminal:** Jalankan arahan pelayan secara langsung (cth. `git status`, `uptime`, `npm test`).
- **Add Web Crawl:** Masukkan URL untuk merayau dan mengindeks kandungan baharu serta-merta.
- **Ads (Google & MS):** Tetapan ID Penerbit Google AdSense dan Microsoft Advertising.
- **UI & Custom Theme:** Tukar tajuk laman, logo gelap/cerah, mod latar belakang, dan warna tema.
- **Articles & Blog:** Tulis dan terbitkan artikel baharu.
- **AI Engine & Writer:** Konfigurasi API AI (Google Gemini / Ollama).

---

## 📢 3. Pengesahan Iklan (`ads.txt`)

Fail [ads.txt](file:///home/fevian/AndroidStudioProjects/tukuk-os-v2/public/ads.txt) di direktori `public/` mengandungi autorisasi rasmi untuk:
- **Google AdSense:** `pub-8954948214333501`
- **Microsoft Advertising:** `100001`

---

## 💿 4. Pembinaan ISO Pelayan (Turnkey ISO untuk 2GB RAM)

Untuk membina imej ISO but autonomi (Ubuntu 24.04 LTS Autoinstall dengan ZRAM & Node.js):
```bash
sudo ./deploy/build-iso.sh
```
* **Hasil:** `/tmp/tukuk-os-server-24.04.iso` (bakar ke USB menggunakan Rufus / BalenaEtcher).
* **ZRAM Swap:** Dikonfigurasikan automatik pada pelayan (75% mampatan ZRAM) supaya pelayan 2GB RAM berjalan sangat lancar tanpa *crash*.
* ⚠️ **Amaran:** langkah `late-commands` dalam autoinstall *clone* repo **private** → akan gagal tanpa GitHub token. Untuk mesin baru, **guna laluan USB di §5** (lebih mudah, tiada auth diperlukan).

---

## 🌐 5. Deployment Pelayan & Cloudflare Tunnel

0. **Install dari USB (paling mudah untuk server baru — tiada auth GitHub diperlukan):**
   Repo kini **private**, jadi `git clone` di mesin baru perlu SSH key/PAT. Sebagai ganti, bawa kod pada USB dan biarkan server hanya guna internet untuk `npm install`:
   ```bash
   # (i) Di mesin dev — salin repo ke USB (tanpa node_modules):
   rsync -a --exclude node_modules --exclude meili_data --exclude .wrangler \
         ./  /media/$USER/USB/tukuk-os/

   # (ii) Di SERVER — salin dari USB & jalankan SATU skrip:
   cp -r /media/$USER/USB/tukuk-os /tmp/tukuk-os
   sudo bash /tmp/tukuk-os/scripts/install-from-usb.sh   # atau: npm run usb
   ```
   Skrip menyalin ke `/opt/tukuk-os`, jana `.env` daripada `deploy/env.defaults`, dan panggil `setup-all.sh` (Node→Meili→servis→tunnel). **Server mesti ada internet** untuk langkah ini.
   - **Offline penuh (tiada internet):** `TUKUK_KEEP_NODEMODULES=1 TUKUK_OFFLINE=1 sudo bash scripts/install-from-usb.sh` — tapi anda juga mesti bawa `node_modules` (dijana pada mesin online arch sama) + binary `node`/`cloudflared`/`meilisearch`, dan aktifkan servis systemd secara manual.
   - **Tunnel & edge AUTOMATIK:** `deploy/env.defaults` kini sudah mengandungi `CF_TUNNEL_TOKEN` + `CF_TUNNEL_ID` (tunnel `tukuk-os-v2`) dan `CLOUDFLARE_API_TOKEN` — jadi `setup-all.sh` terus hidupkan tunnel (mod TOKEN, tanpa fail `.json`) dan deploy worker/edge. **Tiada langkah manual diperlukan** pada server baru.

1. **Quick Install pada Ubuntu Server sedia ada (`192.168.8.100`):**
   ```bash
   sudo ./deploy/quick-install.sh
   ```
2. **Cloudflare Tunnel (mod TOKEN — automatik, jangan create baru):**
   Tunnel `tukuk-os-v2` (UUID `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae`) sudah wujud & token tersimpan di `deploy/env.defaults`. `setup-all.sh` menulis `/etc/cloudflared/config.yml` (token + ingress `tukuk.org`/`www`/`dashboard`) dan unit systemd `--config ... tunnel run`. **DNS `tukuk.org`/`dashboard`/`www` sudah di-route.** Hanya perlu `sudo bash scripts/setup-all.sh` — jangan `tunnel create` baru.

---

## 🧠 6. AI Sembang (Chat) — cara berfungsi & cara atur

Widget **"AI Sembang"** (💬 di sudut skrin pada `/`) memanggil `GET /ask?q=...`.

**Rantaian:** `/ask` (`src/server.js`) → `rag.ask()` (`src/brain/rag.js`) → `provider` (`src/brain/provider.js`).

`provider.activeBackend()` auto-pilih backend (tiada Ollama/model wajib — sesuai **server CPU-only**):
1. **Cloud LLM** (Gemini / OpenAI / Groq) — bila ada kunci. Server cuma buat 1 panggilan HTTP; pemprosesan di awan, CPU ≈ 0.
2. **Ollama** lokal — bila `OLLAMA_HOST` (lalai `127.0.0.1:11434`) dapat dihubungi.
3. **Jawapan ekstraktif** — kalau tiada kedua-duanya: kutip ayat paling relevan daripada hasil carian (`extractiveAnswer` di `src/brain/quality.js`). **0 model, 0 kos, sentiasa jalan.** (Lalai luar-kotak, sebab itu `Tiada jawapan` tidak lagi berlaku.)

Soalan kendiri ("apa itu tukuk-os", "endpoint", dll.) dijawab dari pengetahuan tetap (`src/brain/knowledge.js`) tanpa LLM.

**Cara atur cloud (pilih satu, kemudian restart `node index.js`):**
- **Admin → AI Settings:** `aiProvider=gemini`, `aiApiKey=<kunci Anda>`, `aiModel=gemini-2.5-flash`; **atau**
- **env:** `GEMINI_API_KEY=...` (juga `GROQ_API_KEY`, `OPENAI_API_KEY`). Letak di `deploy/env.defaults` (repo private) supaya `npm install` auto-provision.

**Semak / uji:** `GET /brain` → `provider` (`gemini|groq|openai|ollama|extractive`) & `online`; `GET /ask?q=soalan`.

**Flag:** `BRAIN_ENABLED=false` lumpuhkan `/ask` (503). `BRAIN_FAST_MODE=true` (lalai) + Ollama → ekstraktif serta-merta (langkau LLM). `LLM_CHAIN` = failover Ollama.

---

## 🎛 7. Tukuk Studio (suite alat dalam pelayar, tanpa upload)

- **`/editor`** (`public/editor.html`) — editor **IMEJ** penuh: penapis + suhu/vignette; anotasi bentuk (pen/garis/panah/segiti empat/elips + togol isi); berus; stiker emoji; lurus (straighten), tajamkan (konvolusi), mosaik; crop nisbah; bingkai; resize; teks boleh seret; bucu bulat; batch; simpan/buka **projek .json (v3)**; undo/redo. Semua client-side.
- **`/editor-video`** (`public/editor-video.html`) — editor **VIDEO**: trim In/Out, penapis + vignette, putar/flip, nisbah aspek (1:1/16:9/9:16/4:5/4:3), kelajuan, kapsyen; **snapshot PNG** bingkai & **eksport WebM** (`canvas.captureStream` + `MediaRecorder`, rakaman **masa nyata**). Hanya fail **lokal** (URL luar mencemari canvas → eksport gagal).
- **`/cari`** — halaman **HASIL** carian (SPA `index.html` yang sama pada URL berasingan). Permukaan **KOSONG iklan** (patuh dasar AdSense); **`/`** = dashboard kandungan original (layak iklan).
- **`/cc?q=...`** — API carian aset **Creative Commons** (Wikimedia Commons, tiada kunci) → `{title,thumb,full,license,author}`; dipaparkan pada tab **"🧩 CC Aset"** dan boleh terus dibuka di `/editor?img=`.
- **`/api/image?url=`** — proksi imej **same-origin** supaya canvas tidak "tainted" (penting untuk eksport/lightbox/edit gambar luar).
- **`studio.html`** = hub alat; tile paparan ada pada dashboard `/`.

---

## 🧩 8. Nota Penyelenggaraan (untuk anda & AI yang edit kod ini nanti) — PENTING

- **Route Express = dalam memori.** Selepas ubah `src/server.js` (tambah laluan/`STATIC_PAGES`) → **WAJIB restart** `node index.js`. Jika tidak: `public/*.html` nampak sudah berubah (dibaca setiap request), tetapi laluan baru beri **404**.
- **URL bersih halaman statik** didaftar melalui `STATIC_PAGES` (`src/server.js` ~L114): tambah nama (tanpa `.html`) → `/nama` serve `public/nama.html`.
- **Setup satu perintah:** `npm install` → `scripts/setup-all.sh` (postinstall) auto-jana `.env` daripada `deploy/env.defaults`, pasang perkhidmatan & tunnel. Repo **private** → kunci boleh tinggal di `deploy/env.defaults`.
- **Admin** = e-mel + **WebAuthn passkey** (bukan PIN). `ADMIN_EMAIL=fevianbenjo48@gmail.com`. WebAuthn hanya jalan atas **HTTPS** atau `localhost`.
- **Bahasa:** UI **Melayu**; komen kod & penjelasan ikut harness (English). Kekal konsisten.
- **Aset & iklan:** utamakan aset berlesen **CC**; **jangan** letak iklan pada halaman hasil carian pihak ketiga (`/cari`).
- **Semak sintaks JS dalam HTML:** `awk '/<script>/{f=1;next}/</script>/{f=0} f' public/FILE.html > /tmp/x.js && node --check /tmp/x.js`.
- **Git:** jangan commit/push tanpa arahan pengguna. (Setakat ini semua kerja Studio/AI/video-fix **sudah di-commit & push** ke `origin/main`.)

---

## ☁️ 9. Cloudflare — Fakta, Audit & Peraturan (JANGAN rombak buta)

**Zon:** `tukuk.org` · **Plan:** *Free Website* (Cloudflare Free) · **Node bind:** `127.0.0.1:3000` (loopback-only → awam HANYA melalui tunnel).

**Tunnel (SATU sahaja kini):** `tukuk-os-v2` · UUID `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae` · **mod TOKEN** (tiada fail `.json`).
- Token = `cloudflared tunnel token 87e7e77f…` (guna `~/.cloudflared/cert.pem`). Sudah disimpan dalam `deploy/env.defaults` (`CF_TUNNEL_TOKEN` + `CF_TUNNEL_ID`).
- `/etc/cloudflared/config.yml` ditulis `setup-all.sh` (token + ingress) + unit systemd `--config … tunnel run`. **`cloudflared service install` TOLAK config `token:`** — itu sebab unit ditulis terus.
- **JANGAN `tunnel create` baru.** Sediakan hostname baru = tambah baris `ingress` di `deploy/cloudflared/config.yml` + `cloudflared tunnel route dns tukuk-os-v2 <subdomain>`.

**Inventori DNS & maksudnya (13 rekaman):**
| Rekaman | Untuk | Padam? |
|---|---|---|
| `CNAME @ (tukuk.org) → 87e7e77f…cfargotunnel` (proxy) | Situs utama | ❌ JANGAN |
| `CNAME dashboard → 87e7e77f…` (proxy) | Panel/admin | ❌ JANGAN |
| `AAAA www → 100::` (proxy) | Fallback www (Worker edge) | ❌ JANGAN |
| `MX ×3 → route1/2/3.mx.cloudflare.net` | E-mel Cloudflare Email Routing | ❌ JANGAN |
| `TXT @ → v=spf1 include:_spf.mx.cloudflare.net` | SPF e-mel | ❌ JANGAN |
| `TXT cf2024-1._domainkey` (DKIM) · `TXT _dmarc` | DKIM/DMARC e-mel | ❌ JANGAN |
| `CAA @ → 0 issue "digicert.com"` | Benarkan cert Cloudflare | ❌ JANGAN |
| `CNAME github/gitlab/bitbucket → *.com` (proxy) | Alias selesa (bukan perlu Tukuk-OS) | ⚠️ boleh padam jika tak guna |

**Sudah dibersihkan (session ini) — jangan cuba hidupkan semula:** DNS `api.tukuk.org` & `mqtt.tukuk.org` (menunjuk tunnel mati → 530) **dipadam**; tunnel mati `5ee04cc8` (cloudflare-os), `b400ad84` (iot-audit), `168a53af` (tukuk-os) **dipadam**. Tinggal 1 tunnel aktif.

**Keselamatan:** `cert.pem` (`~/.cloudflared`) mengandungi `apiToken` `cfut_…` — **JANGAN commit**; keizinan 600 sahaja. Token API juga tersimpan di `deploy/env.defaults` (private) untuk auto-DNS/edge.

---

## 🆓 10. Stack Percuma (Free Tier) — semua dah disambungkan

Tiada satu pun perlu dibayar untuk skala kecil. Ini senarai + tempat ia diset:
| Perkhidmatan | Pelan percuma | Di mana / cara |
|---|---|---|
| **Cloudflare DNS + Tunnel** | Free | Zon `tukuk.org`; tunnel `tukuk-os-v2` (mod token) |
| **Cloudflare Workers** | 100k req/hari | `worker/` + `cloudflare-worker/tukuk-fallback` (cermin www) — deploy bila `CLOUDFLARE_API_TOKEN` ada |
| **Cloudflare R2** | 10 GB simpan | Snapshot `scripts/snapshot-r2.sh` (timer 6 jam) — fail `scripts/r2.env` |
| **Cloudflare Email Routing** | Free | MX/SPF/DKIM/DMARC aktif (hello@tukuk.org) |
| **Cloudflare Zero Trust** | 50 pengguna free | Tunnel + akses; passkey admin |
| **Meilisearch** | Open-source | Carian indeks (self-host, RAM rendah + ZRAM) |
| **IndexNow** | Free (Bing/Yandex/DuckDuckGo) | `scripts/indexnow.sh` + kunci `public/bd8f0317….txt` |
| **Google Search Console** | Free | Fail verifikasi `public/*.html` (bingbot dsb.) — daftar & submit `sitemap.xml` |
| **Microsoft Clarity** | Free (analitik tanpa cookie) | Token pernah dikongsi — letak ID di Admin jika mahu rekod sesi |
| **NASA APOD API** | Free (DEMO_KEY) | `src/nasa.js` / `public/nasa.html` |
| **GitHub Actions** | 2,000 min/bln (private) · unlimited (public) | Otak cron + deploy `satu-kata` → `.github/workflows/satu-kata.yml` |
| **GitLab CI** | ~400 min/bln | Mirror mingguan `satu-kata` → `.gitlab-ci.yml` |
| **Cloudflare Pages** | Free (statis) | Hub app+game `tukuk-satu-kata` (`generated/public/`) — §12 |
| **Google AdSense / Microsoft Ads** | Free (hasil) | `public/ads.txt` + `src/config.js:adsense` |

**Semua ini lalai-lalai hidup sebaik `npm install`** kerana kunci tersimpan di `deploy/env.defaults` (repo private). Yang PERLU tindakan manual di dashboard (tak boleh auto): daftar Search Console, hantar AdSense, aktifkan Clarity tag.

---

## 💰 11. Google AdSense — Status & Jawapan Jujur: "akan lulus?"

**Infrastrukur SUDAH sedia (✓):**
- `ads.txt` asli: `ca-pub-8954948214333501` + Microsoft.
- `ADSENSE_ENABLED=true`, klien `ca-pub-8954948214333501` (`src/config.js`); slot dipasang **hanya pada halaman kandungan/blog** (`server.js:822`), **bukan** pada `/cari` (hasil carian) → patuh dasar (tiada iklan atas kandungan pihak ketiga).
- `sitemap.xml` (route wujud), `robots.txt` betul (benarkan Googlebot/AdsBot), **48 artikel** asli (28 blog + 20 arkib), halaman Privacy/About/Contact/Terms ada, HTTPS, mesra-mobil.

**Yang Google TETAPI nilai sendiri (✗ tak boleh dijamin oleh kod):**
1. **Trafik organik asli** — perlu pelawat sebenar beberapa minggu. Site baru tanpa trafik kerap "Pending/Not ready".
2. **Kandungan cukup & bukan salin** — 48 artikel baik, tapi pastikan tak duplicate/low-value; elakan halaman auto-jana tipis.
3. **Navigasi jelas** — menu/pautan antara halaman (ada Studio/blog/about) mesti wujud.
4. **Domain & sejarah** — `tukuk.org` matang + tiada penolakan sebelum ini membantu.
5. **Slot iklan sejati** — kini `slotTop/InArticle/Bottom` sama (`2206273113` = placeholder). Lepas diluluskan, Jana **3 ad unit berbeza** di AdSense & letak ID masing-masing (atau biarkan auto).

**Jawapan terus:** Peluang **BAIK** dari segi teknikal (semua syarat dasar utama sudah dipenuhi), tetapi **kelulusan tidak dijamin** — Google mahu trafik organik & usia/keaslian kandungan. **Langkah disyorkan:** (a) daftar Search Console + submit sitemap, kumpul beberapa trafik asli (IndieHackers/Reddit/produk anda), (b) pastikan pautan navigasi hidup, (c) baru mohon AdSense untuk `tukuk.org`. Jangan tampal kod AdSense sebelum akaun diluluskan (ini boleh trigger penolakan).

---

## 🧩 12. Satu Kata — skills agent + CI/CD percuma (1 kata → app + game)

Ubah **satu kata** menjadi **satu web-app + satu web-game** yang siap live — **tanpa build step**. Pembinaan (generate) berjalan di runner percuma (GitHub Actions), jadi VPS tak dibebani *build*. **Hosting utama = terus dari tapak:** hub disajikan pada **`https://tukuk.org/satu-kata/`** (mount statik `generated/public` di `src/server.js`) — **tiada Cloudflare Pages atau token API diperlukan**. Cloudflare Pages (`tukuk-satu-kata`) hanya **pilihan/aksesori**.

**Cara guna:**
- `node scripts/satu-kata/generate.mjs [kata] [--unity] [--dry]` — tulis `generated/public/<slug>/{app,game}/index.html`, kemas kini **hub** `generated/public/index.html` + `generated/manifest.json`.
- **Skills agent:** `kilo satu-kata [kata]` — lihat `.kilo/command/satu-kata.md` (format sama dengan command Kilo lain).
- Tiada kata diberi → auto-pilih kata **seterusnya** dalam `scripts/satu-kata/words.txt` yang belum ada di manifest (inilah yang cron guna setiap hari). Keluaran **idempotent** (slug → sama, kemas kini bukan duplikat).
- App = **Preact+htm** (gaya React, HTML tunggal). Game = **Phaser** (canvas). Tema (palette + genre) **deterministik** daripada hash slug.

**CI/CD — siapa buat apa:**
| Peranan | Sumber (percuma) | Fail |
|---|---|---|
| Cron harian `03:15 MYT` + trigger manual | **GitHub Actions** | `.github/workflows/satu-kata.yml` |
| Hosting + deploy | **utama: `tukuk.org/satu-kata`** (mount statik, tanpa token) · pilihan: Cloudflare Pages `tukuk-satu-kata` | `src/server.js` (`GENERATED_DIR`) |
| Mirror mingguan (terhad) | **GitLab CI** (~400 min/bln → schedule-only, tak ubah state GitHub) | `.gitlab-ci.yml` |
| Game "serius" (opt-in manual) | **Unity Cloud** | `scripts/satu-kata/templates/unity-GameMain.cs.tpl` |

**Setup (sudah dibuat & disahkan hijau):** Secret `CLOUDFLARE_API_TOKEN` (token **bercakupan `Cloudflare Pages: Edit`**) + `CLOUDFLARE_ACCOUNT_ID` (`391d9aa59cfcc5ec44c3d25c855c45cb`) sudah diset; **Workflow permissions = Read and write** sudah dihidupkan. Satu larian penuh (`workflow_dispatch`) berjaya: jana kata → **deploy Pages OK** → bot `git push` manifest semula ke `main`. cron harian `03:15 MYT` kini auto kemas kini **Cloudflare Pages (`tukuk-satu-kata.pages.dev`)** DAN commit kata seterusnya. Langkah Pages `continue-on-error: true` supaya cron kekal commit walaupun deploy Pages bermasalah. **Hosting utama `tukuk.org/satu-kata` tetap bebas-Token** (jalur kedua / redundancy). Workflow tak ada trigger `push` → tiada gelung CI. ⚠️ `generated/` pada VPS diselaraskan via rsync/auto-update (bukan git repo di `/opt/tukuk-os`).

**Kenapa default bukan Unity:** Unity perlukan editor berlesen + build berat → tak sesuai untuk "1 hari 1 game" auto pada CI percuma tanpa membebankan server. Web (Phaser) = default auto; Unity kekal scaffold opt-in manual.

**⚠️ Git gotcha:** push fail `.github/workflows/*` **kena** ada scope `workflow` — `gh auth refresh -h github.com -s workflow`; kalau tidak GitHub akan **reject** push (`refusing to allow an OAuth App to create or update workflow ... without workflow scope`).

**Susun kata:** sunting `scripts/satu-kata/words.txt` (`kata | emoji | tagline`). `generated/` di-commit (kecil; HTML sahaja) supaya CI tahu kata mana sudah guna.

---

## 🔮 13. Pelan Masa Depan (Future Roadmap)
- ✅ **1 Hari 1 App + Game:** **Sudah SIAP** — lihat **§12** (cron GitHub Actions jana app+game setiap kata, setiap hari, auto).
- **Unity Cloud Games:** Scaffold opt-in sudah ada (**§12**); seterusnya = sambungkan *build* WebGL Unity (perlun lesen + minit CI berbayar/manual) ke tab permainan Tukuk-OS.
- **Kaggle CLI:** Gunakan Kaggle CLI untuk memproses data/latihan AI berat jika RAM laptop terbatas.
