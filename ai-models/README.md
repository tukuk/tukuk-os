# AI Models untuk Tukuk-OS

Folder ini menyimpan model AI untuk chat dan brain Tukuk-OS.

## Model yang Digunakan

Tukuk-OS mempunyai **dua lapis otak**. Lantai utama = **cloud** (API percuma,
laju). Lantai sandaran = **Ollama** tempatan (offline, CPU). Urutan pemilihan
automatik (`src/brain/provider.js` → `activeBackend()`):

`cloud (kunci dijumpai)` → `Ollama (boleh dicapai)` → `tiada LLM (ekstraktif sahaja)`

> Server Tukuk-OS adalah CPU-only (AMD Kaveri, tiada AVX2/GPU). LLM lokal
> berjalan tetapi **lambat & lemah**. Sebab itu cloud ialah otak utama; Ollama
> hanya sandaran apabila internet/kunci awan tiada. Ini juga yang dipakai
> agen **Tukuk Code** (alat MCP `tukuk_agent`) — tanpa LLM ia tetap keluarkan
> templat berfungsi, dengan LLM ia perkasa rancangan & kod.

### Aktifkan cloud (paling ringan — disyorkan)

1. Dapat kunci **percuma** (pilih satu):
   - Groq (pantas): https://console.groq.com/keys → `GROQ_API_KEY`
   - Google Gemini: https://aistudio.google.com/apikey → `GEMINI_API_KEY`
   - OpenAI (berbayar): `OPENAI_API_KEY`
2. Tambah ke `.env` di server (`/opt/tukuk-os/.env`) — **tiada `BRAIN_PROVIDER`
   diperlukan**, pengesanan automatik akan pilih cloud apabila kunci ada:
   ```env
   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
   # atau GEMINI_API_KEY=AIza...
   ```
3. Restart servis: `sudo systemctl restart tukuk-os`
4. Sahkan: `curl -s localhost:3000/brain` → `online:true, cloud:true, provider:groq`.

Alternatif tanpa restart: panel admin (`/admin`) → tetapkan pembekal & kunci
(disimpan sebagai setting `aiProvider`/`aiApiKey`/`aiModel` dan didahulukan
berbanding env).

### Sandaran Ollama (offline)

Apabila **tiada** kunci cloud (atau `aiProvider=ollama`), Tukuk-OS jatuh ke
Ollama tempatan. Install sendiri (skrip ini memuat turun perisian, jadi jalankan
manual):

```bash
bash ai-models/setup-ollama.sh   # install Ollama + pull model di bawah
```

Tukuk-OS menjalankan model AI secara tempatan melalui Ollama.

### Model Default (Free Tier)

| Model | Saiz | Keterangan |
|---|---|---|
| `smollm:135m` | ~135MB | Model paling ringan, cepat untuk chat |
| `qwen2.5-coder:0.5b` | ~500MB | Model coding, lebih pintar |

### Chain Model

Tukuk-OS menggunakan **chain fallback**:
1. Cuba `smollm:135m` dahulu (pantas)
2. Jika gagal, fallback ke `qwen2.5-coder:0.5b` (lebih pintar)

## Setup

### 1. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull Model

```bash
ollama pull smollm:135m
ollama pull qwen2.5-coder:0.5b
```

### 3. Test Model

```bash
ollama run smollm:135m "Hello, how are you?"
```

### 4. Start Ollama Service

```bash
sudo systemctl enable --now ollama
```

## Konfigurasi

Edit `.env`:

```env
BRAIN_ENABLED=true
LLM_CHAIN=smollm:135m,qwen2.5-coder:0.5b
LLM_TIMEOUT=120000
OLLAMA_HOST=http://127.0.0.1:11434
```

## Model Lain yang Bisa Digunakan (Free Tier)

| Model | Saiz | Keterangan |
|---|---|---|
| `tinyllama:1.1b` | ~1GB | Model all-rounder |
| `phi3:mini` | ~2GB | Microsoft, sangat pintar |
| `gemma:2b` | ~1.5GB | Google, multilingual |
| `llama3.2:1b` | ~1GB | Meta, baru |

## Catatan

- Model **100MB** tepat adalah `smollm:135m` (~135MB)
- Model ini **free**, tidak perlukan API key
- Jalankan di server tempatan (localhost:11434)
- GPU tidak diperlukan, CPU cukup

## 🧠 AI Data Center & Model Milik Sendiri (Tukuk-Brain Mini)

Papan inventori semua AI server: **https://tukuk.org/models** (JSON: `/api/models`).

