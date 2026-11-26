SLUG: bm25-relevance-explained
TITLE: BM25: The Relevance Formula Behind Almost Every Search Box
EXCERPT: Before embeddings and neural rerankers, there was a formula that still decides most rankings — term frequency, saturation, and a penalty for documents that repeat themselves.
TAGS: ranking, bm25, search, algorithms

## The Question BM25 Answers

You type `climate policy`. Ten thousand documents contain some of those words. Which one goes first? **BM25** (Best Matching 25) is the standard answer — a probabilistic scoring function from the 1990s that remains the default in Lucene, Elasticsearch, OpenSearch, and most modern engines as a first-stage ranker, even when a learning model reranks later.

## The Three Ingredients

For each query term, BM25 combines:

1. **TF — term frequency, with saturation.** A document mentioning the term more often scores higher — but with diminishing returns. The jump from 1 to 5 occurrences matters; from 50 to 54 barely registers. The `k1` parameter controls how fast the curve flattens (typically ~1.2–2.0). This saturation is why keyword-stuffing stopped working decades ago.

2. **IDF — inverse document frequency.** Rare words weigh more than common ones. If `the` appears everywhere, matching it proves nothing; if `quorum` appears in three documents, matching it is strong evidence. This is the "rare term = informative term" principle in one multiplication.

3. **B — length normalisation.** Long documents naturally contain more query terms by accident. The `b` parameter (typically 0.75) divides the score by a length factor so a short, focused page can beat an encyclopedia entry that merely mentions the topic in passing.

$$
\text{score}(q,d) = \sum_{t \in q} \text{IDF}(t) \cdot \frac{f(t,d)\,(k_1+1)}{f(t,d) + k_1\left(1-b+b\cdot\frac{|d|}{\text{avgdl}}\right)}
$$

You do not need to memorise the algebra. You need the three knobs: **frequency saturates, rare words count more, long docs are normalised.**

## Where BM25 Beats Cleverness

- **It is explainable.** For any result you can print: which terms matched, their frequencies, their IDF. Embeddings hand you a number and a shrug.
- **It is instant.** Inverted-index lookup plus arithmetic — no model inference, no GPU, milliseconds on hundreds of thousands of documents.
- **It fails honestly.** Zero matching terms → low score → the engine can *say* it found nothing. A neural model will still produce a confident-looking answer with nothing behind it.
- **Exact matches win when they should.** Searching a product code, a hostname, or a surname rewards literal matching, where BM25 is strongest.

## Where It Stops

BM25 does not know that `car` and `automobile` are the same thing, cannot follow "the president of France" across paraphrase, and has no notion of intent. That is where synonyms, stemming, and neural reranking enter — typically *on top of* a BM25 first stage that has already cut a million documents to the top hundred.

## Practical Takeaways

- Tuning `k1` and `b` is real but secondary — **fix your data first**: clean titles, de-duplicated pages, sensible field lengths. Garbage in, formula out.
- Search across **fields with weights** (title > headings > body) before touching parameters.
- Measure with real queries: collect actual searches (and zero-result ones), score candidates by hand for twenty queries, and change one variable at a time.

Every search engine you admire almost certainly runs BM25 somewhere in its pipeline. Understanding it is the difference between tuning your engine and merely turning knobs.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **BM25: The Relevance Formula Behind Almost Every Search Box** dalam konteks sebenar:

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