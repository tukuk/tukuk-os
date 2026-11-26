SLUG: oauth-vs-api-keys-what-to-use-when
TITLE: OAuth, API Keys, or a Shared Secret? Choosing Auth Without Overthinking
EXCERPT: These three are not interchangeable. Picking the wrong one is how you end up with a "simple" key that can act as any user, or an OAuth flow guarding a single service account.
TAGS: auth, oauth, api-keys, security

## The Three Things People Confuse

- **API key** — a static string that says *"this caller"*. Best for machine-to-machine, one identity, coarse scoping.
- **OAuth (access token)** — a short-lived token that says *"this user, granted these scopes, for a little while"*. Best when you act *on behalf of* someone.
- **Shared secret / HMAC signature** — proves a request was forged by a holder of the secret, without sending the secret. Best for webhooks and integrity.

The mistake is treating them as three sizes of the same jacket.

## When an API Key Is Right

You run a search index. Another server needs to push documents. There is no "user", the caller is fixed, and you want it dead simple. A key in an `Authorization: Bearer` header (never a query param — query strings leak into logs and referrers), scoped and rotatable, is fine.

Keys go wrong when: they never expire, everyone shares one, they sit in a URL, or they carry *more* privilege than the caller needs.

```bash
# good: header, scoped, rotatable
curl -H "Authorization: Bearer $TUKUK_WRITE_KEY" https://api.example.com/documents
```

## When You Actually Need OAuth

If a user says *"let this app read my stuff"*, and the app should never see the user's password — that is OAuth. The **authorization-code flow** (with **PKCE** for anything that can't keep a secret, like a browser or mobile app) hands you a scoped, expiring access token plus a refresh token. The cost is real: you now deal with redirects, token storage, rotation, and scope creep.

Do not build an OAuth *provider* unless you are an identity platform. Consuming one? Use a maintained library.

## Webhooks: Sign, Don't Just Send a Key

For a webhook, the receiving side must prove the call is genuinely from you. A plain key proves nothing if it leaks. **HMAC-sign the raw body** with a shared secret and send the signature in a header; the receiver recomputes it over the *exact bytes received* (order and whitespace matter) and rejects mismatches. Add a timestamp and a small replay window.

## The Boring Rules That Prevent Most Incidents

1. **Least scope.** A key that can do everything is an incident waiting for one leak.
2. **Rotate.** Anything static should have a rotation path that does not require a deploy.
3. **No secrets in URLs, git, or client bundles.** If it shipped to the browser, it is public.
4. **Expire and revoke.** Prefer tokens you can kill over strings you must hunt down.
5. **Log the identity, not the credential.** Record *which key/user* acted, never the secret itself.

Match the mechanism to the question you are really asking — *"who is calling?"* (key), *"on whose behalf, and how much?"* (OAuth), *"is this intact and truly from you?"* (HMAC). Once that click fits, the rest is hygiene.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **OAuth, API Keys, or a Shared Secret? Choosing Auth Without Overthinking** dalam konteks sebenar:

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