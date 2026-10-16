SLUG: kisah-satu-kata
TITLE: Kisah Satu Kata — Satu Kata Sehari Jadi Satu Apl dan Satu Game
EXCERPT: Bagaimana sebuah cron harian mengambil satu patah kata — hujan, kopi, roket — dan menyulapnya menjadi aplikasi serta game yang boleh dimainkan, tanpa satu baris kod ditulis manusia.
TAGS: satu-kata, apps, game, automasi, ci

## idea: satu kata, dua benda

**Satu Kata** ialah eksperimen paling unik dalam Tukuk-OS: setiap hari, sebuah kerja automatik (cron) memilih **satu patah kata** — `hujan`, `kopi`, `buku`, `roket`, `ikan`, `awan`, `bunga` — dan daripada kata itu dijana **dua perkara**: sebuah **aplikasi mini** dan sebuah **game mini**. Jadi kata `kopi ☕` menjadi pengira kafein; `roket 🚀` menjadi tangkap-bahan-api-capai-orbit. Tiada yang menulis kod untuk setiap satu — semuanya lahir dari satu skrip penjana.

## tanpa build step

Falsafahnya: *"semudah membuat aplikasi, tapi tanpa pusingan bina"*. Setiap keluaran hanyalah **satu fail HTML tunggal** — aplikasi menggunakan Preact+htm, game menggunakan Phaser. Kerana ia fail statik, ia boleh dihantar terus ke tepi (edge) dan **hampir tak membebankan pelayan**: kos pada VPS sangat ringan, kira-kira 0 minit untuk CI menjalankannya.

## setiap kata dapat personaliti sendiri

Yang cantik: tema, warna, dan genre **dipilih secara deterministik** daripada hash kata itu. Enam palette (solar, mint, hijau, mawar, ungu, karat) dan empat genre (catch, tap, memory, runner) bermakna `durian` sentiasa dapat rupa yang sama setiap kali, tapi `cili` berbeza. Konsisten tapi pelbagai — tanpa perlu seorang pereka pun.

## masuk ke gedung apl

Setiap pasangan Satu Kata muncul di `tukuk.org/store` (sumber "satu-kata") dengan dua kad: **App «kata»** dan **Game «kata»**. Dan seperti semua apl di sini, setiap satunya boleh dimuat turun sebagai **APK Android yang ditandatangani Tukuk** — jadi kata hari ini boleh jadi aplikasi di poket anda esok. Hubnya di `tukuk.org/satu-kata`. Satu kata, satu hari, satu dunia kecil.
