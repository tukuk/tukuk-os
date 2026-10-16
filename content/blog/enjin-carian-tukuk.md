SLUG: enjin-carian-tukuk
TITLE: Enjin Carian Tukuk — BM25, Penusunan Semula AI, dan Jawapan Ringkas
EXCERPT: Di sebalik satu kotak carian Tukuk ada tiga lapisan: penilaian kebarangkalian, model penyusun semula neural, dan penjanaan jawapan — semuanya tanpa jejak cookie.
TAGS: search, bm25, ai, rerank, privacy

## Satu kotak, tiga lapisan

Tukuk-OS bermula sebagai enjin carian, dan itu masih terasnya. Bila anda menaip dan tekan Enter, satu permintaan melintasi beberapa peringkat yang jarang kelihatan:

**Lapisan 1 — BM25.** Penilai kebarangkalian klasik dari era 90-an yang masih jadi default di Lucene dan Elasticsearch. Ia mengira padanan terma dengan penentuan bobot: istilah yang jarang (seperti "kualiti") menyumbang lebih daripada yang kerap ("dan"), dan pengulangan berlebihan dihukum supaya dokumen tak menipu ranking dengan mengulang perkataan. Pantas dan boleh dijelaskan.

**Lapisan 2 — Penusunan semula (rerank).** Calon teratas dari BM25 kemudiannya disusun semula oleh model neural kecil yang memahami *semantik*, bukan sekadar padanan kata. Ini yang membezakan carian "baik" daripada carian "betul" — soalan seperti "apa sebab mata pen" boleh memulangkan artikel tentang air mata walaupun tiada satu pun kata yang sama.

**Lapisan 3 — Jawapan.** Untuk soalan yang sesuai, sistem membaca petikan terkuat dan menjana satu jawapan ringkas yang tepat, lengkap dengan sumbernya. Anda dapat inti dahulu, kemudian keputusan penuh jika mahu mendalami.

## Pantas walaupun luar talian

Hasil carian paling kerap di-cache sampai ke tepi (edge). Ada indeks ringan yang boleh berfungsi tanpa sambungan, dan service worker menyimpan aset supaya halaman carian terasa serta-merta. Prinsip kami: **rasa laju itu ciri, bukan kebetulan** — Core Web Vitals dijaga supaya pelayan lambat pun, antara muka kekal responsif.

## Privasi sebagai reka bentuk

Tiada akaun. Tiada cookie penjejakan. Tiada profil iklan dibina di belakang tabir. Sejarah carian disimpan setempat dan boleh dipadam bila-bila masa. Kami percaya enjin carian yang baik tak perlu mengintai anda untuk menjadi berguna — cukup dia faham soalan anda. Itulah yang kami kejar di setiap versi, dan sebab Tukuk dibina sendiri dari kosong: kawalan penuh bermakna tanggungjawab penuh terhadap data anda.
