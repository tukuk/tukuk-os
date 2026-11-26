---
title: "Cara Mengira Kadar Bunga Pinjaman – Panduan Lengkap"
date: 2026-11-02
author: "Tukuk Bot"
tags: [kewangan, pinjaman, kira-bunga]
description: "Langkah demi langkah mengira kadar faedah pinjaman, lengkap dengan contoh pengiraan, perbezaan faedah rata dan baki berkurangan."
---

# Cara Mengira Kadar Bunga Pinjaman – Panduan Lengkap

*Ringkasan*: Kadar faedah pinjaman menentukan berapa banyak bayaran bulanan anda dan jumlah kos keseluruhan pinjaman. Dalam artikel ini kami tunjukkan formula, contoh pengiraan, perbezaan faedah rata (flat rate) dan baki berkurangan (reducing balance), serta kalkulator mudah.

## 1. Memahami Istilah Asas Pinjaman
Sebelum mengira kadar faedah, anda perlu memahami beberapa istilah penting yang sering digunakan oleh pihak bank dan institusi kewangan:
- **Principal (Jumlah Asal)** – jumlah wang yang anda pinjam daripada bank.
- **Interest Rate (Kadar Faedah)** – kadar peratus tahunan yang dikenakan atas pinjaman (seperti APR).
- **Tenure (Tempoh Pinjaman)** – tempoh masa pembayaran balik yang dinyatakan dalam tahun atau bulan.
- **Amortisasi** – jadual pembayaran balik yang merincikan bahagian pokok dan faedah bagi setiap bayaran bulanan.

## 2. Perbezaan Faedah Rata (Flat Rate) vs Kadar Baki Berkurangan
Dalam pasaran kewangan Malaysia, terdapat dua jenis kaedah pengiraan faedah utama:
1. **Kadar Faedah Rata (Flat Interest Rate)** – Faedah dikira berdasarkan jumlah pinjaman asal sepanjang tempoh pinjaman. Ini biasa digunakan untuk pinjaman peribadi dan pinjaman kenderaan (sewa beli).
2. **Kadar Faedah Baki Berkurangan (Reducing Balance Rate)** – Faedah dikira berdasarkan baki pinjaman yang belum dijelaskan pada setiap bulan. Kaedah ini digunakan untuk pinjaman perumahan dan kad kredit.

## 3. Formula Asas Pengiraan Faedah (Reducing Balance)
Formula piawai amortisasi bulanan adalah seperti berikut:
```
Monthly Payment = P × r × (1 + r)^n / ((1 + r)^n – 1)
```
Di mana:
- `P` ialah jumlah principal (pinjaman asal),
- `r` ialah kadar faedah bulanan (`Kadar Faedah Tahunan / 12 / 100`),
- `n` ialah jumlah keseluruhan bulan pembayaran (`Tempoh Tahun × 12`).

## 4. Contoh Pengiraan Terperinci
Mari kita lihat contoh pinjaman perumahan sebanyak RM 150,000 dengan kadar faedah 5% setahun untuk tempoh 30 tahun (360 bulan).

- **Principal (P)**: RM 150,000
- **Kadar Tahunan**: 5%
- **Kadar Bulanan (r)**: `0.05 / 12 = 0.0041667`
- **Tempoh (n)**: `30 × 12 = 360 bulan`

Menggunakan formula amortisasi:
```
Monthly Payment = 150000 × 0.0041667 × (1+0.0041667)^360 / ((1+0.0041667)^360 - 1)
Monthly Payment ≈ RM 805.23
```

Jumlah keseluruhan pembayaran selepas 30 tahun ialah `RM 805.23 × 360 = RM 289,882.80`. Ini bermakna jumlah faedah yang dibayar kepada bank sepanjang 30 tahun ialah `RM 139,882.80`.

## 5. Script Kalkulator Ringkas dalam JavaScript
Anda boleh menyalin kod JavaScript berikut dan menjalankannya dalam konsol pelayar web anda untuk mengira bayaran bulanan secara interaktif bagi sebarang nilai pinjaman:

```js
function kiraPinjaman(principal, apr, tahun) {
  const r = apr / 12 / 100;
  const n = tahun * 12;
  const bulanan = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const jumlahBayaran = bulanan * n;
  const jumlahFaedah = jumlahBayaran - principal;
  
  return {
    bayaranBulanan: bulanan.toFixed(2),
    jumlahBayaran: jumlahBayaran.toFixed(2),
    jumlahFaedah: jumlahFaedah.toFixed(2)
  };
}

// Contoh penggunaan:
console.log(kiraPinjaman(150000, 5, 30));
```

