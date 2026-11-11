SLUG: regex-carian-mudah-jimat-masa
TITLE: Regex Untuk Orang Biasa: Corak Carian Mudah yang Menjimatkan Banyak Masa
EXCERPT: Anda tidak perlu menjadi pakar untuk mendapat manfaat daripada regex. Segelinternya watak sahaja sudah cukup untuk mencari e-mel, menukar format tarikh, atau menapis baris. Ini asas yang berbaloi dan cara mencubanya dengan selamat.
TAGS: regex, carian, teks, pemaju, pola

## Regex Cuma Cara Menulis "Corang"

Pemadan biasa mencari satu teks tepat. Regex pula mencari corak, misalnya "apa-apa yang bermula dengan 01 dan diikuti lapan angka" atau "setiap baris yang mengandungi e-mel". Kuasanya datang daripada segelintir simbol: titik untuk mana-manana satu aksara, tanda bintang untuk ulang, kurungan untuk kumpul, dan kelas seperti digit untuk sekumpulan aksara. Anda tidak perlu hafal semuanya; kuasai enam lapan corang, dan anda sudah boleh melakukan kerja yang memakan masa berjam-jam secara manual.

## Corang Harian Yang Paling Berguna

Untuk mencari e-mel ringkas, corak yang menggabungkan huruf, nombor, tanda, diikuti kedai, kemudian domain dan titik akhir sudah memadai untuk penapisan pantas. Untuk nombor telefon Malaysia yang bermula 01, "01" diikuti digit sudah membuang kebanyakan baris bukan telefon. Untuk menampung putih berlebihan, cari ruang berganda dan gantikan dengan satu. Untuk memastikan sesuatu bermula di awal baris, gunakan jangkar awal, dan untuk mengekang kepada angka sahaja, gunakan kelas digit, bukan titik yang menampung apa-apa.

## Cuba Tanpa Merosak Apa-Apa

Bahagian seronok regex ialah anda boleh bermain sepuas hati tanpa risiko. Tampalkan teks sampel, tulis corang, dan lihat padanan diserlahkan serta merta di [alat regex](https://tukuk.org/alat/regex). Tukar satu simbol, lihat kesannya. Cara belajar terpantas ialah eksperimen kecil, bukan membaca senarai simbol. Anda juga boleh menyemak aksara atau kod yang membingungkan melalui [alat aksara](https://tukuk.org/alat/char).

## Perangkap Yang Menyakitkan

Regex yang ditulis buruk boleh perlahan atau memadan perkara yang anda tidak mahu. Titik menampung apa-apa aksara, jadi ia bukan selalu pilihan terbaik. Kurungan boleh menjadi rumit dan menyebabkan padanan mengembang ke bahagian yang salah. Untuk kerja serius, mula dengan corang paling spesifik yang masih memadan target anda, dan uji pada sampel kecil sebelum menjalankan pada seluruh fail. Jangan cuba selesaikan semua perkara dalam satu regex panjang; dua langkah mudah lebih baik daripada satu baris yang tiada siapa boleh baca.

## Intinya

Regex bukan ilmu hitam, ia cuma bahasa ringkas untuk menggambarkan corang. Kuasai beberapa simbol asas, biasakan diri dengan jangkar dan kelas aksara, dan uji selalu dalam pelayar sebelum dipercayai. Selepas itu, kerja carian dan ganti yang dulu mengambil masa berjam-jam akan selesai dalam beberapa saat.
