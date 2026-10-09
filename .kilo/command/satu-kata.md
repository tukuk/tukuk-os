---
name: satu-kata
description: Jana SATU app + SATU game daripada SATU kata, dan siarkan ke Cloudflare Pages (CI percuma, VPS tak dibebani)
usage: kilo satu-kata [kata] [--unity] [--dry]
---

# Satu Kata — app & game daripada satu kata

Ubah **satu kata** menjadi **satu web-app + satu web-game** yang siap deploy,
"semudah membuat aplikasi React & Flutter" tetapi **tanpa build step** (keluaran
ialah HTML tunggal: Preact+htm untuk app, Phaser untuk game). Semua dijana oleh
CI percuma supaya pelayan (VPS) **tidak pernah** menjalankan pembinaan.

## Penggunaan

```bash
# Jana tempatan (pilih kata seterusnya ikut manifest) — untuk uji sahaja
node scripts/satu-kata/generate.mjs --dry

# Jana satu kata tertentu (+ scaffold Unity opt-in)
node scripts/satu-kata/generate.mjs hujan --unity

# Auto-pilih kata berikutnya yang belum guna & tulis ke generated/
node scripts/satu-kata/generate.mjs
```

## Cara kerja (satu kata → semua jadi satu)

1. `generate.mjs` ambil kata: `argv[2]` > `SATU_KATA_WORD` > kata pertama dalam
   `scripts/satu-kata/words.txt` yang belum ada di `generated/manifest.json`.
2. Tema (palette + genre) **deterministik** daripada hash slug — kata yang sama
   sentiasa menghasilkan rupa yang sama.
3. Tulis `generated/public/<slug>/app/index.html` + `.../game/index.html`
   (+ `.../unity/GameMain.cs` jika `--unity`), kemas kini `manifest.json`, dan
   jana semula **hub** `generated/public/index.html` (semua hasil dalam satu laman).

## CI/CD (percuma, bukan di VPS)

| Peranan | Sumber | Catatan |
|--------|--------|---------|
| Otak / cron harian | **GitHub Actions** (`.github/workflows/satu-kata.yml`) | `schedule` 03:15 MYT + `workflow_dispatch`; runner percuma. |
| Deploy + hosting | **Cloudflare Pages** (`tukuk-satu-kata`) | Free; satu projek hub, setiap kata = `/<slug>/app` & `/<slug>/game`. |
| API/edge (jika perlu) | **Cloudflare Workers** | Sudah ada infra di repo (`worker/`, `wrangler.toml`). |
| Mirror mingguan | **GitLab CI** (`.gitlab-ci.yml`) | Terhad ~400 minit/bulan → schedule-only, tak ubah state GitHub. |
| Engine game "serius" | **Unity Cloud** (opt-in manual) | Tak sesuai auto-harian pada CI percuma → sebab itu default ialah web. |

### Setup sekali sahaja (di GitHub)

1. **Settings → Secrets → Actions** → tambah:
   - `CLOUDFLARE_API_TOKEN` (token dengan keizinan Workers/Pages — anda sudah punya dalam `.env`)
   - `CLOUDFLARE_ACCOUNT_ID` = `391d9aa59cfcc5ec44c3d25c855c45cb`
2. **Settings → Actions → General → Workflow permissions** → **Read and write**
   (supaya Actions boleh `git push` manifest semula untuk kata esok).
3. Cron jalan sendiri; atau tekan **Run workflow** dan isi `word` untuk jana ad-hoc.

## Fail berkaitan

- `scripts/satu-kata/generate.mjs` — penjana (tiada dependensi luar, Node stdlib sahaja).
- `scripts/satu-kata/templates/{app,game,hub}.html`, `unity-GameMain.cs.tpl` — templat.
- `scripts/satu-kata/words.txt` — senarai kata (tambah baris anda sendiri: `kata | emoji | tagline`).
- `generated/` — keluaran (di-commit; `manifest.json` = keadaan "kata mana sudah guna").

## Tips & batasan

- **Editor kata**: sunting `words.txt` — baris baru akan digunakan oleh cron kemudian.
- **Perkayaan AI (opsional)**: bila dijalankan DI SERVER (ada `src/brain`/Ollama) anda boleh
  sambungkan tagline/nama genre kepada LLM; di CI percuma ia kekal deterministik (tiada model).
- **Reboot VPS tidak menjejaskan** ini — semua berjalan di runner GitHub, bukan systemd di VPS.
- **Jangan tambah trigger `push`** pada workflow GitHub — ia akan menyebabkan gelung (CI push → CI lagi).