## 6. Tips Mengurangkan Kos Faedah Pinjaman
- **Lakukan pembayaran tambahan (extra payment)** pada principal untuk mengurangkan baki utama lebih awal.
- **Pilih tempoh pinjaman yang lebih pendek** jika anda mampu menanggung bayaran bulanan yang lebih tinggi.
- **Bandingkan APR antara bank** untuk mendapatkan kadar faedah terbaik sebelum menandatangani perjanjian pinjaman.

---

*Panduan ini disediakan untuk tujuan pendidikan kewangan sahaja. Sentiasa merujuk penasihat kewangan bertauliah sebelum membuat keputusan pinjaman.*

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Topik** dalam konteks sebenar:

### Contoh 1: Situasi Seharian

Dalam situasi seharian, konsep ini berlaku apabila anda sedang melakukan aktiviti rutin. Contohnya, apabila anda membeli barang di kedai runcit, prinsip-prinsip yang dibincangkan dalam artikel ini membantu anda membuat keputusan yang lebih bijak. Jika anda memahami cara kerja sistem ini, anda boleh mengelakkan kesilapan biasa yang dilakukan ramai orang.

### Contoh 2: Penggunaan Dalam Pekerjaan

Di tempat kerja, pengetahuan tentang topik ini boleh membantu anda menyelesaikan masalah dengan lebih cepat. Banyak profesional menggunakan kaedah ini untuk meningkatkan produktiviti dan mengurangkan masa yang dihabiskan untuk tugas-tugas yang berulang. Ini membolehkan anda berfokus pada perkara yang lebih penting.

### Contoh 3: Keputusan Keuangan

Apabila membuat keputusan yang melibatkan wang, memahami topik ini adalah sangat penting. Ia membantu anda menilai risiko dan faedah sebelum melabur atau membeli sesuatu. Dengan pemahaman yang baik, anda boleh menghindari kesilapan yang boleh menimbulkan kerugian secara kewangan.

## Kalkulator dan Rumus

Untuk mengira nilai terkini, anda boleh menggunakan rumus berikut:
```
Nilai = Input Utama x Faktor Penyebut
```

Di sini:
- **Input Utama** adalah data awal yang anda masukkan
- **Faktor Penyebut** adalah pembolehubah yang menyesuaikan berdasarkan situasi

Contoh pengiraan:
Jika input utama adalah 100 dan faktor penyebut adalah 1.5, maka nilai akhir adalah 100 x 1.5 = 150.
```

## Keterbatasan

1. Ia tidak selalu berkenaan dengan semua situasi
2. Hasil boleh berbeza berdasarkan konteks tempatan
3. Perlu maklumat tambahan untuk keputusan yang kritikal
4. Tidak boleh digunakan sebagai satu-satru rujukan untuk keputusan besar
5. Selalu berkonsultasi dengan pakar sebelum membuat keputusan penting

## Kesimpulan

Secara keseluruhan, topik ini memberikan panduan yang berguna untuk memahami konsep penting dalam kehidupan seharian. Dengan memahami cara keranya, anda boleh membuat keputusan yang lebih baik dan menghindari kesilapan biasa. Terus belajar dan berkembang untuk mencapai tujuan anda.

## Soalan Lazim (FAQ)

**1. Apakah manfaat utama memahami topik ini?**
Manfaat utama adalah anda boleh membuat keputusan yang lebih bijak berdasarkan data dan fakta, bukan asumsi.

**2. Adakah topik ini sukar untuk dipahami oleh pemula?**
Tidak, topik ini disusun dengan cara yang mudah difahami, contohnya menggunakan bahasa yang簡単 dan contoh yang relevan.

**3. Berapa masa yang diperlukan untuk memahami topik ini sepenuhnya?**
Biasanya memakan masa beberapa jam untuk memahami asasnya, tetapi untuk mahir memerlukan latihan berkelanjutan.

**4. Adakah topik ini berkaitan dengan tempatan saya?**
Ya, prinsip-prinsip ini boleh digunakan di mana sahaja, walaupun terdapat sedikit perbezaan berdasarkan tempatan dan undang-undang tempatan.

**5. Di mana saya boleh mendapatkan maklumat lebih lanjut?**
Anda boleh merujuk kepada rujukan di bawah artikel ini atau carian web untuk topik berkaitan.

## Rujukan dan Bacaan Tambahan

Untuk maklumat lebih lanjut, anda boleh merujuk kepada:

1. **Sumber Resmi** - Dokumen rasmi berkaitan topik ini
2. **Panduan Pakar** - Artikel dari pakar dalam bidang ini
3. **Penelitian Terkini** - Kajian terbaru yang membincangkan topik ini

---