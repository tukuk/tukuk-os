SLUG: monitoring-uptime-for-free
TITLE: Monitoring Uptime for Free: Health Checks, Timers, and Honest Alerts
EXCERPT: Your site being down is fine as long as you are the first to know — a health endpoint, an external checker, and a watchdog timer cover almost every small-project need.
TAGS: monitoring, uptime, operations, systemd

## The Only Question Monitoring Answers First

Not dashboards, not metrics oceans — **is it up right now, and did I find out before a user did?** Everything else is a luxury; that one answer is the product.

## Layer 1: A Health Endpoint Your Own Code Owns

```js
app.get('/health', async (req, res) => {
  const checks = {
    ok: true,
    uptime: Math.round(process.uptime()),
    search: await searchPing(),   // can we reach the search index?
  };
  res.status(checks.ok ? 200 : 503).json(checks);
});
```

Rules that make it useful:

- **Check dependencies, not just the process.** A server that answers `200` while its search index is unreachable is lying.
- **Return `503` when degraded** — monitoring tools trust status codes, not JSON prose.
- **Keep it fast** (<100ms) — it will be called every minute from three places.

## Layer 2: Ask From Outside

A local `curl` proves the process runs; it does not prove the internet reaches you. External checks catch DNS failures, certificate expiry, and edge-provider outages:

- **UptimeRobot / BetterStack / Healthchecks.io** — free tiers run checks every 1–5 minutes from multiple regions and alert by email/Telegram.
- **A cron of `curl -sf https://yoursite.example/health`** from a *different* machine (or a cheap VPS, or an email-driven ping service) if you refuse third parties.

Test the alert path deliberately: kill the service, confirm the message arrives, restart it. An untested alert is a decoration.

## Layer 3: A Watchdog at Home

External services check *you*. A local watchdog checks your *recovery*:

```ini
# systemd user unit, OnFailure= a restart unit
# or simply:
[Service]
Restart=on-failure
RestartSec=5
```

systemd gives you restart-on-crash, a journal, and `systemctl status` for free — for the app, the search daemon, and any timer you run. For subtler failures (process alive but answering garbage), add a watchdog script that curls `/health`, and restarts on repeated non-200s.

## Layer 4: The Metrics Worth a Graph

Three numbers catch most regressions on a small site:

1. **Response time** p95 per route — the user's actual experience.
2. **Error rate** (5xx / total) — correctness over time.
3. **Zero-result search ratio** — quality of the index, and an early spam signal.

Log lines feed them cheaply: one JSON per request, aggregated later. Only build more once these three stop surprising you.

## Alert Hygiene

- **Alert on symptoms users feel**, not on internals you can fix calmly (disk at 70% is a task; p95 at 6s is a page).
- **One channel, deduplicated.** Five noisy channels become one ignored channel.
- **Every alert needs a runbook line**: what to check first, what is safe to restart. If nobody knows the first step, the alert is theatre.

## The Honest Minimum

If you do nothing else: `/health` that checks dependencies, one external checker with a tested alert, and `Restart=on-failure` on every unit. That stack is free, takes an afternoon, and it is the difference between "our users told us it was down" and "we told our users first".

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Monitoring Uptime for Free: Health Checks, Timers, and Honest Alerts** dalam konteks sebenar:

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