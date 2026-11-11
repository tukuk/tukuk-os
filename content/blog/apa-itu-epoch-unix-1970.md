SLUG: apa-itu-epoch-unix-1970
TITLE: Apa Itu Epoch Unix dan Kenapa Tahun 1970 Menganguskan Orang Pengaturcaraan
EXCERPT: Banyak sistem menyimpan waktu sebagai satu nombor panjang, iaitu saat sejak satu hari pada 1970. Bila nombor itu salah atau meleret, tarikh jatuh ke 1970 dan membingungkan semua orang. Ini asal usulnya dan kenapa ia penting.
TAGS: epoch, unix, masa, pemaju, tarikh, timestamp

## Waktu Sebagai Satu Nombor

Komputer lebih mudah membandingkan masa jika ia sekadar nombor, bukan teks seperti "2 Mac 2026". Jadi sistem Unix dan Linux menyimpan masa sebagai **epoch**, iaitu berapa saat yang telah berlalu sejak tengah hari UTC pada 1 Januari 1970. Satu integer panjang ini membolehkan tolak, tambah dan susun menjadi mudah: masa yang lebih besar bermakna lebih lewat. Nombor itu dipanggil cap masa epoch, dan ia adalah tulang belakang log, nama fail, sijil, dan rekod pangkalan data di seluruh dunia.

Sebab 1970 dipilih agak praktikal, ia tahun bulat yang cukup awal untuk sebahagian besar sejarah pengkomputeran moden tetapi belum memaksa pengiraan ke masa lalu yang rumit. Ia bukan bermakna apa-apa secara sejarah, cuma titik nol yang selesa.

## Bila Nombor Itu Jatuh Ke 1970

Pernah anda lihat aplikasi memaparkan tarikh "1 Jan 1970"? Itu hampir selalu bererti cap masa bernilai sifar atau kosong, lalu ditambah kepada epoch. Ia bukan tarikh sebenar, ia tanda bahawa data masa tidak diisi. Punca biasa ialah medan yang tidak ditulis, ralat penukaran, atau fail yang tidak mempunyai metadata waktu. Jadi apabila anda nampak 1970, jangan panik tentang tarikh; cari mengapa nombor masa itu tiada. Anda boleh lihat nilai epoch semasa dan cuba tukar di [alat epoch](https://tukuk.org/alat/epoch), dan bandingkan dengan [alat tarikh](https://tukuk.org/alat/date).

## Perangkap Zona Masa Dan Unit

Epoch disimpan dalam UTC supaya tiada kekeliruan di hulu, tetapi ia sering dipapar dalam waktu tempatan, lalu nombor yang sama menunjukkan jam berbeza bergantung pada zona. Satu lagi ralat klasik ialah keliru saat dengan milisaat. Sesetengah sistem memakai saat sejak 1970, sesetengah milisaat, dan sebahagian mikro. Jika anda mendarat pada masa 50 tahun akan datang atau beberapa jam sahaja selepas 1970, besar kemungkinan unitnya salah baca. Semak sama ada nombor anda saat atau milisaat sebelum mempercayainya, dan ingat pemasaan daylight hanya mempengaruhi paparan, bukan nilai epoch.

## Had Masa Depan

Oleh kerana epoch traditionally disimpan dalam integer 32-bit, ia akan melimpah pada 2038, isu yang dikenali sebagai masalah 2038, warisan tahun 2000 dalam dunia perisian. Sistem moden sudah berpindah kepada 64-bit, tetapi alat dan fail lama masih boleh tersilap. Menyedari ini penting kerana banyak perisian tertanam bertahan berpuluh tahun.

## Intinya

Epoch Unix hanyalah cara jujur untuk menyatakan masa sebagai satu nombor tetap sejak satu titik nol pada 1970. Fahymi tiga perkara, iaitu ia disimpan dalam UTC, boleh memakai saat atau milisaat, dan kosong bererti 1970, dan anda akan lebih cepat menjejak pelbagai ralat tarikh yang selama ini kelihatan misteri.
