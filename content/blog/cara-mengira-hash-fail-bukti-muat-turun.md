SLUG: cara-mengira-hash-fail-bukti-muat-turun
TITLE: Cara Mengira Hash Fail dan Mengapa Ia Membuktikan Muat Turun Anda Tidak Dirusak
EXCERPT: Satu deretan watak heks boleh memberitahu anda sama ada fail yang baru dimuat turun persis sama dengan yang diterbitkan. Ini cara memeriksa SHA-256 atau MD5 sendiri, apa yang dibuatnya, dan had yang perlu anda tahu.
TAGS: hash, sha256, md5, keselamatan, muat turun, keintegritian

## Apa Sebenarnya Hash

Hash ialah ringkasan satu arah. Anda suapkan fail berapa pun saiznya, dan algoritma memulangkan satu rentetan panjang dengan saiz tetap. Tukar satu bit dalam fail, dan hash berubah sama sekali. Ia bukan penyulitan kerana anda tidak boleh memulihkan fail daripada hash, dan itu bukan tujuannya. Tujuannya ialah sidik jari: dua fail yang menghasilkan hash yang sama hampir pasti fail yang sama, dan dua hash yang berbeza membuktikan fail itu berlainan.

Dua nama yang sering anda lihat ialah MD5 dan SHA-256. MD5 sudah uzur dan boleh digubah collide oleh penyerang, jadi ia hanya sesuai untuk mengesan rosak tidak sengaja, bukan untuk membuktikan keselamatan. Untuk apa-apa yang anda muat turun dan jalankan,SHA-256 ialah pilihan yang betul.

## Cara Memeriksa Muat Turun Langkah Demi Langkah

Apabila sebuah laman menyediakan fail untuk dimuat turun, ia biasanya memaparkan hash SHA-256 bersama fail itu. Muat turun fail, kira hash anda sendiri, dan bandingkan. Kalau kedua-duanya persis sama dari aksara pertama hingga terakhir, fail yang sampai ke tangan anda tidak berubah dalam perjalanan. Jika beza walaupun satu watak, jangan guna fail itu; sesuatu telah menukarnya.

Anda boleh melakukan pengiraan ini di pelayar tanpa memuat naik fail ke mana-mana, semua pemprosesan berlaku pada peranti anda sendiri. Buka [alat hash](https://tukuk.org/alat/hash), seret fail masuk, dan bandingkan hasilnya dengan hash yang diterbitkan. Untuk fail yang lebih kecil atau teks, anda juga boleh menampal terus.

## Di Mana Hash Menyelamatkan Anda

Skenario paling biasa ialah muat turun perisian dari tempat cermin. Kalau hash pada cermin sama dengan hash pada laman asal, anda tahu salinan itu bersih walaupun laluan anda melalui pelayan pihak ketiga. Ia juga menangkap rosak separuh jalan, sambungan yang terputus, dan cakera yang mula rosak, yang kesemuanya mengubah fail tanpa anda sedar. Untuk APK dan imej ISO, pemeriksaan hash ialah rutin yang wajib kerana saiznya besar dan muat turun sering terputus.

Satu perkara penting: pastikan anda membandingkan hash daripada sumber yang anda percaya. Kalau penyerang boleh menukar fail, mereka mungkin juga boleh menukar hash yang dipaparkan di tempat sama. Hash dilindungi hanya apabila nombor pembanding itu datang dari tempat yang berbeza dan sah.

## Batasan Yang Perlu Jujur Diakui

Hash membuktikan identiti, bukan kebaikan. Fail yang hashnya sepadan tetap boleh mengandungi kandungan berbahaya jika penulis asalnya memang memasukkannya. Hash kata pada anda "ini fail yang sama dengan yang diterbitkan", bukan "ini fail yang selamat". Untuk keselamatan sepenuhnya, hash digabungkan dengan tandatangan digital yang membuktian siapa penerbitnya. Tetapi sebagai ujian pantas sama ada muat turun anda rosak atau ditukar, hash ialah alat paling murah dan paling cepat yang anda ada.