Selain LLM orang (Ollama/cloud), Tukuk-OS kini punya **model AI sendiri** yang
DILATIH DI SERVER INI pada CPU sahaja:

- **Apa**: `Tukuk-Brain Mini` — multinomial logistic regression (softmax) ke atas
  ciri hashed (unigram + bigram + trigram aksara, 8192 bucket). Fail:
  `src/brain/minimodel.js`. Muat serta-merta, inferens ~0.1ms CPU.
- **Untuk apa**: pengelasan NIAT soalan (math/code/compare/list/howto/define/general).
  Regex `taskrouter` ialah guru berketepatan tinggi; model mengisi CELAH: frasa
  santai yang regex terlepas ("makna kata berlapang dada" → define) dengan
  gate keyakinan (p≥0.5, margin≥0.2) — bila ragu ia diam, tiada kerosakan.
- **Latih semula** (guna data produksi server — makin banyak soalan, makin pintar):
  ```bash
  node scripts/train-brain.js            # default: tri=60 l2=0.003 epochs=200
  sudo systemctl restart tukuk-os        # muat model baru
  ```
  Output `data/tukuk-brain-v1.json` (gitignore — artifak milik server).
  Ada `--epochs --lr --l2 --tri --seed` untuk talaan.
- **Realiti lokal-first**: `BRAIN_LOCAL_FIRST=1` → Ollama qwen2.5:1.5b otak
  utama (±45s/soalan baru, cache 10 min), cloud hanya kecemasan.

Kenapa tidak LLM dari-sifar? Latih 1B+ parameter pada CPU AMD Kaveri (tiada
AVX2) ambil BERBULAN. Softmax di atas data sendiri pula: detik sahaja, dan
untuk lapisan ROUTING ia benar-benar lebih baik daripada regex statik.
"Sangat pintar" pada CPU = pembahagian tugas: LLM kecil + router neural
milik sendiri + RAG berlandaskan sumber + kalkulator deterministik.

## ⚡ Pengiraan kelajuan sebenar CPU (RX-427BB / Kaveri)

Ukur pada server (prompt RAG 1600 aksara, 80 token keluar):

| Model | Kelajuan | Nota |
|---|---|---|
| `qwen2.5-coder:0.5b` | **~10 tok/s → ±20-24s** | OTAK UTAMA sekarang (rantai kepala) |
| `qwen2.5:1.5b` | ~4 tok/s → ±46s | fallback pandai; kerap langgar timeout |
| `smollm:135m` | ~30 tok/s → ±8s | laju tapi kerap echo → dibuang gate isEcho |

Perkara yang TIDAK boleh "di-unlock": AVX2 bukan pada silikon Kaveri
(Steamroller = AVX1 + FMA4 + XOP sahaja) — tiada microcode/BIOS boleh
cipta arahan yang tiada. Yang BOLEH dan SUDAH dimatikan:

- Ollama AUTOMATIK memilih `libggml-cpu-piledriver.so` (kernel AVX1+FMA4
  khas AMD) — disahkan dalam journal: `loaded CPU backend ... piledriver`.
- `OLLAMA_KEEP_ALIVE=30m` (dahulunya 1m → model diagkut balik +3.2s setiap
  soalan). Jangan kecilkan nilai ini.
- `CPUQuota=400%` (dahulunya 300% — 1 teras terkurung).
- Vulkan iGPU R7 (gfx704) TIDAK digunakan: ggml-vulkan perlukan ciri
  16-bit/GCN≥ gfx8 dan memori iGPU berkongsi DDR — cubaan gagal; CPU lebih
  pantas untuk model ≤1.5B pada cip ini.
- Naik taraf sebenar satu-satunya "AVX2 unlock" = cip Ryzen/Cannonlake+.

Keputusan gabungan: /ask cache-cold ±20s, warm ±11s (dahulunya 43-47s).

## 🏢 Data Center Bersatu — semua aplikasi + AI dalam satu tubuh

`/datacenter` (papan pemuka langsung) + `/api/datacenter` (JSON telemetri:
CPU/RAM/beban/model/aktiviti/katalog) + `src/brain/approuter.js` (32 permukaan
aplikasi boleh-dirout). Setiap `/ask` kini mengembalikan `apps: [...]` —
cadangan aplikasi server yang boleh menindaklanjuti soalan ("convert song to
mp3" → /converter). Uji terus: `GET /api/apps/route?q=buang+latar+belakang+gambar`.
Ini gabungan otak ↔ organ: LLM menjawab, app router menghantar ke alat yang betul.
