'use strict';
const crypto = require('crypto');

/**
 * Index the /books shelves into our own search corpus.
 *
 * Gap this closes: the same one src/cluster-index.js closed for the geo hubs, one cluster over.
 * 2,550 reading lists are published and not one of them was in `halaman_web` — only the /books
 * hub was, because it happens to be a static page somebody imported. Measured on the VPS, 25 Oct
 * 2026: "beekeeping" matched three documents in the whole index and none of them was
 * /books/bees, whose thirty works include "First lessons in beekeeping" and "Bee-keeping for
 * all"; "climate change", the most-searched query with no page of ours in the top five, matched
 * zero books pages. The page existed, the index did not know it was there, so the visitor got a
 * BBC article.
 *
 * One document per shelf, built from the files already on disk (no HTTP, no crawler, no page
 * render), with a deterministic id so running it again is an upsert rather than a duplicate.
 * The same `quality` as a geo hub (0.9): this is our own page, not something we crawled.
 */

const SHELF_QUALITY = 0.9; // our blog posts are 0.95, front doors 0.98, crawled pages 0.5
const WORKS_CAP = 30;      // a shelf file holds at most this many works; the page shows them all

/** A line per work: what the page shows a reader, so what the index matches a query against. */
function workLines(works) {
  return (works || []).slice(0, WORKS_CAP).map((w) => {
    const title = String((w && w.title) || '').trim();
    if (!title) return '';
    const author = String((w && w.author) || '').trim();
    const year = Number(w && w.year);
    const editions = Number(w && w.editions);
    const bits = [author, Number.isFinite(year) ? String(year) : ''].filter(Boolean).join(', ');
    const count = Number.isFinite(editions) && editions > 1 ? ` — ${editions} editions` : '';
    return `${title}${bits ? ` — ${bits}` : ''}${count}`;
  }).filter(Boolean);
}

/**
 * The search document for one shelf.
 *
 * `term` is in the content on purpose: it is the catalogue's heading, which is often the word a
 * reader does not use ("climatic changes", "motion pictures", "bees"), and the shelf is the page
 * that answers that heading too. The question-shaped lines are here for the same reason as in
 * cluster-index: Meili's first ranking rule is `words`, and a page that carries the words of the
 * question beats one that merely mentions them.
 *
 * @param {{slug,title,term,blurb,curated,found,works}} shelf a row from books.allShelves()
 * @param {Array} works the shelf's works, when it keeps them on disk (curated shelves do not)
 */
function shelfDoc(shelf, works) {
  if (!shelf || !shelf.slug || !shelf.title) return null;
  const slug = String(shelf.slug);
  const title = String(shelf.title);
  const term = String(shelf.term || title).toLowerCase();
  const list = workLines(works);
  const found = Number(shelf.found);

  const lines = [
    `Reading list: ${title} — what to read about ${term}, at tukuk.org/books/${slug}.`,
    // The two shapes people actually type, then the honest description of what the page is.
    `What should I read about ${term}? ${title} is a reading list of the books libraries keep reprinting on the subject.`,
    `Books about ${term} — ${list.length || 'the'} titles with author, year and edition count.`,
    shelf.blurb ? String(shelf.blurb) : '',
    `The catalogue files this literature under "${term}"${Number.isFinite(found) && found > 0 ? `, where it holds ${found} works` : ''}.`,
    ...list
  ].filter(Boolean);
  const content = [...new Set(lines)].join('\n');
  const description = String(shelf.blurb || `A reading list of ${term} — the books libraries keep reprinting.`);

  return {
    id: crypto.createHash('sha256').update(`books-shelf:${slug}`).digest('hex').slice(0, 16),
    url: `https://tukuk.org/books/${slug}`,
    title: `${title} — Books by Subject`,
    description,
    content,
    summary: description,
    siteName: 'Tukuk-OS',
    host: 'tukuk.org',
    lang: 'en',
    type: 'books',
    section: 'Books',
    keywords: [...new Set([term, 'books', 'reading list', ...String(title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)])].slice(0, 20),
    headings: list.slice(0, 10),
    publishedAt: (shelf.at && String(shelf.at)) || new Date('2026-01-01T00:00:00.000Z').toISOString(),
    crawledAt: new Date().toISOString(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    quality: SHELF_QUALITY,
    hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  };
}

/** Every shelf we can index, from what is on disk right now. Curated shelves keep no work files. */
function shelfDocs(booksLib) {
  const docs = [];
  for (const shelf of booksLib.allShelves()) {
    let works = [];
    if (!shelf.curated) {
      try { works = booksLib.shelfWorks(shelf.slug) || []; } catch { works = []; }
      // A row in the index with no file behind it is not a page — the same rule the sitemap uses.
      if (!works.length) continue;
    }
    const doc = shelfDoc({ ...shelf, works: works.length }, works);
    if (doc) docs.push(doc);
  }
  return docs;
}

/**
 * Push every shelf into the main index.
 *
 * The hash guard is the same shape as indexGeoHubs and for the same reason: 2,550 documents is
 * a real task on a 4 GB box, and a restart that changed nothing should not re-send them. Any
 * incomplete read of the existing documents re-pushes, which is the safe direction. Shelves that
 * were pruned leave a document behind, so the ids are compared and the leftovers deleted — the
 * index must not keep advertising a page the build retired.
 *
 * @param {object} index Meilisearch index from ensureIndex()
 * @param {object} booksLib src/books.js
 * @returns {Promise<{count:number, skipped:boolean, removed:number, taskUid:*}>}
 */
async function indexBooksShelves(index, booksLib, { logger = console, force = false } = {}) {
  const docs = shelfDocs(booksLib);
  if (!docs.length) return { count: 0, skipped: true, removed: 0, taskUid: null };

  let stale = [];
  if (!force) {
    try {
      // The documents endpoint is not governed by pagination.maxTotalHits (that is search only),
      // so one read is enough; the slack above docs.length leaves room for the leftovers.
      const found = await index.getDocuments({
        filter: 'type = "books"',
        limit: docs.length + 200,
        fields: ['id', 'hash']
      });
      const rows = (found && found.results) || [];
      const total = found && found.total != null ? found.total : rows.length;
      const ids = new Set(docs.map((d) => d.id));
      stale = rows.map((r) => r && r.id).filter((id) => id && !ids.has(id));
      const want = docs.map((d) => d.hash).sort();
      const got = rows.map((r) => r && r.hash).filter(Boolean).sort();
      const unchanged = stale.length === 0 && total === docs.length && got.length === want.length &&
        want.every((h, i) => h === got[i]);
      if (unchanged) {
        if (logger && logger.log) logger.log(`[books-index] ${docs.length} reading lists already in the index — no change`);
        return { count: docs.length, skipped: true, removed: 0, taskUid: null };
      }
    } catch { /* fail open: just push the documents */ }
  }

  const task = await index.updateDocuments(docs);
  if (logger && logger.log) {
    logger.log(`[books-index] ${docs.length} reading lists submitted to the main index (task ${task && task.taskUid ? task.taskUid : 'mock'})`);
  }
  if (stale.length && typeof index.deleteDocuments === 'function') {
    await index.deleteDocuments(stale);
    if (logger && logger.log) logger.log(`[books-index] removed ${stale.length} document(s) for shelves that no longer exist`);
  }
  return { count: docs.length, skipped: false, removed: stale.length, taskUid: task && task.taskUid ? task.taskUid : null };
}

module.exports = { shelfDoc, shelfDocs, indexBooksShelves, workLines, SHELF_QUALITY, WORKS_CAP };
