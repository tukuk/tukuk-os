const crypto = require('crypto');

/**
 * Index the GEO CLUSTER HUB pages into our own search corpus.
 *
 * Gap this closes: the `halaman_web` index is filled by the crawler — roughly
 * 32k external news documents, but only 97 tukuk.org documents (blog posts,
 * via blog-index.js). Our 610 geo clusters (hundreds of thousands of item
 * pages plus their hub pages) were NOT in the index at all. So questions that
 * our own pages answer — "how many counties does California have" — returned
 * "I do not know", and /search for "california counties" surfaced fire-news
 * articles instead.
 *
 * This module builds ONE document per hub page straight from the data already
 * held in memory (no HTTP, no crawler, no big CPU cost), with a deterministic
 * id → idempotent; running it repeatedly never creates duplicates.
 *
 * Only HUBS are indexed, not items: item documents (hundreds of thousands)
 * would bloat the index on a small VPS, while a hub already covers counting,
 * membership and region questions ("how many counties in California",
 * "counties in Kenya", "volcanoes in Indonesia").
 */

// Big clusters (settlements: tens of thousands of rows) must not produce
// megabyte-sized documents — names beyond this cap are still openable on the hub page.
const NAME_CAP = 400;
// Tally lists are trimmed so the document does not grow with the number of countries.
const TALLY_CAP = 60;

/**
 * What a section front door is worth when two documents matched a query equally well — the
 * `quality:desc` rule in src/meili.js. The scale, highest first: a front door (0.98), our blog
 * posts (0.95), a data hub (0.9, below), and a page we merely crawled (0.5, CRAWLED_QUALITY).
 * A front door wins its own name with that: "weather" is a page here, so the page comes first
 * and not a third-party article about the weather.
 */
const SECTION_QUALITY = 0.98;

// Query aliases in the world's other languages for geo hubs whose English documents
// a Malay, Spanish or French visitor cannot match with the words they type. They go
// into `keywords` only — the English-only rule (test/section-hubs.test.js) protects
// the prose, not the search vocabulary, and tukuk.org is read in every language.
const HUB_ALIASES = {
  islands: ['pulau', 'pulaupulau', 'pulau jepun', 'jepun', 'how many islands are there', 'number of islands in japan', 'isla', 'isole', 'insel'],
  mountains: ['gunung', 'how many mountains', 'montaña', 'berg'],
  rivers: ['sungai', 'rio', 'fleuve', 'fluss'],
  countries: ['berapa banyak negara di dunia', '¿cuántos países hay en el mundo?', 'combien de pays dans le monde'],
};

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

/** Count occurrences of a value → [name, count] pairs sorted descending. */
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
    .join(', ') + (pairs.length > TALLY_CAP ? `, +${pairs.length - TALLY_CAP} more` : '');
}

/**
 * Question–answer (FAQ) lines for BM25 matching.
 *
 * Meili applies the `words` rule first: a document carrying MORE question
 * words outranks a blog post that merely mentions "how" + "many". Without
 * these lines, "how many counties does California have" fell to a public
 * science blog and /ask answered "I do not know" — even though our own hub
 * page states the fact.
 *
 * English only, like the rest of the corpus: this text is what the model reads
 * back, so a second language here would put it on every answer we publish.
 */
