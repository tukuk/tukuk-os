SLUG: apa-itu-base64-bila-perlu-guna
TITLE: Apa Itu Base64, Bila Anda Perlu Guna, dan Bila Sebaiknya Jangan
EXCERPT: Base64 ada di mana-mana, daripada emblem gambar hingga token API, tetapi ramai menyangkanya penyulitan. Sebenarnya ia hanya cara menukar byte kepada aksara yang selamat. Ini cara ia berfungsi dan bila ia tepat atau membazir.
TAGS: base64, encoding, data, web, pemaju

## Menukar Byte Jadi Aksara Selamat

Kebanyakan sistem teks direka untuk aksara, bukan untuk byte mentah. Satu fail gambar, PDF, atau token boleh mengandungi byte yang bermakna aksara kawalan, baris baru, atau nilai yang akan merosakkan format teks. Base64 menyelesaikan ini dengan memetakan setiap tiga byte kepada empat aksara yang dipilih daripada satu abjad selamat 64 watak, huruf besar, huruf kecil, nombor, dan dua simbol. Hasilnya lebih panjang daripada asal, kira-kira tiga perempat lebih besar, tetapi boleh dihantar di mana-mana format teks tanpa rosak.

Inilah sebab emblem gambar boleh diselitkan dalam CSS sebagai satu rentetan `data:image`. Inilah juga sebab token dan kunci sering dipaparkan dalam bentuk yang boleh ditampal ke pelayan tanpa mengganggu struktur. Anda boleh menukar apa-apa teks kepada Base64 dan kembali lagi di [alat Base64](https://tukuk.org/alat/base64), semuanya berjalan di pelayar anda.

## Ia Bukan Penyulitan

Kesilapan paling lazim ialah menyangka Base64 melindungi rahsia. Tidak. Sesiapa yang nampak rentetan Base64 boleh memulihkannya dalam saat, kerana ia satu pemetaan tetap tanpa kunci. Jangan gunakan Base64 untukmenyembunyikan kata laluan atau data sensitif. Kalau anda perlu menyembunyikan maklumat, guna penyulitan yang sebenar dengan kunci. Base64 hanya memastikan byte selamat melalui saluran teks, bukan merahsiakannya.

Fikirkan begini: Base64 ialah pembungkusan, bukan peti besi. Ia memastikan barang sampai dalam bentuk yang boleh dibaca oleh paip, tetapi tidak menghalang siapa pun membuka bungkusan itu.

## Bila Ia Membazir

Kerana Base64 membesarkan data hampir 33%, gunakan hanya bila perlu. Jika anda menghantar fail sebagai attachment e-mel dalam format MIME, memang Base64, jadi itu wajar. Jika anda menyimpan gambar dalam JSON supaya satu muatan boleh menghantar semuanya sekali, itu masuk akal walaupun ada kos saiz. Tetapi kalau anda hanya perlu menyimpan teks biasa, jangan Base64-kan dia; ia hanya membesarkan dan menyukarkan pembacaan. Untuk menampal data ke URL, pertimbangkan encoding URL yang betul di [alat URL](https://tukuk.org/alat/url) sebagai ganti.

## Membaca Outputnya

Apabila decode, anda mungkin nampak aksara pelik jika asal itu byte bukan teks, dan itu normal, ia memulihkan tepat apa yang masuk. Tanda `=` di hujung ialah padding untuk melengkapkan kumpulan empat; tiada padanan bermakna panjang input bukan gandaan tiga. Fahami dua perkara ini sahaja, dan anda sudah boleh mempercayai Base64 untuk apa ia benar-benar ada, iaitu jambatan selamat antara byte mentah dan saluran yang hanya faham aksara.
