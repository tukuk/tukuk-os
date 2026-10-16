SLUG: tukuk-jadi-gedung-aplikasi
TITLE: Tukuk-OS Jadi Gedung Aplikasi Sendiri — Gaya APKPure
EXCERPT: Setiap apl di Tukuk-OS kini boleh dimuat turun sebagai APK Android yang ditandatangani, terus dari pelayan — tanpa Google Play, tanpa store pihak ketiga.
TAGS: tukuk, apk, app-store, android, pwa

## Kenapa gedung aplikasi sendiri?

Kebanyakan orang tahu APKPure atau F-Droid sebagai tempat muat turun apl Android yang tak ada di Google Play. Idea kami serupa, tetapi untuk ekosistem Tukuk: **kenapa hantar pengguna ke tempat lain**, sedangkan tukuk.org sendiri boleh jadi gedungnya? Jadi kami bina satu halaman `/store` yang memaparkan semua aplikasi Tukuk — bawaan, arked, Satu Kata, dan sumbangan komuniti — setiap satu dengan butang **Install**, **⬇ APK**, dan lencana **🔒 Ditandatangani Tukuk**.

## APK dijana atas permintaan

Ini bahagian paling menarik: bukan kami bina 15 APK siap dan simpan kaku. Pelayan **membina APK secara atas-permintaan**. Bila anda tekan ⬇ APK pada mana-mana kad, `/api/apk/:id` akan:

1. Kenal pasti item dari katalog gedung (hanya id yang sah — ini sempadan keselamatan supaya tiada URL luar boleh diseludup).
2. Pangkahuluan alat bina Android yang memang terpasang pada pelayan: `aapt2` untuk kompil & paut sumber, `javac` untuk kod Java pembungkus WebView, `d8` untuk tukar `.class` kepada `dex`, kemudian `zip`, `zipalign`, dan `apksigner`.
3. Simpan hasilnya di `public/downloads/tukuk-<slug>.apk`. Kalau sudah ada, ia dilayan serta-merta (~0.5 saat); kalau belum, ia dibina (~5–8 saat).

Apl pembungkus itu sendiri hanya satu `WebView` yang membuka URL hidup di tukuk.org. Ini bermakna **isi apl boleh dikemas kini lewat web tanpa anda perlu muat turun APK baharu** — versi APK kekal, kandungan di belakangnya sentiasa segar.

## Satu kunci, satu identiti

Semua APK ditandatangani dengan **satu keystore Tukuk yang sama**. Kepentingannya: apabila anda naik taraf, Android mengecam kunci yang sama dan membenarkan pemasangan di atas versi lama (kemas kini setempat, bukan buang-pasang-semula). Identiti penerbit yang konsisten juga membina kepercayaan. Yang perlu difahami: ini tanda tangan **swa-tandatangan** — sah untuk pemasangan terus, tetapi bukan "diverifikasi Google" (itu hanya datang menerusi Play Store).

## PWA pula untuk iPhone

APK hanya untuk Android. Untuk iPhone/iPad, setiap apl turut menyokong **Pemasangan PWA** (Progressive Web App) — anda boleh "Add to Home Screen" dan ia dibuka seperti apl asal dengan ikon sendiri. Justeru setiap apl kami ada dua pintu pasang: **APK untuk Android, PWA untuk semua**. Gedung ini kini hidup di `https://tukuk.org/store` — Cuba tekan ⬇ APK pada mana-mana apl dan lihat sendiri ia dibina depan mata anda.
