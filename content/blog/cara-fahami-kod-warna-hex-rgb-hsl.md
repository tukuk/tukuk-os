SLUG: cara-fahami-kod-warna-hex-rgb-hsl
TITLE: Cara Memahami Kod Warna: HEX, RGB dan HSL, dan Bila Guna Setiap Satu
EXCERPT: Web menyimpan warna sebagai nombor, bukan nama. Tiga format yang anda akan jumpa ialah HEX, RGB dan HSL. Ini cara setiap satu berfungsi, cara menukar antara format, dan mana yang paling mudah dikendalikan oleh manusia.
TAGS: warna, hex, rgb, hsl, css, pemaju

## Warna Sebenarnya Hanya Tiga Nombor

Mata anda melihat warna, tetapi komputer menyimpannya sebagai campuran tiga nilai. Skrin membina setiap piksel daripada cahaya merah, hijau dan biru, jadi warna apa pun boleh dinyatakan sebagai berapa kuat setiap daripada tiga saluran ini dinyalakan. Format RGB menulisnya sebagai tiga nombor antara 0 hingga 255, contohnya merah tulen ialah 255 hijau 0 biru 0. Semakin besar nombor, semakin terang saluran itu.

Format HEX ialah cara lain menulis nombor yang sama, tetapi dalam asas enam belas dan dipadatkan kepada satu rentetan enam aksara. Merah tulen menjadi `#FF0000`, kerana FF dalam asas enam belas bersamaan 255. Anda akan lihat HEX di mana-mana dalam CSS dan reka bentuk web kerana ia pendek dan mudah disalin. Alat warna boleh menukar HEX kepada RGB dan HSL serta-merta di [alat warna](https://tukuk.org/alat/color).

## HSL Lebih Mudah Untuk Difikir

Masalah dengan HEX dan RGB ialah sukar untuk meneka hubungan antara warna. `#3366CC` dan `#2952A3` nampak berbeza jauh, walaupun sebenarnya warna kedua hanya versi gelap warna pertama. Format HSL menyelesaikan ini dengan menyatakan warna sebagai rona, tepenu dan cahaya. Rona ialah kedudukan pada roda warna, tepenu ialah betapa kuat atau pudar warna itu, dan cahaya ialah betapa gelap atau terang.

Apabila anda fikir dalam HSL, perbezaan jadi jelas. Untuk menjadikan warna lebih lembut, kurangkan tepenu. Untuk menjadikan lebih gelap, kurangkan cahaya. Inilah sebab banyak sistem reka bentuk kini menyimpan warna sebagai HSL atau token berstruktur, bukan HEX mentah, supaya mereka boleh menjana varian secara konsisten. Anda boleh uji sendiri dengan menggeser slider rona dan cahaya di [alat warna](https://tukuk.org/alat/color).

## Mana Satu Perlu Anda Guna

Untuk penulisan CSS ringkas, HEX sudah cukup dan paling lazim. Untuk tema yang perlu menjana warna terang dan gelap secara automatik, HSL lebih masuk akal kerana anda hanya ubah satu nombor. Untuk pengaturcaraan yang perlu membaca saluran warna secara berasingan, RGB dalam bentuk nombor paling mudah diproses. Ketiga-tiganya menyimpan maklumat yang sama, jadi anda boleh menukar bila perlu. Fahami tiga nombor di sebalik setiap warna, dan kod warna berhenti nampak seperti jampi.
