SLUG: panduan-nginx-reverse-proxy-dengan-cloudflare
TITLE: Nginx as a Reverse Proxy Behind Cloudflare: A Practical Guide
EXCERPT: Learn how to set up Nginx as a reverse proxy behind Cloudflare, covering base config, proxy headers, SSL, and real client IP verification.
TAGS: nginx, cloudflare, reverse proxy, devops

## Introduction

When a site is served through Cloudflare, traffic no longer arrives directly at your server. It passes through the Cloudflare network first, then reconnects to your application server through a **reverse proxy**. Nginx most often plays that role because it is stable, lightweight, and easy to configure.

Yet this two-layer arrangement creates its own challenges: the visitor's real IP is hidden, HTTPS stacks sit on top of each other, and headers must be translated correctly. A small mistake here causes pages not to load, certificates not to be trusted, or logs showing every request coming from a Cloudflare address.

## Setting Up Nginx as a Reverse Proxy

The basic Nginx configuration block for this scenario usually lives in a virtual host file. The **proxy_pass** directive forwards every request to your application, for example to port 3000 on localhost or to a Docker service name.

It is essential to set all **proxy headers** completely. The Host header must carry the original domain name so the application knows which domain was requested. Headers such as X-Real-IP and X-Forwarded-For carry the visitor address, while **X-Forwarded-Proto** tells the application whether the original connection used HTTPS. Without them your app may generate HTTP links in an environment that should be HTTPS.

Inside a location / block you normally set longer read timeouts, enable the HTTP to HTTPS redirect, and allow only the required methods. Avoid mixing several sites in one location block without host filtering, because that invites request misrouting.

## SSL Encryption and Traffic Origin

There are two approaches to the Cloudflare-to-Nginx connection. The easiest is setting Full (strict) mode in Cloudflare and installing a TLS certificate on your Nginx itself. You then get two layers of encryption: visitor to Cloudflare, and Cloudflare to your server.

The second approach allows origin traffic on port 80 only and blocks everything else at the firewall. That avoids certificate complexity, but it is only safe if your network is genuinely closed off.

To recover the real client address, never blindly trust the X-Forwarded-For header. It can be forged by anyone reaching your server directly. Instead, load Cloudflare's official IP ranges, update them automatically, and use those addresses to verify traffic genuinely comes from their network.

### Cache, Gzip and Timeouts

Even though Cloudflare offers edge caching, Nginx is still useful for local caching of requests that cannot be stored at the edge. Enable **cache** for static assets with a sensible duration, and let Cloudflare handle global delivery.

Text compression such as gzip or brotli should always be on, because it reduces the bytes crossing two connection layers. Finally, align timeouts on both sides: the Cloudflare timeout should not be shorter than the Nginx timeout, otherwise connections drop mid-flight just as your application finishes responding.

## Common Mistakes

- Blocking port 80 entirely before swapping certificates, so HTTP-01 validation fails.
- Setting the wrong hostname in the Host header, making the application return 404 even though the page exists.
- Stacking multiple proxy layers without checking redirect limits, producing endless redirect loops.
- Letting Nginx logs record only Cloudflare addresses, which ruins traffic analysis and abuse blocking.
- Forgetting longer read timeouts for heavy requests while Cloudflare has already cut the connection at its own limit.

## Practical Configuration Steps

1. Install Nginx and test the local configuration before pointing the domain through Cloudflare.
2. Set proxy_pass to your application, including Host, X-Real-IP, X-Forwarded-For, and X-Forwarded-Proto.
3. Enable HTTPS on the Nginx side, then set Full (strict) in Cloudflare's SSL settings.
4. Load Cloudflare's IP ranges and reject traffic that claims the headers but arrives from outside them.
5. Test from outside: confirm the page loads, links stay HTTPS, and logs show the real visitor IP.
6. Track certificates on both layers in your calendar; a hidden expiry is usually found only when users report errors.

For repeatable installs and consistent configuration templates, some system providers such as **Tukuk-OS** ship built-in modules for traffic blocking based on automatically updated IP ranges, so you do not have to manage download scripts yourself.

## Conclusion

A reverse proxy behind Cloudflare brings major benefits in attack filtering and caching, but it demands careful configuration. Keep proxy headers complete, SSL consistent across both layers, and origin verification based on real IP ranges. Done right, Nginx stays a thin transparent layer — with all its complexity sitting exactly where it belongs.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Nginx as a Reverse Proxy Behind Cloudflare: A Practical Guide** dalam konteks sebenar:

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