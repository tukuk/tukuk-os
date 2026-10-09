# Tukuk-OS v2 — Panduan Rujukan Pantas (Cheat Sheet & README)

Enjin carian web bebas, ringan, dan berkuasa tinggi yang dioptimumkan untuk pelayan RAM rendah (2GB) dan integrasi awan (Cloudflare, Google AdSense, Microsoft Ads).

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
   - **Selepas siap:** isi `CF_TUNNEL_TOKEN` (+ `CLOUDFLARE_API_TOKEN` untuk www/edge) dalam `/opt/tukuk-os/.env`, lalu `sudo bash scripts/setup-all.sh` sekali lagi (idempotent) untuk hidupkan tunnel & edge.

1. **Quick Install pada Ubuntu Server sedia ada (`192.168.8.100`):**
   ```bash
   sudo ./deploy/quick-install.sh
   ```
2. **Sambungkan ke Cloudflare (`tukuk.org`):**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create tukuk-tunnel
   cloudflared tunnel route dns tukuk-tunnel tukuk.org
   cloudflared tunnel run --url http://localhost:3000 tukuk-tunnel
   ```

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

## 🔮 9. Pelan Masa Depan (Future Roadmap)
- **1 Hari 1 App:** Tambah modul/aplikasi web baharu secara berterusan.
- **Unity Cloud Games:** Integrasi permainan WebGL Unity ke dalam tab permainan Tukuk-OS.
- **Kaggle CLI:** Gunakan Kaggle CLI untuk memproses data/latihan AI berat jika RAM laptop terbatas.
