SLUG: reverse-proxy-and-client-ips-explained
TITLE: Reverse Proxies and the Death of "Real" Client IPs
EXCERPT: Behind a proxy, CDN, or tunnel, `socket.remoteAddress` is the proxy — not the visitor. Everything from rate limits to geo to abuse reports goes wrong until you read the right header, and validate it.
TAGS: networking, proxy, headers, operations

## What a Reverse Proxy Does to Your View

A reverse proxy sits between the internet and your app. The browser talks to the proxy; the proxy talks to you. So the connection your server sees originates from the **proxy's IP**, every time. On a single machine behind one proxy, `req.socket.remoteAddress` is the same address for all traffic — useless for telling visitors apart.

The proxy therefore passes the original details in **forwarded headers**:

- `X-Forwarded-For: client, proxy1, proxy2` — a comma list, left-to-right, *appended by each hop*.
- `X-Forwarded-Proto` — the scheme the client actually used (fixes "is this HTTPS?" behind a TLS-terminating edge).
- `X-Forwarded-Host` / the `Host` you see — which the app uses for correct URLs and redirects.

Cloudflare also sets `CF-Connecting-IP` (a single value: the client it saw). That is usually the header you want when you sit behind Cloudflare — **not** the forgeable `X-Forwarded-For`.

```js
// trust only the hop you control, then read the leftmost XFF entry
app.set('trust proxy', 1);
const ip = req.headers['cf-connecting-ip'] || req.ip;
```

## The Trust Trap

Headers are attacker-controlled. If your code blindly takes `X-Forwarded-For[0]` as the client, anyone can spoof it — bypass rate limits, fake a geo, poison your logs. The rule:

- **Trust only proxies you own**, and only for *one* hop (or however many are genuinely in front of you).
- **Never accept a private/loopback client IP** that then gets used to reach internal services (see SSRF).
- Pick the right header for your edge: `CF-Connecting-IP` behind Cloudflare, the *leftmost* XFF entry behind a single known proxy.

Express's `trust proxy` setting exists for exactly this — set it to the number of hops, not `true` (which trusts everyone).

## Everything That Silently Breaks

- **Rate limiting keyed on the proxy IP** → the whole site shares one bucket, or one abusive key exhausts it for everyone. Fix the IP source, then limit per *real* client.
- **Redirect loops** — TLS ends at the proxy, your app sees `http`, issues an "https" redirect, the proxy sends `http` again… loop. Read `X-Forwarded-Proto`.
- **Audit logs / abuse reports** pointing at your CDN's datacenter, not the culprit.
- **Cookies marked `Secure` dropped** because the app thinks it's plain HTTP.

## A Small Checklist

1. Know your topology: is there **exactly one** proxy in front? Count the hops.
2. Set framework trust accordingly (`trust proxy` = hop count).
3. Read the provider's dedicated client-IP header when one exists.
4. Validate scheme from `X-Forwarded-Proto` for cookies, HSTS, and redirects.
5. Test with a request from a *known* remote IP and confirm it lands as that IP in logs — if not, your trust config is wrong.

Once your app agrees on *who the client actually is*, rate limits, geo, and logs all start agreeing with it too.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Reverse Proxies and the Death of "Real" Client IPs** dalam konteks sebenar:

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