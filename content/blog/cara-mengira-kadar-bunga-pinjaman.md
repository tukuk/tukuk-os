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

