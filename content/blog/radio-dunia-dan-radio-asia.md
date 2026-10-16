SLUG: radio-dunia-dan-radio-asia
TITLE: Radio Dalam Pelayar — Kini Dengan Laluan Pantas 🌏 Asia
EXCERPT: Tukuk-OS ada radio & muzik strim langsung tanpa akaun dan tanpa iklan. Terbaru: satu sentuhan untuk stesen Asia — Malaysia, Indonesia, dan seluruh benua.
TAGS: radio, asia, media, streaming, malaysia

## Radio yang menyambung di mana-mana halaman

Tukuk-OS sudah lama punya mod **Radio** dan **Muzik** pada halaman carian — dengar stesen radio seluruh dunia terus dalam pelayar. Keunikannya: apabila anda dengar radio sambil melompat ke halaman lain (cari, apl, blog), siaran **sambung bermain** menerusi bar pemain global. Ia juga **anti-terputus**: stream langsung yang terganggau akan cuba sambung semula automatik, bukan berhenti. Semua ini tanpa perlu daftar, tanpa kunci API, dan tanpa iklan menyelit.

Sumber stesen ialah **Radio Browser** — satu pangkalan data komuniti dengan puluhan ribu stesen, disaring supaya hanya strim **HTTPS** yang paparkan (strim HTTP akan disekat pelayar pada laman selamat).

## Masalah: "tiada radio Asia"

Antara maklum balas pertama kami: bila buka Radio, senarai teratas didominasi stesen Barat — BBC, Jazz Perancis, Klasik Amerika. Stesen Asia memang *ada*, tetapi terkubur dalam dropdown "Semua negara" yang panjang. Cari stesen Malaysia bermaksud skrol beratus nama negara. Itu bukan salah kataloqnya, cuma cara pelayaran yang tak mesra rantau kita.

## Penyelesaian: kawasan pantas

Kami tambah bar **Kawasan** pada pelayaran radio. Sekarang ada butang:

- **🌏 Asia** — gabungan stesen teratas dari seluruh benua (MY, ID, TH, PH, SG, VN, IN, JP, KR, dan banyak lagi).
- **Asia Tenggara**, **Asia Timur**, **Asia Selatan** — susun ikut sub-rantau.
- **🕌 Timur Tengah** — sebagai bonus.

Di belakang tabir, setiap kawasan ialah satu senarai kod negara ISO yang dihantar sebagai param `countrycode` berpisahkan koma kepada Radio Browser, diurut ikut jumlah klik (paling popular dahulu). Pilih **🌏 Asia**, dan skrin serta-merta dipenuhi stesen serantau — tanpa perlu skrol dropdown lagi.

## Stesen Asia sebagai jaminan

Kalau Radio Browser sesekali tak dapat dihubungi, senarai simpanan (*fallback*) kami kini turut menyenaraikan stesen Malaysia & Indonesia, jadi ada sahaja radio Asia yang boleh dimainkan walaupun sumber luar bermasalah. Cuba `tukuk.org/cari?mode=radio` dan tekan **🌏 Asia** — dengar sendiri. Radio rantau kita kini ada tempatnya di Tukuk.
