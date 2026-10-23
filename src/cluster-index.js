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
      `Does ${subject} have ${count} ${unit}? Yes — the full list of every ${singular}${where} is on this page.`,
      `List of ${unit}${where} (${count} entries): names, country and region.`,
    ]
    : [
      `How many ${unit} are there in total? There are ${count} ${unit}.`,
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
  const topCountry = countries.length && countries[0][1] > 1
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
  if (!force) {
    try {
      const found = await index.getDocuments({
        filter: 'type = "cluster"',
        // The documents endpoint is NOT governed by `pagination.maxTotalHits`
        // (that only applies to search), so one request is enough even if the
        // cluster count grows far past 1000.
        limit: docs.length,
        fields: ['hash']
      });
      const rows = (found && found.results) || [];
      const total = found && found.total != null ? found.total : rows.length;
      const want = docs.map((d) => d.hash).sort();
      const got = rows.map((r) => r && r.hash).filter(Boolean).sort();
      // The multisets match only when the document COUNT is the same and every
      // hash matches; any incomplete read (hidden attribute, 404, mock fallback)
      // results in re-pushing — always the safe direction.
      const unchanged = total === docs.length && got.length === want.length &&
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
  return { count: docs.length, skipped: false, taskUid: task && task.taskUid ? task.taskUid : null };
}

module.exports = { hubToDoc, indexGeoHubs, stripHtml, tally, faqLines };
