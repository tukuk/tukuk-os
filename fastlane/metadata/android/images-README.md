# Aset gambar stor (perlu dijana/diunggah — TIDAK boleh dijana dari kod)

Google Play mewajibkan fail imej berikut. Letak di sini ikut struktur fastlane
(`supply` akan memuat naiknya), ATAU muat naik terus di Play Console.

en-US/images/  (salin yang sama ke ms/images/)
├── icon/512.png ..................... ikon apl, 512×512 (boleh jana dari
│                                       public/icons/apps/chat-512.png)
├── featureGraphic/feature.png ....... 1024×500 WAJIB untuk Play (tiada padanan
│                                       automatik — perlu direka)
├── phoneScreenshots/*.png ........... MINIMUM 2 tangkapan skrin telefon
│                                       (Portrait, sisi terpanjang ≥ 1080px;
│                                       format PNG/JPEG; tanpa bingkai peranti)
└── (tabletScreenshots pilihan — apl menyokong saiz skrin besar)

Nota dasar:
- Skrin mesti menunjukkan aplikasi SEBENAR (tangkap dari tukuk.org/apps/chat
  dalam WebView), bukan mockup.
- Ikon 512 + feature graphic: boleh dijana melalui Tukuk Studio (`/design`)
  atau Image Editor (`/editor`) lalu dimuat turun ke folder ini.
