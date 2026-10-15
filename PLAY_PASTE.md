# PLAY_PASTE.md — Pakej Tinggal-Tampal Rilis Google Play (T Chat)

> Satu fail untuk semua teks & jawapan borang Play Console. Buka ini di satu
> tetingkap, Play Console di tetingkap lain, salin-tampal. Jangan simpan/commit
> sebarang kunci rahsia di sini.

Apl: **T Chat** · Pakej: **`org.tukuk.chat`** · Versi: **2 (1.0.0)** · `targetSdk 36`
AAB: `public/downloads/tukuk-chat.aab` (sah — lulus `bundletool validate` + `build-apks`)
Polisi privasi (wajib): **https://tukuk.org/privacy**

---

## 1) Senarai gedung — English (US)  *(bahasa lalai)*

**Tajuk apl (≤30)**
```
T Chat – Messenger & Calls
```

**Deskripsi pendek (≤80)**
```
Real messenger with video & voice calls, status, stories and works even on 2G.
```

**Deskripsi penuh (≤4000)**
```
T Chat is a real, multi-user messenger that runs fast on any connection — from fibre to a single bar of 2G.

WHAT YOU CAN DO
• Chat one-on-one, in groups, and in public rooms.
• Send text, photos, videos, voice messages and any file. Images are compressed on your device before upload so they send quickly.
• Video & voice calls, peer-to-peer over WebRTC, with caller identification (TukuCaller) that shows who is calling before you answer.
• Status — post a short emoji + text mood that expires on its own (30 minutes up to 7 days).
• Stories that last 24 hours, and a social feed with posts, reactions, reposts and comments.
• Reactions, replies, forwarding, message editing, in-chat search, read receipts and typing indicators.
• Friends list, blocking, and a permanent numeric Tukuk ID so contacts survive name changes.
• Big emoji stickers, polls, wallpapers, sounds and notification badges.

BUILT FOR SLOW NETWORKS
• Data-saver mode for 2G/3G/GPRS — no streaming, media loads only when you tap.
• Offline outbox: queued messages are resent automatically when you reconnect.
• Works as an installed app (PWA) with the session kept locally.

PRIVACY
Sign up with just a name and password — no phone number required. Your session uses a bearer token stored on your device, not cookies. You can delete your entire account and all its data from inside the app at any time.

This is the official T Chat companion app from tukuk.org. Feedback and questions are welcome via the contact page on tukuk.org.
```

**Catatan rilis (apa yang baru)**
```
First release on Google Play.
• DM, group and public-room messenger.
• WebRTC video/voice calls with TukuCaller caller ID.
• Status (mood) with TTL, 24-hour stories, social feed.
• 2G/3G data-saver mode + offline outbox.
• Target API 36 (Android 16), required for Play listing.
```

---

## 2) Senarai gedung — Malay (ms)  *(tambah bahasa selepas EN)*

**Tajuk apl (≤30)**
```
T Chat – Sembang & Panggilan
```

**Deskripsi pendek (≤80)**
```
Meshenjer sebenar: panggilan video & suara, status, cerita, kekal laju di 2G.
```

**Deskripsi penuh (≤4000)**
```
T Chat ialah meshenjer sebenar berbilang pengguna yang laju pada mana-mana rangkaian — daripada fibre sehingga satu bar 2G.

APA YANG ANDA BOLEH BUAT
• Bersembang dua hala, berkumpulan dan dalam bilik umum.
• Hantar teks, gambar, video, mesej suara dan apa-apa fail. Gambar dimampat pada peranti sebelum dimuat naik supaya lebih laju.
• Panggilan video & suara secara P2P (WebRTC) dengan pengenalan pemanggil (TukuCaller) yang memaparkan siapa pemanggil sebelum anda jawab.
• Status — siarkan emoji + teks ringkas yang luput sendiri (30 minit sehingga 7 hari).
• Cerita yang bertahan 24 jam, dan suapan sosial dengan post, reaksi, repost dan komen.
• Reaksi, balasan, terusan, edit mesej, carian dalam sembang, baca-selesai dan penunjuk taip.
• Senarai kawan, sekat, dan Tukuk ID numerik kekal supaya kontak tidak hilang walau nama bertukar.
• Stiker emoji besar, undian, wallpaper, bunyi dan lencana notifikasi.

DIBINA UNTUK RANGKAIAN LEMBAB
• Mod jimat data untuk 2G/3G/GPRS — tiada penstriman, media dimuat hanya bila anda ketuk.
• Peti keluar luar-talian: mesej beratur dihantar semula secara automatik sebaik sambung semula.
• Berfungsi sebagai aplikasi pasang (PWA) dengan sesi disimpan setempat.

PRIVASI
Daftar cukup dengan nama dan kata laluan — tiada nombor telefon diperlukan. Sesi anda menggunakan token pembawa yang disimpan pada peranti, bukan cookie. Anda boleh padam seluruh akaun dan semua datanya dari dalam aplikasi pada bila-bila masa.

Ini aplikasi rasmi T Chat daripada tukuk.org. Maklum balas dan soalan dialu-alukan melalui halaman hubungan di tukuk.org.
```

