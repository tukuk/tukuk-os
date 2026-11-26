SLUG: dns-over-https-explained
TITLE: DNS over HTTPS (DoH): When Your Resolver Starts Lying
EXCERPT: DNS over HTTPS encrypts domain lookups inside a normal HTTPS connection, which makes DNS poisoning and filtering far harder for anyone sitting between you and the truth.
TAGS: dns, doh, privacy, censorship

## The Weak Link in Every Connection

Before a browser can fetch anything, it asks a **DNS resolver**: *what address is `example.com`?* For decades that question travelled in clear text, in a protocol (UDP/53) that anyone on the path — a Wi-Fi operator, an ISP, a state filter — could observe, answer first, or simply refuse.

When the answer is forged, everything downstream still "works": the browser connects happily — to the wrong server, or to a reset. This is **DNS poisoning**, and it is also the simplest form of censorship: you do not need to block an IP if you can make the name disappear.

## What DoH Changes

**DNS over HTTPS** (RFC 8484) sends the same lookup as a POST inside an ordinary HTTPS session to a resolver that speaks DoH — typically `1.1.1.1`, `dns.google`, or your own.

The difference is structural:

- **Encryption** — an observer sees an HTTPS connection to a resolver domain, not the individual names you query.
- **Authentication** — TLS proves you are talking to the resolver you intended, not to an injector on the path.
- **Integrity** — forged responses fail certificate validation and are discarded.

For the censor, this raises the cost: instead of silently rewriting answers, they must now block the encrypted connection itself — which means blocking a major resolver's domain, with all the collateral damage that implies.

## Enabling It in a Browser

- **Firefox:** Settings → Privacy & Security → *DNS over HTTPS* → enable, then pick Cloudflare (1.1.1.1) or Google (dns.google).
- **Chrome/Edge:** Settings → Privacy and security → Security → *Use secure DNS*, choose a provider or enter a custom DoH URL.
- **Android 9+:** Settings → Network → Private DNS → hostname `one.one.one.one` or `dns.google` (this is DoT, the TLS-on-853 sibling of DoH — same threat model, different port).
- **iOS:** the 1.1.1.1 app, or per-app VPN profiles.

Once enabled, every lookup for every site in that browser rides the encrypted channel.

## Honest Limitations

DoH is a strong fix for *resolver integrity*, not a universal bypass:

- **IP-level blocking still works.** If a government filters `104.16.0.0/12` outright, your encrypted resolver answers correctly and the connection to the destination dies anyway.
- **SNI/ECH territory.** The TLS handshake can still reveal the destination hostname to a network observer — a different layer, addressed by different tools (ECH, or a VPN, or Tor).
- **Your DoH provider sees everything.** Trading your ISP for Cloudflare or Google is a privacy trade, not an anonymity guarantee.
- **Whole-resolver blocking is possible** — adversaries can block `cloudflare-dns.com` by name. Alternate resolvers and DoT endpoints exist for exactly this reason.

## When It Saves You

DoH shines in the common, low-drama case: a hotel Wi-Fi hijacking answers, a mobile carrier returning carrier-portal IPs, or a regional filter editing DNS records on the fly. Encrypted resolution removes that whole class of interference in a five-minute settings change.

Pair it with the rest of the toolbox — an `Onion-Location` mirror for blocked domains, a backup domain for blocked edges — and DNS stops being the weakest link in the chain.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **DNS over HTTPS (DoH): When Your Resolver Starts Lying** dalam konteks sebenar:

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