SLUG: off-by-one-and-common-logic-bugs
TITLE: Off-by-One and the Nine Other Logic Bugs You Will Write This Year
EXCERPT: The most expensive bugs are rarely exotic — they are fences, loops, boundaries, and boolean mistakes that pass every happy-path test ever written.
TAGS: bugs, algorithms, testing, code quality

## The Family Portrait

Syntax errors die at compile time. Type errors die in the type checker. **Logic bugs are the only ones that ship** — they compile, they run, they return plausible answers, and they are wrong. Here is the roster, with the version of you that writes each one.

## 1. Off-by-One

```js
for (let i = 0; i <= arr.length; i++) {}   // walks one past the end
```

`<` vs `<=`, `length - 1` vs `length`, inclusive vs exclusive bounds. The fencepost problem is 4,000 years old (it predates programming — sheep enclosures had it). Defences: prefer `slice(0, n)` over index math; test with **arrays of length 0 and 1**, where every boundary bug screams.

## 2. Empty Input Is Never Tested

`null`, `""`, `[]`, `{}` — the happy path has a door that most test suites walk past. One classic: a parser that loops `while (next())` exits immediately on empty input and returns *success* with no data — callers interpret "success" as "valid but nothing found" instead of "malformed input".

## 3. Float Arithmetic

```js
0.1 + 0.2 === 0.30000000000000004   // true, unfortunately
```

Money in floats is the industry's longest-running joke. Integer minor units, a decimal library, or accept the fuzz and compare with epsilon — but never `===` on computed floats.

## 4. The Negated Condition That Isn't

```js
if (status !== 'ok' || status !== 'ready') { /* always true */ }
```

`||` where `&&` belongs. It is always true, so the guard "protects" everything — usually failing open or closed in the most expensive direction. Read it aloud as English: "not ok **or** not ready" — everything is at least one of those.

## 5. Mutating While Iterating

```js
for (const x of list) if (bad(x)) list.splice(i, 1);
```

Removals shift indices; elements after the removal skip their check. Fix: `list = list.filter(keep)` or iterate backwards. In JS, `for...of` plus `splice` is a classic double-skip generator.

## 6. Default That Destroys

Destructuring defaults trigger on `undefined`, not on empty values:

```js
function draw(limit = 20) { ... }
draw(null);   // limit = null, not 20
```

Query strings are full of `?limit=` — which arrives as `""`. Normalise at the boundary: parse, validate, clamp; never trust the default to rescue you.

## 7. Comparing Wrong Things

Loose equality (`==`) with `0`/`""`/`null`, comparing object references instead of ids, comparing strings that look numeric (`"10" < "9"` is `false` — lexicographic). One rule removes an entire class: **compare like types, derived from one place.**

## 8. Stale Closure Captures

```js
items.forEach((item) => setTimeout(() => process(item), 1000));
```

Looks fine — but if `item` is reassigned in an outer `let`, every timer processes the final value. Closures capture *variables*, not values. Usually harmless; when it fires, it processes the wrong thing a thousand times in a row, and only in production.

## 9. Early Return That Skips Cleanup

A guard clause `return` before `release()`, `unlock()`, or `finally` — the resource leaks on exactly the error path where the resource mattered most. This is why `try/finally` exists: put cleanup where the *failure* lands, not where success lands.

## 10. The Silent Catch

```js
try { await risky(); } catch { /* ignore */ }
```

The bug is now invisible *and* unmeasured. At minimum log it with context. Better: decide explicitly what recovery means — retry, degrade, or fail the request — because "ignore" is rarely a decision anyone made.

## The Meta-Defence

Every item above dies to the same three habits:

1. **Test the boundaries** — zero, one, empty, max, null — not just the typical case.
2. **Make invalid states unrepresentable** — parse once at the edge, pass typed values inward.
3. **Read your conditions aloud** — half of all boolean bugs confess in English before they ever run.

Boring bugs eat the hours. Learn the twelve shapes, and you start seeing them in review instead of in production.

---

## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **Off-by-One and the Nine Other Logic Bugs You Will Write This Year** dalam konteks sebenar:

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