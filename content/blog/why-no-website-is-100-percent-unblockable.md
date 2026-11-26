SLUG: why-no-website-is-100-percent-unblockable
TITLE: Why No Website Can Be 100% Unblockable (And What to Do About It)
EXCERPT: Any government can filter a domain, an IP, or a TLS fingerprint — the realistic goal is not invulnerability but redundancy: several independent doors to the same content.
TAGS: censorship, resilience, tor, access

## The Honest Starting Point

Every few months someone claims their project is "impossible to block." It is not, and understanding why is the first step to building something genuinely resilient.

A network operator controls the pipe. They can drop packets to an IP range, refuse DNS answers, reset TLS handshakes after reading the Server Name Indication, throttle a fingerprint, or lean on the certificate authority and hosting provider until the site has nowhere to live. **Any single channel can be closed by anyone with enough authority over the network path.**

## The Blocking Toolkit (From the Other Side)

Worth knowing what you are up against:

| Layer | Technique | Your defence |
|---|---|---|
| DNS | Poisoning, NXDOMAIN injection | DNS over HTTPS / DoT |
| IP | Range filtering, RST injection | Alternate hosts, CDNs, anycast |
| SNI/TLS | Handshake inspection, blocking by hostname | ECH, domain fronting (rare), onion services |
| Domain | Court order to registrar, DNS removal | Mirror domains, `.onion` (no registrar) |
| Protocol | Blocking Tor, VPNs, obfs protocols | Pluggable bridges, Snowflake, WebTunnel |
| Application | App-store removal, provider pressure | Web versions, self-hosted copies |

Notice the pattern: **every defence is countered by a deeper control, and vice versa.** This is not a war with a winner; it is a cost calculation.

## The Realistic Goal: Redundancy

What you *can* build is a site where closing one door does not close the site:

1. **Anycast main domain** — a CDN presence in hundreds of cities; blocking one region's edge does nothing elsewhere.
2. **A Tor onion service** — no registrable domain, no exposed origin IP; reachable wherever Tor is.
3. **A mirror on a separate domain** — a different registrable name, ideally on a different provider.
4. **Encrypted DNS guidance** — so users can still resolve you when classic DNS lies.
5. **Published instructions** — a page telling users exactly how to use each door, discoverable *before* the block.

Each door is imperfect. Together they force the censor to take increasingly visible, increasingly expensive action — blocking Tor bridges wholesale, ordering every CDN, chasing every mirror — and each of those actions has political and economic costs that a silent DNS edit does not.

## Content Changes the Calculus Too

Blocks are easier to justify — and to enforce quietly — when the material is genuinely unlawful. **Original writing, public-source data, and a real contact channel** remove the easy pretext. It does not make you unblockable; it makes blocking you an openly political act rather than a routine takedown, and those are harder to sustain.

## What to Tell Your Users

Be honest in public: *if one path fails, try the next.* A site that promises invulnerability and then disappears teaches people to give up. A site that publishes three doors and instructions keeps working for the users who bother to try door number two.

Redundancy is not a marketing claim. It is a checklist — and it is something you can actually finish.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Why No Website Can Be 100% Unblockable (And What to Do About It)** dalam konteks sebenar:

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