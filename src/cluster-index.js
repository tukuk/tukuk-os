const crypto = require('crypto');

/**
 * Indekskan HALAMAN HUB kluster geo ke dalam korpus carian sendiri.
 *
 * Masalah yang ditutup: indeks `halaman_web` diisi oleh crawler — ±32k dokumen
 * berita luar, tetapi hanya 97 dokumen tukuk.org (post blog, via blog-index.js).
 * 612 kluster geo kami (ratusan ribu halaman item + halaman hubnya) TIDAK ada
 * dalam indeks sama sekali. Akibatnya soalan yang halaman kami sendiri jawab
 * — "how many counties does California have" — pulang "I do not know", dan
 * /search untuk "california counties" mengeluarkan artikel berita kebakaran.
 *
 * Modul ini membina SATU dokumen per halaman hub terus daripada data yang
 * sudah dimuat di memori (tiada HTTP, tiada crawler, tiada kos CPU besar), dengan
 * id deterministik → idempotent; jalan berkali-kali tak hasilkan duplikat.
 *
 * Hanya HUB yang diindeks, bukan item: dokumen item (ratusan ribu) akan
 * melembungkan indeks pada VPS kecil, sedangkan hub sudah cukup untuk soalan
 * bilangan, keahlian dan kawasan ("puluhan county di California", "county di
 * Kenya", "gunung api di Indonesia").
 */

