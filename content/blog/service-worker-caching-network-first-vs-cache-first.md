SLUG: service-worker-caching-network-first-vs-cache-first
TITLE: Service Worker Caching: The Night Cache-First Served the Wrong Page
EXCERPT: A service worker that cached every navigation served users stale — and sometimes wrong — HTML for hours; network-first for navigations fixed it without giving up speed.
TAGS: service worker, pwa, caching, performance

## The Bug Nobody Saw in Development

The site looked perfect on our machines. Users reported something stranger: occasional pages that were *almost* right — old layouts, missing features, sometimes content from a different section entirely.

The cause was our service worker. Its fetch handler treated **every** request the same way: return from cache if present, fetch in the background, update the cache for next time. Fast, offline-friendly — and, for HTML documents, wrong.

## Why Cache-First Breaks Navigation

A service worker's strategy choices are per-resource-class, and they exist for a reason:

- **Cache-first** suits immutable assets: hashed JS bundles, fonts, images. The URL changes when the content changes, so a cached copy is always valid.
- **Network-first** suits HTML: the document is the *entry point* that references those assets. Serving a stale document can reference old JS, run old logic, and override the fresh experience the user asked for.
- **Stale-while-revalidate** is a compromise — but for navigation it still flashes the old page first, which is exactly the confusion users reported.

Worse, our worker cached the *first* HTML it ever saw. Search pages are generated client-side from that one document, so a user who arrived before a feature launch kept the pre-launch document through every search, every tab switch, every reload — until a full cache eviction.

## The Fix

We split by request type:

```js
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    // Pages: always try the network, fall back to cache offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }
  if (new URL(req.url).origin === location.origin) {
    // Same-origin static assets: cache-first is fine.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }
  // Cross-origin: leave alone.
});
```

Plus two supporting changes:

1. **A cache version bump** (`tukuk-os-v1` → `v2`) with deletion of old caches on activate — otherwise users keep the old cache forever.
2. **`Cache-Control: no-cache` on HTML and `no-store` on the service worker script itself** — so HTTP caching cannot reintroduce staleness beneath the worker.

## The Verification Habit

After the fix we stopped trusting screenshots and checked what the server actually delivered: response headers via `curl`, access logs during real user sessions, and byte-comparison of the served document against the deployed one. The server never lied; our test browser had simply been showing a blessed cache.

## Rules of Thumb

- Navigations: **network-first** (with offline fallback).
- Hashed assets: **cache-first**.
- The service worker script: **never cached**.
- HTML from HTTP: **revalidate every time**.
- Bump your cache version in the same commit as any behaviour change.

Speed and freshness are not opposites — they are different strategies for different classes of file, and the class you must never cache-first is the one that decides everything else.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Service Worker Caching: The Night Cache-First Served the Wrong Page** dalam konteks sebenar:

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