function faqLines({ subject, unit, singular, count, top }) {
  const where = subject ? ` in ${subject}` : '';
  const lines = subject
    ? [
      `How many ${unit} does ${subject} have? ${subject} has ${count} ${unit}.`,
      `How many ${unit} are there${where}? There are ${count}.`,
      // "listed" is how people phrase the same question, and it is not a stop-word: measured,
      // "how many caves are there listed" returned campsites and an MDN page, because `words`
      // ranks documents that also contain that word above ours.
      `How many ${unit} are listed${where}? ${count} ${unit} are listed on this page.`,
      `Does ${subject} have ${count} ${unit}? Yes — the full list of every ${singular}${where} is on this page.`,
      `List of ${unit}${where} (${count} entries): names, country and region.`,
    ]
    : [
      `How many ${unit} are there in total? There are ${count} ${unit}.`,
      `How many ${unit} are listed here? ${count} ${unit} are listed on this page.`,
      top ? `Which country has the most ${unit}? ${top}.` : '',
      `List of ${unit} worldwide (${count} entries): names, country and region.`,
      // Meili has no stemming ('bay' ≠ 'bays'), so the singular gets its own line.
      `Every ${singular} on this page lists its country and region.`,
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

  // Jurisdiction is read from titleCase ("Counties of California" →
  // "California"); global clusters leave no 'of' trace → use the general question.
  const ofMatch = /^(.+?)\s+of\s+(.+)$/.exec(String(cfg.titleCase || '').trim());
  const subject = ofMatch ? ofMatch[2].trim() : '';
  // "Unknown" is where an item's country was never recorded, not a country — 2,585 islands carry
  // it, and quoting that as "Unknown has the most islands" is worse than saying nothing.
  const topCountry = countries.length && countries[0][1] > 1 && countries[0][0] !== 'Unknown'
    ? `${countries[0][0]} (${countries[0][1]} ${unit})` : '';

  const lines = [
    `${cfg.titleCase} — hub at tukuk.org/${base}.`,
    // FACTS FIRST, prose after. `/ask` truncates content to
    // `BRAIN_SNIPPET_CHARS` (450 chars on the server) starting from the BEGINNING
    // of the document — a long intro pushes the FAQ lines outside the window and
    // an honest cloud model answers "I don't know" even though we wrote the fact.
    // This ordering does not affect BM25 (word counts are position-independent).
    ...faqLines({ subject, unit, singular: cfg.singular || unit, count: items.length, top: topCountry }),
    `Total in this cluster: ${items.length} ${unit}.`,
    intro,
    blurb && blurb !== intro ? blurb : '',
    countries.length > 1 ? `By country: ${formatTally(countries)}.` : (countries[0] ? `Country: ${countries[0][0]} (${countries[0][1]}).` : ''),
    regions.length ? `By region: ${formatTally(regions)}.` : '',
    // Separator '; ' — item names already carry a ', California' suffix; commas
    // would make this list hard for the LLM to read.
    names.length ? `Names: ${names.join('; ')}${items.length > names.length ? ` (and ${items.length - names.length} more)` : ''}.` : '',
    seoDesc && seoDesc !== intro ? seoDesc : ''
  ].filter(Boolean);

  // Unique lines only — many clusters share the same sentence template.
  const content = [...new Set(lines)].join('\n');
  const id = crypto.createHash('sha256').update(`geo-hub:${base}`).digest('hex').slice(0, 16);
  // HUB_ALIASES first so they survive the 20-keyword slice below.
  const keywords = [...new Set([cfg.singular, unit, base.replace(/-/g, ' '), base.replace(/-/g, ' ').replace(/\bcounties?\b/, 'county'),
    ...(HUB_ALIASES[base] || []),
    ...countries.slice(0, 8).map(([name]) => name)])].filter(Boolean).slice(0, 20);
  // Keywords join the hash: the multiset guard in indexGeoHubs compares this value,
  // so an edit to HUB_ALIASES alone (no prose change) must still trigger a re-push —
  // otherwise the aliases would sit in the code and never reach Meilisearch.
  const hash = crypto.createHash('sha256').update(content + '\n' + JSON.stringify(keywords)).digest('hex').slice(0, 16);

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
    keywords,
    headings: countries.slice(0, 20).map(([name]) => name),
    publishedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    crawledAt: new Date().toISOString(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    quality: 0.9,
    hash
  };
}

/**
 * Push every hub document into the main index.
 * @param {object} index    Meilisearch index (real+mock hybrid) from ensureIndex().
 * @param {Array}  clusters geoClusters() from src/server.js — {base, cfg, mod, listKey}.
 * @param {object} opts     { logger, force }
 * @returns {Promise<{count:number, skipped:boolean, taskUid:*}>}
 */
async function indexGeoHubs(index, clusters, { logger = console, force = false } = {}) {
  const docs = (clusters || []).map(hubToDoc).filter(Boolean);
  if (!docs.length) return { count: 0, skipped: true, taskUid: null };

  // Cheap validation before pushing: read ALL `cluster` document hashes already
  // in the index and compare them as multisets. A single sentinel (the first hub)
  // is NOT enough — editing one data file (e.g. New Jersey boroughs) changes the
  // hash of one document only, so the index would keep serving stale data forever.
  // After an index restore from R2 this check fails and the documents are re-pushed.
  //
  // `getDocuments` + `fields`, NOT `search` + `attributesToRetrieve`: Meili
  // intersects search attributes with `displayedAttributes` and `hash` is not in
  // that list, so a search would always come back empty and this guard would
  // never skip a push. The documents endpoint uses `fields` (it crosses
  // `displayedAttributes`) and supports the `type` filter (filterableAttributes).
  // The same read also finds documents whose cluster no longer exists. A renamed base changes
  // the id (`geo-hub:` + base), so the OLD document is never overwritten by the push — it just
  // sits in the index advertising a Malay address that now only 301s. Collected here, removed
  // after the push.
  let stale = [];
  if (!force) {
    try {
      const found = await index.getDocuments({
        filter: 'type = "cluster"',
        // The documents endpoint is NOT governed by `pagination.maxTotalHits`
        // (that only applies to search), so one request is enough even if the
        // cluster count grows far past 1000. The slack above `docs.length` leaves room for
        // exactly the leftovers this pass is meant to delete.
        limit: docs.length + 100,
        fields: ['id', 'hash']
      });
      const rows = (found && found.results) || [];
      const total = found && found.total != null ? found.total : rows.length;
      const ids = new Set(docs.map((d) => d.id));
      stale = rows.map((r) => r && r.id).filter((id) => id && !ids.has(id));
      const want = docs.map((d) => d.hash).sort();
      const got = rows.map((r) => r && r.hash).filter(Boolean).sort();
      // The multisets match only when the document COUNT is the same and every
      // hash matches; any incomplete read (hidden attribute, 404, mock fallback)
      // results in re-pushing — always the safe direction. A leftover also counts as a change,
      // so a rename is cleaned up even when every current hub is already correct.
      const unchanged = stale.length === 0 && total === docs.length && got.length === want.length &&
        want.every((h, i) => h === got[i]);
      if (unchanged) {
        if (logger && logger.log) logger.log(`[cluster-index] ${docs.length} cluster hubs already in the index — no change`);
        return { count: docs.length, skipped: true, taskUid: null };
      }
    } catch { /* fail open: just push the documents */ }
  }

  const task = await index.updateDocuments(docs);
  if (logger && logger.log) {
    logger.log(`[cluster-index] ${docs.length} cluster hubs submitted to the main index (task ${task && task.taskUid ? task.taskUid : 'mock'})`);
  }
  if (stale.length && typeof index.deleteDocuments === 'function') {
    await index.deleteDocuments(stale);
    if (logger && logger.log) logger.log(`[cluster-index] removed ${stale.length} hub document(s) for clusters that no longer exist: ${stale.join(', ')}`);
  }
  return { count: docs.length, skipped: false, taskUid: task && task.taskUid ? task.taskUid : null };
}

/**
 * A search document for one of the section hubs — a page of ours that is not a geo cluster
 * (src/section-hubs.js describes them). Same shape as hubToDoc so the corpus stays uniform,
 * but `type: 'section'` on purpose: the geo guard in indexGeoHubs reads `type = "cluster"`
 * and compares its ids, so these documents must never be mistaken for a removed cluster.
 * @param {{url,title,description,lines,keywords}} section
 */
function sectionToDoc(section) {
  if (!section || !section.url || !section.title) return null;
  const url = `https://tukuk.org${section.url}`;
  const lines = [
    `${section.title} — hub at tukuk.org${section.url}.`,
    ...(section.lines || [])
  ].filter(Boolean);
  const content = [...new Set(lines)].join('\n');

  return {
    id: crypto.createHash('sha256').update(`hub:${section.url}`).digest('hex').slice(0, 16),
    url,
    title: section.title,
    description: section.description || '',
    content,
    summary: section.description || '',
    siteName: 'Tukuk-OS',
    host: 'tukuk.org',
    lang: 'en',
    type: 'section',
    section: section.url.replace(/^\//, ''),
    keywords: [...new Set(section.keywords || [])].slice(0, 20),
    headings: [],
    publishedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    crawledAt: new Date().toISOString(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    quality: SECTION_QUALITY,
    hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  };
}

/**
 * Push the section hubs into the main index.
 *
 * No hash guard here: it is ten documents, one small task, and a sentence edited in
 * src/section-hubs.js should reach the index on the next boot without a second mechanism
 * that could disagree with it. The push is an upsert, so repeating it changes nothing.
 * @param {object} index Meilisearch index from ensureIndex().
 * @param {Array}  sections [{url,title,description,lines,keywords}] from sectionHubs().
 * @returns {Promise<{count:number}>}
 */
async function indexSectionHubs(index, sections, { logger = console } = {}) {
  const docs = (sections || []).map(sectionToDoc).filter(Boolean);
  if (!docs.length) return { count: 0 };
  await index.updateDocuments(docs);
  if (logger && logger.log) logger.log(`[section-hubs] ${docs.length} section hubs are searchable`);
  return { count: docs.length };
}

module.exports = {
  hubToDoc,
  indexGeoHubs,
  sectionToDoc,
  indexSectionHubs,
  stripHtml,
  tally,
  faqLines,
  HUB_ALIASES
};
