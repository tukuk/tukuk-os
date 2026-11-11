SLUG: cara-bersih-data-csv-duplikat
TITLE: Cara Membersihkan Data CSV: Buang Duplikat, Perbaiki Kolom, dan Tukar ke JSON
EXCERPT: Fail CSV sering datang dengan baris berulang, ruang tepi, dan lajur yang tidak sepadan. Ini alur kerja ringkas untuk merapikannya tanpa spreadsheet berat, termasuk menukarnya kepada JSON yang lebih kemas untuk aplikasi.
TAGS: csv, json, data, pembersihan, duplikat, pemaju

## Kenal Pasti Dulu Jenis Kotoran

Data mentah biasanya rosak dengan empat cara. Baris berganda, iaitu rekod yang sama masuk dua kali. Ruang ekstra di hujung nilai, yang menjadikan "Ali " berbeza daripada "Ali". Pemisah yang tidak konsisten, contohnya koma di sebahagian fail tetapi titik koma di bahagian lain kerana dieksport dari Eropah. Dan lajur yang tidak sepadan kerana satu baris mempunyai lebih atau kurang koma daripada kepala. Sebelum membaiki, buka fail dan lihat baris pertama serta beberapa baris rawak supaya anda tahu mana satu yang paling mengganggu.

## Buang Duplikat Dengan Betul

Duplikat hanya bermakna jika seluruh rekod sama. Jika dua baris nampak serupa tetapi satu lajur berbeza, ia mungkin rekod berlainan yang tersilap. Jadi buang baris yang tepat sama seluruhnya dahulu; itu selamat. Untuk kes yang lebih halus, tetapkan lajur kunci, misalnya nombor pendaftaran atau e-mel, dan pastikan hanya satu rekod per kunci. Alat CSV dalam pelayar membolehkan anda melihat baris berganda tanpa memuat naik ke pelayan, jadi data anda kekal peribadi; cuba di [alat CSV](https://tukuk.org/alat/csv).

## Perbaiki Kolom dan Ruang Tepi

Ruang di hujung nilai ialah punca perbandingan yang gagal, kerana sistem melihat dua teks berbeza walaupun manusia melihat sama. Memangkas ruang pada setiap lajur sebelum menggabungkan atau menapis akan menghapus banyak ralat aneh sekaligus. Pastikan juga kepala lajur sepadan dengan bilangan nilai setiap baris; baris yang lebih pendek atau lebih panjang daripada kepala ialah kerosakan yang perlu dibaiki atau dibuang, bukan diimport membuta tuli.

## Tukar Ke JSON Bila Struktur Mulai Rumit

CSV baik untuk jadual rata, tetapi ia tersepak apabila nilai perlu mengandungi senarai atau bersarang. JSON menyimpan struktur itu dengan kemas. Selepas CSV dibersihkan, tukarnya kepada array objek supaya setiap baris menjadi rekod dengan nama lajur sebagai kunci. Anda boleh semak hasilnya di [alat JSON](https://tukuk.org/alat/json). Jika anda membandingkan dua versi fail selepas pembersihan, [alat diff](https://tukuk.org/alat/diff) menunjukkan lajur mana yang berubah, jadi anda yakin tiada data baik terpadam.

## Simpan Salinan Asal

Sebelum menyimpan hasil bersih, kekalkan fail mentah apa adanya. Pembersihan adalah proses yang boleh silap, dan salinan asal ialah wayar anda untuk kembali. Beri nama jelas, misalnya mentah dan bersih, dan bandingkan kiraan baris sebelum serta selepas supaya anda tahu berapa banyak dibuang dan mengapa. Bersih sedikit demi sedikit, sahkan setiap langkah, dan spreadsheet anda akan berhenti melawan anda.
