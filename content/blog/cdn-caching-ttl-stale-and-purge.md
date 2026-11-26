SLUG: cdn-caching-ttl-stale-and-purge
TITLE: CDN Caching in Plain Terms: TTL, Stale, and When to Purge
EXCERPT: A CDN is not a copy of your site — it's a set of expiry rules about how long each edge may serve an old one. Understanding TTL, stale-while-revalidate, and cache keys is 90% of correct caching.
TAGS: caching, cdn, edge, operations

## The One Idea That Matters

A CDN stores responses at edge locations near users. The hard part is not storing — it's knowing **how long that stored copy may still be served**. That decision is a **TTL** (time-to-live) and a **cache key**.

- **Cache key** = what identifies "the same" response. Usually the URL, but also the parts you vary on (host, `Accept`, cookies, a version header). Get this wrong and you serve the logged-in page to anonymous users, or you never reuse the cache at all.
- **TTL** = how long the edge may serve without checking origin. Short TTL = fresher but more origin load. Long TTL = cheaper but staler.

## Setting TTLs by Volatility

Cache the things that rarely change, longest:

| Content | Typical TTL |
|---|---|
| Versioned static assets (`app.a1b2c3.js`) | Weeks–a year (they're immutable by name) |
| Images / fonts | Days–weeks |
| HTML shell | Minutes, or `no-cache` + revalidate |
| API responses | Seconds–minutes, or don't cache |

Immutable, fingerprinted filenames let you cache forever: you never invalidate, you just ship a new name.

## Serving Stale on Purpose (SWR)

`stale-while-revalidate` lets the edge serve the *expired* copy immediately while it fetches a fresh one in the background. Users get instant (slightly old) content and the cache quietly updates. Perfect for feeds, product pages, blog lists — where one-minute-stale is invisible but sub-second latency is felt. `stale-if-error` does the same when the origin is down, which turns an outage into "looks a little dated" instead of "502 everywhere".

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Freshness for 60s, then serve stale for up to 300s while revalidating.

## When You Must Purge (and When Not To)

Purge (invalidate) is a blunt, per-object operation you reserve for real need: a price changed, a security page updated, content deleted. Purging everything on every deploy is an anti-pattern — it turns your CDN into a stampede against origin (cache miss = every edge races the source at once, a **thundering herd**). Prefer:

1. **Versioned names** for cache-busting (never purge).
2. **Short TTL + SWR** for pages that just need to be roughly current.
3. **Targeted purge** for the few URLs that genuinely must drop now.

## Debugging Checklist

- **Why is my user seeing old content?** Check the cache key first — are you varying on something you forgot (user, device, cookie)? Then the TTL.
- **Why is origin getting hammered?** Cache key too specific, TTL too short, or you're purging globally.
- **Is anything actually cacheable?** If responses set `Cache-Control: private` or carry a `Set-Cookie`, edges won't store them.

A CDN is a distributed set of promises about freshness. Keep the cache key honest, match TTL to volatility, serve stale deliberately, and purge only when a human would notice the difference.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **CDN Caching in Plain Terms: TTL, Stale, and When to Purge** dalam konteks sebenar:

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