**Catatan rilis**
```
Rilis pertama di Google Play.
• Meshenjer DM, kumpulan dan bilik umum.
• Panggilan video/suara WebRTC dengan ID pemanggil TukuCaller.
• Status (mood) dengan TTL, cerita 24 jam, suapan sosial.
• Mod jimat data 2G/3G + peti keluar luar-talian.
• API sasaran 36 (Android 16), diwajibkan untuk penyenaraian Play.
```

---

## 3) Grafik (muat naik fail ini)

| Slot Play | Fail |
|---|---|
| Ikon apl (512×512) | `fastlane/metadata/android/en-US/images/icon/512.png` |
| Feature graphic (1024×500) | `fastlane/metadata/android/en-US/images/featureGraphic/feature.png` |
| Skrin telefon (≥2) | `fastlane/metadata/android/en-US/images/phoneScreenshots/screenshot-1.png` … `screenshot-4.png` |

(Salin set yang sama untuk `ms/` jika menambah bahasa Melayu pada senarai gedung.)

---

## 4) Borang Keselamatan Data (Data safety) — jawapan tepat

- **Kumpul / kongsi data pengguna?** → *Kumpul* (perlu untuk fungsi). *Kongsi dengan pihak ketiga?* → **Tidak**.
- **Jenis data DIKUMPUL:**
  - Nama akaun (Account name) — ya
  - Mesej pengguna / kandungan dijana pengguna (User-generated content: chat, post, story, comment) — ya
  - Foto & Video — ya
  - Audio (mesej suara) — ya
  - Fail (dokumen yang dikongsi) — ya
  - ID Tukuk (pengenal numerik kekal) — ya
- **Jenis data TIDAK dikumpul:** nombor telefon, e-mel, lokasi, kenalan, ID peranti/iklan, riwayat pelayaran.
- **Tujuan pengumpulan:** *App functionality* sahaja. **Bukan** iklan, analitik, atau penjejakan.
- **Disulitkan semasa penghantaran?** → **Ya** (HTTPS/TLS).
- **Boleh pengguna meminta pemadaman data?** → **Ya** — padam akaun penuh + semua data dari dalam apl (⚙️ → Padam akaun).
- **Data dipadam selepas penghentian perkhidmatan?** → Ya (akaun & data dibuang sebaik padam).

## 5) Penilaian Kandungan (IARD) — panduan

Aplikasi membolehkan **pengguna berkongsi kandungan yang dilihat pengguna lain** (mesej, gambar, video, post, cerita). Jawab jujur "Yes" pada soalan kandungan-jana-pengguna. Tiada keganasan grafik, seksual, dadah, atau perjudian → biasanya terbit **Everyone**. Play mungkin minta **mekanisme lapor/sekat** — kita sudah ada **sekat (block)** + **padam** dari dalam apl.

## 6) Butiran apl (App details / policy)

- **Kategori:** Communication
- **Terjemahan:** tambah English (US) + Malay
- **Dasar privasi:** https://tukuk.org/privacy
- **E-mel / laman hubungan:** guna akaun pembangun anda

---

## 7) Senarai semak klik-demi-klik sampai RILIS

### A. Selesaikan persediaan apl (WAJIB sebelum mana-mana track)
1. **Kandungan stor → Main store listing** → tampal §1 (EN), tambah bahasa → §2 (BM), muat naik §3.
2. **Penilaian kandungan** → isi IARD (§5) → hantar → tunggu keputusan.
3. **Keselamatan data** → isi §4 → simpan.
4. **Kebenaran / App details** → kategori Communication + dasar privasi §6.

### B. Ujian DALAMAN (boleh hari ini — pasang di telefon sendiri)
5. **Uji & terbitkan → Ujian dalaman → Cipta keluaran** → seret `public/downloads/tukuk-chat.aab` → tinjau & **Mulakan rilis**.
6. **Orang yang mempunyai akses** → *Kumpulan penguji* tambah e-mel Google anda sendiri → salin **pautan/QR** → buka pada telefon → **Pasang**. Inilah ujian lancar sebenar pertama (Play jalankan bundletool yang sama kita uji).
7. **Play App Signing**: jika diminta, opt-in — gunakan `apk/tukuk-chat-release.jks` (alias `tukuk-chat`) sebagai **upload key**. Google pegang signing key sebenar.

### C. Ujian TERTUTUP (syarat wajib untuk Production)
8. **Ujian tertutup → Cipta keluaran** → naik taraf AAB yang sama.
9. Kumpul **≥12 penguji unik** yang **aktif ≥14 hari berturut-turut** (ini pemasa — tak boleh dipintas; hantar pautan ke kawan/keluarga/pengguna tukuk.org).

### D. PENERBITAN (Production)
10. Selepas kriteria closed terpenuhi → **Pengeluaran → Cipta keluaran** → naik taraf AAB → isi borang permohonan (soalan tentang ujian tertutup) → **Mohon rilis** → semakan Google → **Live di Google Play**.

---

## ⚠️ Dua pagar yang hanya ANDA boleh lalu (bukan kod)
1. **Operasi Play Console** — login Google anda, klik borang, muat naik AAB. Saya tak boleh log masuk atas nama anda.
2. **Masa & tester** — Production memerlukan **≥12 penguji × ≥14 hari** ujian tertutup. Ini pemasa wajib Google; tiada jalan pintas automasi.

Semua yang boleh disiapkan dari pihak kod/repo **sudah siap & disahkan**. Baki ialah tindakan Console + pemasa 14 hari di atas.
