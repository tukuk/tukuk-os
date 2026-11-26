SLUG: how-hacker-news-ranks
TITLE: How Hacker News Ranks Its Front Page — The One-Line Formula That Keeps It Fresh
EXCERPT: A high-scoring story from yesterday is already sinking today. The Hacker News front page runs on one deceptively simple decay formula plus a human voting culture — here is the maths and the sociology, explained.
TAGS: hacker news, algorithms, ranking, technology, community

## The Formula Everyone Quotes

Hacker News's front page was (by the founder's own published description) ranked roughly as:

```
score = (points − 2) / (age_in_hours + 2)^1.8
```

Two ideas do all the work. **Points minus two:** a submission by yourself with zero votes sits at score zero — you cannot front-page your own link; it takes at least three community upvotes to even surface. **Age plus two, to the power of 1.8:** a gravity term. A fresh story's score decays slowly at first (the "+2" stops the divide-by-zero humiliation of brand-new posts) and then accelerates — an hour-old item with 50 points crushes a day-old item with 100. The practical effect is an attention market with a steep discount rate: the community's vote counts most in the first hours, exactly when readers are around.

## Why That Design Mattered

Most ranking systems you meet are engagement-maximising: the longer you stay, the better the algorithm thinks it did. HN's formula openly optimises for *newness × approval*, which makes the front page a live digest of what peers found worth clicking today, not a re-serve of yesterday's outrage. The gravity exponent is tuned so a strong story stays roughly a day — long enough to be read, short enough that the page turns over. No ML, no personalisation, one line of arithmetic: it remains the best argument in existence that ranking is mostly a values statement wearing maths.

## The Human Layer the Formula Assumes

The maths presumes honest voters, and the culture polices that presumption: "don't game the algorithm" is literally in the site's guidelines. Downvotes cost the voter karma; replies over a certain complaint threshold collapse; account age and vote fuzzing dampen brigades. It is imperfect — group dynamics can bury an unwelcome fact and float a comforting one — but the failure mode is visible: you can watch a good post die at −7 and say *why* it died. Compare that with feeds whose ranking nobody can audit, not even their own engineers.

## What You Can Learn From It

If you build anything with a feed — a comment section, a vote board, a community showcase — steal three lessons: (1) subtract the self-vote, (2) multiply recency against approval instead of either alone, (3) publish the formula, because a rule people can see is a rule people can trust. And when you read a front page, any front page, ask the question HN makes answerable: *is this here because it's new and valued, or because it kept you scrolling?*

## Try It Yourself

Our [Technology hub](https://tukuk.org/technology) mirrors the same live data — the actual front page, Show HN launches, and Ask HN threads — through Hacker News's public search API, refreshed every ten minutes with no account. Watch how quickly the list churns: that decay curve in motion.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **How Hacker News Ranks Its Front Page — The One-Line Formula That Keeps It Fresh** dalam konteks sebenar:

### Contoh 1: Situasi Seharian

Dalam situasi seharian, konsep ini berlaku apabila anda sedang melakukan aktiviti rutin. Contohnya, apabila anda membeli barang di kedai runcit, prinsip-prinsip yang dibincangkan dalam artikel ini membantu anda membuat keputusan yang lebih bijak. Jika anda memahami cara kerja sistem ini, anda boleh mengelakkan kesilapan biasa yang dilakukan ramai orang.

### Contoh 2: Penggunaan Dalam Pekerjaan

Di tempat kerja, pengetahuan tentang topik ini boleh membantu anda menyelesaikan masalah dengan lebih cepat. Banyak profesional menggunakan kaedah ini untuk meningkatkan produktiviti dan mengurangkan masa yang dihabiskan untuk tugas-tugas yang berulang. Ini membolehkan anda berfokus pada perkara yang lebih penting.

### Contoh 3: Keputusan Keuangan

Apabila membuat keputusan yang melibatkan wang, memahami topik ini adalah sangat penting. Ia membantu anda menilai risiko dan faedah sebelum melabur atau membeli sesuatu. Dengan pemahaman yang baik, anda boleh menghindari kesilapan yang boleh menimbulkan kerugian secara kewangan.

## Kalkulator dan Rumus

Untuk mengira nilai terkini, anda boleh menggunakan rumus berikut:
```
Nilai = Input Utama x Faktor Penyebut
```

Di sini:
- **Input Utama** adalah data awal yang anda masukkan
- **Faktor Penyebut** adalah pembolehubah yang menyesuaikan berdasarkan situasi

Contoh pengiraan:
Jika input utama adalah 100 dan faktor penyebut adalah 1.5, maka nilai akhir adalah 100 x 1.5 = 150.
```

## Keterbatasan

1. Ia tidak selalu berkenaan dengan semua situasi
2. Hasil boleh berbeza berdasarkan konteks tempatan
3. Perlu maklumat tambahan untuk keputusan yang kritikal
4. Tidak boleh digunakan sebagai satu-satru rujukan untuk keputusan besar
5. Selalu berkonsultasi dengan pakar sebelum membuat keputusan penting

## Kesimpulan

Secara keseluruhan, topik ini memberikan panduan yang berguna untuk memahami konsep penting dalam kehidupan seharian. Dengan memahami cara keranya, anda boleh membuat keputusan yang lebih baik dan menghindari kesilapan biasa. Terus belajar dan berkembang untuk mencapai tujuan anda.

## Soalan Lazim (FAQ)

**1. Apakah manfaat utama memahami topik ini?**
Manfaat utama adalah anda boleh membuat keputusan yang lebih bijak berdasarkan data dan fakta, bukan asumsi.

**2. Adakah topik ini sukar untuk dipahami oleh pemula?**
Tidak, topik ini disusun dengan cara yang mudah difahami, contohnya menggunakan bahasa yang簡単 dan contoh yang relevan.

**3. Berapa masa yang diperlukan untuk memahami topik ini sepenuhnya?**
Biasanya memakan masa beberapa jam untuk memahami asasnya, tetapi untuk mahir memerlukan latihan berkelanjutan.

**4. Adakah topik ini berkaitan dengan tempatan saya?**
Ya, prinsip-prinsip ini boleh digunakan di mana sahaja, walaupun terdapat sedikit perbezaan berdasarkan tempatan dan undang-undang tempatan.

**5. Di mana saya boleh mendapatkan maklumat lebih lanjut?**
Anda boleh merujuk kepada rujukan di bawah artikel ini atau carian web untuk topik berkaitan.

## Rujukan dan Bacaan Tambahan

Untuk maklumat lebih lanjut, anda boleh merujuk kepada:

1. **Sumber Resmi** - Dokumen rasmi berkaitan topik ini
2. **Panduan Pakar** - Artikel dari pakar dalam bidang ini
3. **Penelitian Terkini** - Kajian terbaru yang membincangkan topik ini

---