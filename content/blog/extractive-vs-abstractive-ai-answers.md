SLUG: extractive-vs-abstractive-ai-answers
TITLE: Extractive vs Abstractive AI Answers: Why We Chose the Sentence That Exists
EXCERPT: An extractive engine quotes the best passages it actually found; an abstractive LLM writes new prose. For a search engine that must never invent facts, the first option wins by default.
TAGS: ai, rag, search, llms

## Two Ways to Answer a Question

Ask a search engine "what is head-of-line blocking?" and it can respond in two fundamentally different ways:

- **Extractive**: locate the passages in its index that contain the answer, score them, and present the best one — a sentence a human already wrote and published.
- **Abstractive**: pass the passages to a large language model and let it *compose* a new sentence that summarises them.

The second sounds more impressive. It is also where hallucinations live: a model fluent enough to sound confident is also capable of confidently merging two sources into a claim neither one makes.

## The Failure Modes, Side by Side

| | Extractive | Abstractive |
|---|---|---|
| Invents facts | Only via bad source material | Yes — by construction |
| Fails visibly when index is empty | Yes ("no answer found") | No — it answers anyway |
| Latency | Milliseconds | Seconds (or an API round trip) |
| Cost | CPU only | GPU or per-token API fees |
| Voice | Quotation, sometimes choppy | Smooth, human-sounding |
| Attribution | Trivial (here is the URL) | Requires extra plumbing |

The third row is the quiet killer for small deployments: when retrieval finds nothing, an extractive system **says so**, while an LLM happily produces an authoritative-sounding paragraph about a topic it has zero sources for. That is the worst possible answer for a search engine.

## Our Architecture

Tukuk-OS runs extractive answers as the default:

1. **Retrieve** candidate passages (BM25-style scoring via Meilisearch, plus a small local knowledge store for fixed facts).
2. **Score** by query overlap, source quality, and freshness.
3. **Extract** the highest-scoring sentence or two, keeping the source URL attached.
4. **Return** with `"model": "extractive (no LLM)"` in the response metadata — the user can see exactly how the answer was made.

Responses are then **language-matched to the interface** (we translate the surface strings to English rather than letting browser auto-translation mangle them — a lesson that came from watching a Malay browser mangle English answers in real time).

The whole path answers in **tens of milliseconds cold**, needs no API key, no quota, no network dependency — which matters more than eloquence for a site that promises to stay online.

## When the LLM Earns Its Keep

Abstractive generation is genuinely better for: multi-document synthesis ("compare these three papers"), conversational follow-ups, rewriting technical content for a different audience, and tasks where *style* is the point. Systems that can afford an LLM should offer both: extractive as the fast, safe default; generative as an opt-in mode, clearly labelled, with citations either way.

What does not work is the middle ground — a smooth answer with no visible sourcing, where the user cannot tell whether they are reading BBC reporting or a model's interpolation of it.

## The Principle

**A search engine's job is to find what exists.** When we answer, we should be able to point at the exact document the words came from. Extractive answers make that guarantee structural; abstractive answers make it a promise. On the open web, structure beats promises.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Extractive vs Abstractive AI Answers: Why We Chose the Sentence That Exists** dalam konteks sebenar:

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