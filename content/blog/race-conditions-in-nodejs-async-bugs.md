SLUG: race-conditions-in-nodejs-async-bugs
TITLE: Race Conditions in Node.js: The Bugs That Only Happen Under Load
EXCERPT: Your code works in testing and fails in production because two requests arrived 40 milliseconds apart — here are the async patterns that cause it and how to close the windows.
TAGS: nodejs, async, bugs, concurrency

## What a Race Condition Actually Is

A race condition is not a crash — it is **two operations whose correctness depends on order, in a system that does not guarantee order**. The code reads a value, decides something, and acts — while another operation changes that value in between. On your laptop, with one user, the window never opens. Under load, it opens constantly.

Node's single thread lulls people into thinking races cannot happen. The thread is singular; **time is not**. Every `await` is a yield point where another request gets to run.

## Pattern 1: Read-Modify-Write

```js
// BROKEN: two requests can both read count=41 before either writes
const row = await db.get('stats');
row.count += 1;
await db.set('stats', row);
```

Both requests read `41`, both write `42` — one increment lost. It will pass every test you write for one user.

**Fixes, in order of preference:**

1. **Atomic operation**: `await db.incr('stats', 1)` — one command, server-side.
2. **Transaction with locking**: `BEGIN; SELECT ... FOR UPDATE; UPDATE; COMMIT`.
3. **Serialize in-process**: a promise queue for that key (works only while you have one process).

The mental rule: **any `get` followed by a `set` derived from the `get` is a candidate.**

## Pattern 2: The Overlapping Job

```js
// BROKEN: two timer ticks rebuild the index at once
async function rebuildIndex() {
  const docs = await collectDocs();
  await index.replaceAll(docs);   // tick 2 starts before tick 1 finishes
}
```

Two rebuilds interleave; the index ends up half-old, half-new — or throws on a constraint. Fixes: an `inProgress` boolean guard, a proper mutex, or a job queue that coalesces ("if a rebuild is queued, don't queue another").

Guard code must itself be atomic within the event loop:

```js
let rebuilding = false;
async function rebuildIndex() {
  if (rebuilding) return;
  rebuilding = true;
  try { /* ... */ } finally { rebuilding = false; }
}
```

The `try/finally` matters — one unhandled rejection without it leaves the flag stuck and the feature dead until restart.

## Pattern 3: Promise Left on the Table

```js
// BUG: the promise floats — errors vanish, order not guaranteed
doBackup();          // no await, no .catch
await handleRequest();
```

Floating promises reorder side effects and **swallow failures silently**. If you mean "do it later", say so: `void doBackup().catch(log)`. If you mean "do it now", `await` it. The absence of `await` should never be an accident.

## Pattern 4: Check-Then-Act Across Requests

```js
if (!await cache.has(key)) {          // request A passes
  const data = await expensiveFetch(); // A and B both fetch
  await cache.set(key, data);          // duplicated work
}
```

Wasted work, duplicated side effects. Fixes: single-flight caching (share the in-flight promise per key), or accept the duplication if it is harmless and cheap.

## Pattern 5: Filesystem Order

Watching a directory while writing into it: the watcher fires while the write is half-done, downstream processes read a truncated file. **Write to a temp name, then `fs.rename`** — atomic on the same filesystem. Every half-written config, index, and backup in the wild came from skipping this.

## How to Hunt Them

- **Load-test with concurrency** — `hey -n 200 -c 20 'https://yoursite/search?q=x'` while watching logs for interleaved job markers.
- **Log the timestamps and ids** of each phase (`job started / read / wrote`) — races are obvious in interleaved logs and invisible in code review.
- **Restart tests**: kill the process mid-operation and see if state survives (another flavour of the same window).
- **Add a deliberate delay** (`await sleep(50)`) inside the suspect window during testing — if the bug becomes trivial to reproduce, you have found the race.

## The Discipline

Every bug of this class is a sentence with a hidden "and nothing else happens in between". Your job is to make that sentence true: atomic operations, locks, queues, or ordering guarantees — chosen deliberately, never by accident of timing.

Node runs your code between other people's requests. Write as if every `await` is a door that someone else can walk through, because it is.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Race Conditions in Node.js: The Bugs That Only Happen Under Load** dalam konteks sebenar:

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