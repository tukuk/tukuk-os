SLUG: kegagalan-senyap-backup-r2
TITLE: Kegagalan Senyap: Bagaimana Backup Kami Rupa-rupanya Tidak Pernah Berjaya
EXCERPT: Selama berbulan-bulan sistem snapshot yakin "selesai" sambil setiap muat naik ke R2 gagal senyap-senyap. Penyebabnya: token API dengan skop yang salah, dan skrip yang tidak pernah mengira kegagalan. Pengajaran: kejayaan timer bukan bukti kejayaan kerja.
TAGS: backups, cloudflare, r2, devops, case study, tukuk-os

## Semua Lampu Hijau, Tapi Tiada Yang Masuk

Tukuk-OS mempunyai lapisan sandaran yang kelihatan kemas: timer systemd setiap 4 jam menjalankan `snapshot-r2.sh`, yang menyalin halaman dan aset ke Cloudflare R2. Worker `www.tukuk.org` membaca bucket itu untuk menghidangkan cermin apabila origin mati. `systemctl list-timers` menunjukkan LAST PASSED dengan status *success* setiap kali. Journal tamat dengan baris mesra: `[snapshot] selesai. Cermin www.tukuk.org kini segar.`

Kemudian satu audit kecil memaksa kita membaca log dengan teliti — bukan baris terakhir, tapi semua baris. Dan di situ tersergam berpuluh-puluh:

```
  ! gagal index.html
  ! gagal llms.txt
  ! gagal robots.txt
```

Setiap muat naik gagal. *Setiap. Satu.* Sejak bermula. Cermin "sandaran" kami sebenarnya arkib lapuk yang tidak pernah disentuh, dan skrip tetap keluar dengan code 0 kerana fungsi `put()` mencetak amaran tapi tidak pernah mengira kegagalan atau `exit 1`.

## Punca: Token Yang Tidak Pernah Ada Kunci Bilik Itu

Kesalahan pertama adalah manusia: semasa membuat API token Cloudflare untuk tunnel, kita tambah juga skop DNS dan Zone — cukup untuk semua yang diuji ketika itu. Tapi `wrangler r2 object put` memerlukan **Account Settings: Read** (untuk mengenal pasti akaun) dan **R2: Edit**. Token itu tidak ada langsung kedua-duanya.

Pengesahan itu mengambil satu curl:

```
GET /accounts → {"result": [], "success": true}
```

Berjaya, tapi kosong. Token yang sah, tapi tiada akaun boleh dilihat. R2? `Authentication error`. Bukti kukuh, bukan tekaan.

Ironinya: laptop saya sudah ada laluan yang berfungsi — `wrangler` dengan login OAuth, yang jelas boleh menulis ke R2. VPS sahaja yang memegang token buta.

## Pembetulan: Jangan Perbaiki Token, Buang Keperluan Token

Daripada meminta pengguna membuat token baru dengan skop yang betul (yang boleh lupa, luput, atau salah tampal), kami alihkan arkitektur: satu worker kecil `tukuk-backup` yang **mempunyai** binding R2 di pihak Cloudflare, dan VPS hanya perlu HTTP POST dengan rahsia pemikul. Worker itu yang menulis ke bucket — token VPS tidak lagi terlibat langsung.

```
curl -X POST -H "Authorization: Bearer $RAHSIA" \
     -H "x-content-type: application/gzip" \
     --data-binary @data.tar.gz \
     "$WORKER/?key=backups/tukuk-data-505.tar.gz"
```

Keuntungan berganda: saluran yang sama kini dipakai oleh sandaran data setiap jam (`data/` → R2, rotasi 168 slot = 7 hari penuh), dan skrip pemulih (`restore-data.sh`) telah divalidasi dengan **uji pulih sebenar**: muat turun, hamparkan, `diff -rq` dengan data hidup — kosong.

## Pelajaran Yang Boleh Dipakai Semula

1. **Status timer ≠ status kerja.** Unit systemd yang `exit 0` sambil mengabaikan setiap kegagalan dalaman adalah pembohong yang paling meyakinkan. Kira kegagalan, `exit 1` bila bukan sifar — biar timer turut gagal dan lebih kelihatan.
2. **Uji sandaran dengan memulihkan, bukan dengan menulis.** Backup yang belum melalui uji pulih hanyalah harapan. Kami hanya pasti apabila `diff` pulang kosong.
3. **Semak skop token sebelum menyalahkan log.** Satu `GET /accounts` yang mengembalikan senarai kosong mendedahkan kelemahan token dalam seminit — jauh lebih cepat daripada mengorek journal.
4. **Letakkan kelayakan di tempat yang tak boleh lupa.** Binding R2 pada worker tidak akan "luput skop" selepas rotasi token; fail `.env` akan.

Kadang-kadang perkara paling "pro" yang boleh anda buat untuk sebuah projek solo bukan menambah ciri — tapi memeriksa dengan jujur bahawa ciri yang anda percaya selama ini memang pernah berfungsi.
