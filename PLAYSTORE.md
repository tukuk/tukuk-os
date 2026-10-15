# 📱 Menghantar T Chat ke Google Play — Runbook

Dokumen ini menjelaskan **apa yang sudah disiapkan dalam repo** dan **langkah
manual yang hanya anda (pemilik akaun) boleh buat**. Publishing ke Play Store
TIDAK boleh dilakukan sepenuhnya secara automatik: ia memerlukan **akaun
Developer Google Play (bayaran USD 25 sekali)**, **verifikasi identiti**, dan
**borang di Play Console** yang mesti diisi manusia. Semua kerja teknikal
artefak + salinan stor sudah diuruskan di sini supaya anda tinggal hantar.

---

## ✅ Sudah siap (dalam repo)

| Perkara | Fail | Nota |
|---|---|---|
| Manifest patuh Play | `apk/app/AndroidManifest.xml` | `package=org.tukuk.chat`, `versionCode=2`, `versionName=1.0.0`, **`targetSdk=36`** (Android 16 — diwajibkan untuk apl baru mulai 31 Ogos 2026) |
| Build APK + **AAB** | `scripts/build-apk.sh` | APK untuk muat turun langsung; **`.aab` untuk Play** dijana bila `bundletool` ada (kalau tiada, skrip cetak arahan pasang) |
| Salinan stor (EN + MS) | `fastlane/metadata/android/{en-US,ms}/*` | title (≤30), short desc (≤80), full desc (≤4000), keywords, changelog `2.txt` |
| Automasi upload | `fastlane/{Appfile,Fastfile}` | `fastlane android upload` (pilihan) jika anda letak `google-cloud-key.json` |
| Aset gambar stor | `fastlane/metadata/android/{en-US,ms}/images/` | ✅ **ikon 512, feature graphic 1024×500, 4 skrin telefon 1080×1920** sudah dijana & diletak |
| Polisi privasi (wajib) | https://tukuk.org/privacy | sudah live — letak URL ini di Console |

Kunci signing **upload key** sedia ada: `apk/tukuk-chat-release.jks`
(git-ignored, kata laluan di `apk/keystore.env`). Ini yang digunakan utk
*Play App Signing* di bawah.

---

## 🔐 Pagar yang HANYA anda boleh buka (akun & identiti)

Ini tidak boleh dilakukan dari kod/saya — perlu tindakan anda:

1. **Akaun Developer Play** — https://play.google.com/console → daftar, bayar
   **USD 25 sekali**, verifikasi identiti (ID/kad + alamat). Peribadi atau
   organisasi (organisasi perlukan kunci D-U-N-S).
2. **Borang di Console** (sekali setiap apl): kategori, e-mel & laman
   hubungan, **penilaian kandungan** (IARD), **keselamatan data** (data safety),
   dasar privasi, negara sasaran, harga. Semuanya borang web — saya tak boleh
   isi untuk anda.
3. **Muat naik AAB** ke Console (seret-lepas) ATAU via `fastlane supply`
   dengan *service account key* yang anda cipta.

---

## 🧭 Langkah penuh (manual Console — disyorkan untuk rilis pertama)

### A. Jana AAB
```bash
# pasang bundletool SEKALI (bukan sebahagian repo; muat dari GitHub rasmi)
curl -L -o bundletool.jar \
  https://github.com/google/bundletool/releases/latest/download/bundletool-all.jar
bash scripts/build-apk.sh          # → public/downloads/tukuk-chat.aab (+ .apk)
```
Tiada `bundletool`? Alternatif paling selamat: **Android Studio** →
`File > Open` folder `apk/` (ia punya `app/` module) → **Build > Generate
Signed App Bundle (.aab)** > ikat `tukuk-chat-release.jks` (alias `tukuk-chat`)
> keluaran `app-release.aab`.

### B. Play App Signing (sekali)
Console → *App signing* → **Opt in to Play App Signing**. Google pegang kunci
signing sebenar; anda unggah **upload key** = `tukuk-chat-release.jks`. Simpan
kunci ini di tempat selamat — jika hilang & Google tak boleh pulih, anda tak
boleh kemas kini apl.

### C. Cipta apl & isi stor
1. *Create app* → nama **T Chat**, bahasa **English (US)** (+ **Malay**
   selepas itu), kategori **Communication**, Free.
2. *Store presence > Main store listing* → tampal **title / short / full** dari
   `fastlane/metadata/android/en-US/` (dan `ms/` untuk Bahasa Melayu). Muat naik
   ikon 512, **feature graphic**, dan ≥2 **skrin telefon** (lihat
   images-README.md).
3. *Store presence > Content rating* → isi soal selidik (apah ada mesej
   pengguna / chat → akan ditanda sesuai umur). *Data safety* → nyatakan:
   aplikasi mengumpul **nama, mesej, media** untuk fungsi sembang; **enkripsi
   in-transit**; **tiada** pengiklanan/penjejakan; pengguna boleh **padam akaun**
   dari dalam apl (sokong `DELETE /api/chat/delete-account`).
4. *Policy > App details* → letak **https://tukuk.org/privacy** sebagai dasar
   privasi, + e-mel/laman hubungan.

### D. Rilis (beta dulu — ikut arahan anda)
- Mulakan di **Testing > Internal testing**: naik taraf AAB, tambah e-mel tester,
  *Publish*. Uji Install dari pautan internal pada ≥12 tester / ≥14 hari
  (syarat untuk mohon lulus ke *Closed testing* → akhirnya *Production*).
- Belum **Production** selagi anda belum mengarahkan — selaras dasar
  "APK/Play = beta dulu, stabil menyusul".

### E. Kemas kini seterusnya
Naikkan `versionCode` (→3) di `AndroidManifest.xml`, bina AAB baru, naik taraf
di Console. `versionName` bebas.

---

## 🤘 Automasi upload (pilihan, kalau anda suka CLI)
1. Sediakan **service account** di Google Cloud → buka akses *Google Play
   Android Developer API* → muat turun JSON → simpan sebagai
   `google-cloud-key.json` (sudah di-`gitignore`, **jangan commit**).
2. `gem install fastlane` (atau `bundle install` bila Gemfile ditambah).
3. `fastlane android upload` → `supply` hantar AAB + metadata ke track internal
   sebagai **draft**.

---

## ⚠️ Realiti WebView + Play
- Aplikasi ini **pembungkus WebView** ke `https://tukuk.org/apps/chat`. Play
  kadang menolak pembungkus yang "hanya load laman web". Mitigasi kita: fungsi
  PWA luar-talian, kebenaran kamera/mikrofon untuk panggilan WebRTC (ciri
  native sebenar), dan peti keluar luar-talian — hujah "nilai lebih daripada
  laman web" pada borang semakan. Elak guna nama/brand pihak ketiga pada skrin Stor.
- `targetSdk=36` + `minSdk=23` sudah diset; `usesCleartextTraffic=false` (HTTPS
  sahaja) — baik untuk keselamatan & penilaian automatik.

---

**Ringkas:** artefak + semua teks sudah dalam repo & lulus semakan. Yang tinggal
ialah akaun Developer (bayaran + identiti) dan mengisi borang Console — kedua
duanya melekat pada akaun anda secara sah, jadi tidak boleh dilakukan dari kod.
