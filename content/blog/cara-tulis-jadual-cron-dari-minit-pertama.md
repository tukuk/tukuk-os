SLUG: cara-tulis-jadual-cron-dari-minit-pertama
TITLE: Cara Menulis Jadual Cron: Lima Medan yang Mengawal Setiap Kerja Berjadual
EXCERPT: Cron mengatur kerja automatik pada pelayar Linux dengan satu baris yang mengandungi lima medan. Bunyinya rumit, tetapi sebaik anda faham setiap medan, anda boleh menulis jadual apa pun. Ini cara membacanya dan kesilapan yang paling kerap berlaku.
TAGS: cron, jadual, linux, pelayan, pentadbiran

## Lima Medan, Satu Masa

Setiap baris cron mempunyai lima medan masa diikuti arahan yang perlu dijalankan. Medan itu, dari kiri ke kanan, ialah minit, jam, hari dalam bulan, bulan, dan hari dalam minggu. Satu baris seperti `0 3 * * *` bermaksud pada minit ke-sifar, jam ke-tiga, setiap hari, setiap bulan, setiap hari minggu, iaitu setiap hari pada jam 3 pagi. Nombor bintang bermaksud sebarang nilai, jadi ia menerimanya tanpa had.

Yang mengelirukan ramai ialah tanda bintang bukan satu-satunya simbol. Garis mendatar `1-5` bermaksud julat, koma `1,3,5` bermaksud senarai tertentu, dan `*/15` bermaksud setiap lima belas unit. Gabungan ini membolehkan jadual yang sangat khusus tanpa perlu menulis banyak baris. Anda boleh bina dan sahkan ungkapan dengan [alat cron](https://tukuk.org/alat/cron) supaya tersilap faham dapat dikesan sebelum disimpan.

## Kesilapan Yang Paling Lazim

Ralat pertama ialah lupa zon waktu. Cron menggunakan waktu pelayan, bukan waktu anda, jadi jadual jam 3 pagi mungkin bermaksud waktu sejagat, bukan waktu tempatan. Kedua, ramai menulis output ke log yang tiada, lalu tidak tahu sama ada kerja itu berjaya atau gagal. Sebaiknya alihkan output ke satu fail log supaya anda boleh periksa kemudian. Ketiga, medan hari bulan dan hari minggu kedua-duanya ditaksir, jadi `0 0 1 * MON` akan berjalan pada hari pertama bulan ATAU setiap Isnin, bukan keduanya serentak.

## Mula Kecil, Uji Dulu

Cara selamat untuk belajar cron ialah mula dengan jadual setiap minit, `* * * * *`, yang menjalankan arahan setiap enam puluh saat. Letakkan satu arahan yang jelas, seperti menulis baris ke satu fail, supaya anda boleh sahkan ia benar-benar berjalan. Sebaik anda nampak ia berfungsi, barulah tukar kepada jadual sebenar yang anda perlukan, seperti sandaran harian atau pembersihan log mingguan. Apabila lima medan sudah jadi tabii, cron berubah daripada teka-teki kepada alat kerja yang boleh anda percaya sepenuhnya.
