SLUG: tor-onion-services-for-websites
TITLE: Tor Onion Services for Websites: Hiding Your Server in Plain Sight
EXCERPT: An onion service lets visitors reach your website through the Tor network without your server exposing any IP address — a practical alternative when domains get blocked.
TAGS: tor, onion services, privacy, censorship

## What an Onion Service Actually Is

A normal website resolves a domain to an IP address, opens a TCP connection, and serves content. An **onion service** flips that model: the server publishes a public key-derived address ending in `.onion`, and traffic arrives through an encrypted circuit inside the **Tor network** — never touching the normal internet as an inbound connection.

The address is not a DNS name. It is a base32 encoding of the service's public key, so nobody can register `yourname.onion` against you, and no certificate authority is involved. The address *is* the identity.

## Why Sites Bother

There are three practical reasons:

- **Reachability** — if your clearnet domain is blocked by a national network or an ISP, the onion address usually still works wherever Tor works.
- **Origin privacy** — your hosting server never reveals its IP to visitors. Scouts scanning IPv4 space will not find you.
- **No DNS dependency** — poisoned or filtered DNS cannot break an address that never uses DNS.

For a small site, the cost is a config file and a reverse proxy. For an operator under pressure, the benefit can be the difference between being reachable and being gone.

## How It Works in Practice

Tor exposes three settings that matter to a web operator:

- `HiddenServiceDir` — a directory holding the service's private key and generated hostname.
- `HiddenServicePort` — maps the onion address to a local port, typically `127.0.0.1:8000` where your real application listens.
- The `hostname` file — the `.onion` address you publish to visitors.

Your application keeps running unchanged behind localhost. Tor becomes the front door; the origin never sees a direct socket from the visitor.

The service does not even need a publicly routable IP. A server behind NAT, on a home connection, or inside a restrictive datacenter can publish an onion service, because all outbound connections are made *by Tor*, not inbound ones.

## The Caveats Worth Knowing

An onion service does not make you invulnerable:

- **Tor itself may be blocked.** Many censored networks filter Tor's entry guards. The answer is **pluggable bridges** (obfs4, Snowflake) on the client side.
- **`.onion` requires Tor.** Regular browsers cannot open it, so you should keep a clearnet entry too and invite Tor users automatically (see the `Onion-Location` header).
- **Metadata still leaks.** If the page content names you, the service only hides the transport, not the author.
- **No magical anonymity for the visitor.** Tor protects the circuit; the site can still see what you send it.

## A Minimal Checklist

1. Run Tor with a dedicated `HiddenServiceDir` (permissions `0700`).
2. Point `HiddenServicePort 80 127.0.0.1:<app-port>` at your app.
3. Publish the hostname from the `hostname` file.
4. Test with `curl --socks5-hostname 127.0.0.1:9050 http://<your-onion>/` from a Tor-enabled host.
5. Add an `Onion-Location` header on your clearnet site so Tor Browser offers the onion version automatically.

Keep both doors open: the clearnet domain for the everyday web, the onion address for when the everyday web says no.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Tor Onion Services for Websites: Hiding Your Server in Plain Sight** dalam konteks sebenar:

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