// Kluster besar (settlements ~puluhan ribu baris) jangan menghasilkan dokumen
// bersaiz megabait — nama di luar had ini masih boleh dibuka di halaman hub.
const NAME_CAP = 400;
// Senarai tally dipotong supaya dokumen tidak membesar mengikut bilangan negara.
const TALLY_CAP = 60;

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kira kemunculan nilai → pasangan [nama, bilangan] disusun turun. */
function tally(values) {
  const counts = new Map();
  for (const raw of values || []) {
    const key = String(raw || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

function formatTally(pairs) {
  return pairs.slice(0, TALLY_CAP)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ') + (pairs.length > TALLY_CAP ? `, +${pairs.length - TALLY_CAP} lagi` : '');
}

/**
 * Baris soal-jawab (FAQ) untuk padanan BM25.
 *
 * Meili mengira peraturan `words` dahulu: dokumen yang memuat LEBIH BANYAK
 * kata soalan akan mengatasi artikel blog yang cuma mengandungi "how" +
 * "many". Tanpa baris ini, soalan "how many counties does California have"
 * jatuh ke blog sains awam dan /ask menjawab "I do not know" — walaupun
 * halaman hub kami sendiri menulis fakta itu.
 */
function faqLines({ subject, unit, singular, count, top }) {
  const where = subject ? ` in ${subject}` : '';
  const lines = subject
    ? [
      `How many ${unit} does ${subject} have? ${subject} has ${count} ${unit}.`,
      `How many ${unit} are there${where}? There are ${count}.`,
      `Does ${subject} have ${count} ${unit}? Yes — the full list of every ${singular}${where} is on this page.`,
      `List of ${unit}${where} (${count} entries): names, country and region.`,
      // Baris BM — ayat Melayu penuh, tanpa campur kata sendi Inggeris.
      `Berapa banyak ${singular} di ${subject}? ${subject} mempunyai ${count} ${unit}.`
    ]
    : [
      `How many ${unit} are there in total? There are ${count} ${unit}.`,
      top ? `Which country has the most ${unit}? ${top}.` : '',
      `List of ${unit} worldwide (${count} entries): names, country and region.`
    ];
  return lines.filter(Boolean);
}

function hubToDoc(cluster) {
  const { base, cfg, mod, listKey } = cluster;
  const items = (mod && listKey && Array.isArray(mod[listKey])) ? mod[listKey] : [];
  if (!base || !cfg || items.length === 0) return null;

  const unit = cfg.unit || cfg.singular || 'entries';
  const countries = tally(items.map((i) => i.country));
  const regions = tally(items.map((i) => i.region));
  const intro = stripHtml(cfg.intro);
  const blurb = stripHtml(cfg.navBlurb);
  const seoDesc = stripHtml(cfg.seoDesc);

  const names = items.slice(0, NAME_CAP)
    .map((i) => String(i.name || i.wiki || '').trim())
    .filter(Boolean);

  // Yurisdiksi dibaca daripada titleCase ("Counties of California" →
  // "California"); kluster global tiada ekoran 'of' → guna soalan umum.
  const ofMatch = /^(.+?)\s+of\s+(.+)$/.exec(String(cfg.titleCase || '').trim());
  const subject = ofMatch ? ofMatch[2].trim() : '';
  const topCountry = countries.length && countries[0][1] > 1
    ? `${countries[0][0]} (${countries[0][1]} ${unit})` : '';

  const lines = [
    `${cfg.titleCase} — hub di tukuk.org/${base}.`,
    intro,
    blurb && blurb !== intro ? blurb : '',
    ...faqLines({ subject, unit, singular: cfg.singular || unit, count: items.length, top: topCountry }),
    `Total in this cluster: ${items.length} ${unit}.`,
    countries.length > 1 ? `By country: ${formatTally(countries)}.` : (countries[0] ? `Country: ${countries[0][0]} (${countries[0][1]}).` : ''),
    regions.length ? `By region: ${formatTally(regions)}.` : '',
    // Pemisah '; ' — nama item sudah mengandungi ekoran ', California'; koma
    // akan menjadikan senarai ini sukar dibaca model LLM.
    names.length ? `Names: ${names.join('; ')}${items.length > names.length ? ` (and ${items.length - names.length} more)` : ''}.` : '',
    seoDesc && seoDesc !== intro ? seoDesc : ''
  ].filter(Boolean);

  // Baris unik sahaja — banyak kluster berkongsi templat ayat yang sama.
  const content = [...new Set(lines)].join('\n');
  const id = crypto.createHash('sha256').update(`geo-hub:${base}`).digest('hex').slice(0, 16);
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

  return {
    id,
    url: `https://tukuk.org/${base}`,
    title: cfg.seoTitle || `${cfg.titleCase} — Tukuk-OS`,
    description: seoDesc || intro || `${items.length} ${unit} listed on tukuk.org/${base}.`,
    content,
    summary: seoDesc || intro || '',
    siteName: 'Tukuk-OS',
    host: 'tukuk.org',
    lang: 'en',
    type: 'cluster',
    section: cfg.titleCase || base,
    keywords: [...new Set([cfg.singular, unit, base.replace(/-/g, ' '), base.replace(/-/g, ' ').replace(/\bcounties?\b/, 'county'),
      ...countries.slice(0, 8).map(([name]) => name)])].filter(Boolean).slice(0, 20),
    headings: countries.slice(0, 20).map(([name]) => name),
    publishedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    crawledAt: new Date().toISOString(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    quality: 0.9,
    hash
  };
}

/**
 * Tolak semua dokumen hub ke index utama.
 * @param {object} index    Index Meilisearch (hibrida sebenar+mock) dari ensureIndex().
 * @param {Array}  clusters geoClusters() dari src/server.js — {base, cfg, mod, listKey}.
 * @param {object} opts     { logger, force }
 * @returns {Promise<{count:number, skipped:boolean, taskUid:*}>}
 */
async function indexGeoHubs(index, clusters, { logger = console, force = false } = {}) {
  const docs = (clusters || []).map(hubToDoc).filter(Boolean);
  if (!docs.length) return { count: 0, skipped: true, taskUid: null };

  // Pengesahan murah sebelum menolak: baca SEMUA hash dokumen `cluster` yang
  // sudah ada dalam indeks dan bandarkan sebagai multisets. Sentinel tunggal
  // (hub pertama) TIDAK cukup — sunting satu fail data (contohnya borough New
  // Jersey) mengubah hash satu dokumen sahaja, jadi indeks akan kekal lama
  // berisi data lama. Selepas pemulihan indeks dari R2 semakan ini gagal dan
  // dokumen ditolak semula.
  if (!force) {
    try {
      const found = await index.search('', {
        filter: 'type = "cluster"',
        limit: Math.min(docs.length, 1000),        // had paginasi Meilisearch
        attributesToRetrieve: ['hash']
      });
      const hits = (found && found.hits) || [];
      const total = found ? (found.estimatedTotalHits != null ? found.estimatedTotalHits : hits.length) : 0;
      const want = docs.map((d) => d.hash).sort();
      const got = hits.map((h) => h && h.hash).filter(Boolean).sort();
      // Set hanya boleh dibandingkan bila TIADA dokumen tercetus oleh had limit;
      // jika index besar daripada 1000 hub, kita tolak sahaja (sentiasa selamat).
      const unchanged = total === docs.length && want.length === docs.length &&
        got.length === want.length && want.every((h, i) => h === got[i]);
      if (unchanged) {
        if (logger && logger.log) logger.log(`[cluster-index] ${docs.length} hub kluster sudah dalam indeks — tiada perubahan`);
        return { count: docs.length, skipped: true, taskUid: null };
      }
    } catch { /* fail terbuka: tolak dokumen sahaja */ }
  }

  const task = await index.updateDocuments(docs);
  if (logger && logger.log) {
    logger.log(`[cluster-index] ${docs.length} hub kluster dihantar ke indeks utama (task ${task && task.taskUid ? task.taskUid : 'mock'})`);
  }
  return { count: docs.length, skipped: false, taskUid: task && task.taskUid ? task.taskUid : null };
}

module.exports = { hubToDoc, indexGeoHubs, stripHtml, tally, faqLines };
