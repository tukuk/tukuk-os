'use strict';
// ── WORLD BOOKS — what to read on a subject, and what it is actually about ──────
//
// tukuk.org had no answer to "what should I read about X" outside the three-book
// 'further reading' strip on an academy page. This cluster is that answer: for each
// subject, the works the world keeps republishing, with authors, first year and how
// many editions exist — and an entry per subject that says what the subject *is*,
// because a list without a reason to read it is a list nobody uses.
//
// Where the data comes from: Open Library (openlibrary.org) — the Internet Archive's
// catalogue, keyless, with the metadata dedicated to the public domain (CC0). The list is
// the catalogue's own relevance matches for the subject, narrowed to the works that
// actually carry the subject on their record, then ordered by edition count — a plain,
// checkable proxy for "this book mattered": a work with forty editions was read, taught
// and reprinted for decades.
//
// Two traps in that API, both measured on 24 Oct 2026 and both avoided on purpose:
//   • `sort=editions` does not sort the matches, it sorts the whole index, so asking for
//     the most-editioned works on climatology returns Dickens; sort locally instead;
//   • a subject's *page* (/subjects/climatology.json) mixes in works that do not carry the
//     subject at all, and an unknown subject answers 200 with zero works rather than 404 —
//     so every returned work is checked against the subject string on its own record.
//
// What we deliberately do NOT do:
//   • no cover images — Open Library's cover files carry their own rights and are not
//     CC0; text, author, year and a link to the catalogue entry are enough;
//   • no article text mirrored — every title links to the catalogue so the reader can
//     borrow or read the real thing where the rights allow it;
//   • no mass crawl — twenty-four subjects, one request each, cached for a day and
//     mirrored to disk so a restart never waits on the network.
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 16000, // a subject search measured up to ~13 s; below that we would fail real lists
  httpsAgent: new https.Agent({ family: 4 }), // the box has no usable IPv6 route
  headers: { 'User-Agent': 'TukukOS-Books/1.0 (+https://tukuk.org/contact)' },
});
attachGuard(http, { name: 'books', budgetMs: 16000 });

const MIRROR_FILE = process.env.BOOKS_MIRROR_PATH || path.join(path.dirname(config.store.path), 'books-last.json');
const TTL = 24 * 60 * 60 * 1000;   // a subject's canon does not change overnight
const LIMIT = 30;                   // enough to be a reading list, short enough to load
const PER_SEARCH = 100;             // how many matches to pull before narrowing
const MAX_PER_AUTHOR = 2;           // five Andrew Lang titles is not a reading list
const PRIME_GAP_MS = 1200;          // spacing between subjects at boot

// The subjects are editorial, not generated: each one is a door somebody might actually
// walk through, and the blurb is the reason to open it. `term` is the Open Library
// subject string, which is not always the slug ("world history", not "world-history").
// `literary` marks the subjects where a novel belongs on the list — everywhere else a
// work tagged fiction is a book *set* in the subject, not a book *about* it, which is how
// two German historical romances were heading the ancient-history list.
const SUBJECTS = [
  { slug: 'world-history', title: 'World History', term: 'world history', blurb: 'How civilisations met, traded, fought and copied each other — the long view that makes the news legible.' },
  { slug: 'ancient-history', title: 'Ancient History', term: 'ancient history', blurb: 'Mesopotamia, Egypt, Greece, Rome, Persia, Han China: the first cities, the first laws, the first histories written down.' },
  { slug: 'philosophy', title: 'Philosophy', term: 'philosophy', blurb: 'The questions that do not go away — what is real, what is right, what can we know — argued in public for 2,500 years.' },
  { slug: 'physics', title: 'Physics', term: 'physics', blurb: 'From falling apples to quantum fields: the rules everything else has to obey, and the experiments that found them.' },
  { slug: 'astronomy', title: 'Astronomy', term: 'astronomy', blurb: 'What is out there and how we know — the sky, the instruments, and the patience it takes to measure a star.' },
  { slug: 'mathematics', title: 'Mathematics', term: 'mathematics', blurb: 'Proof, pattern and the unreasonable usefulness of abstraction, from Euclid to the mathematics of the everyday.' },
  { slug: 'chemistry', title: 'Chemistry', term: 'chemistry', blurb: 'How atoms combine, react and rearrange — the science that turns one substance into another on purpose.' },
  { slug: 'biology', title: 'Biology', term: 'biology', blurb: 'Cells, inheritance, ecosystems and the machinery of being alive, from a bacterium to a rainforest.' },
  { slug: 'evolution', title: 'Evolution', term: 'evolution (biology)', blurb: 'Descent with modification: the idea that reorganised biology, and the evidence gathered since Darwin first hesitated to publish it.' },
  { slug: 'neuroscience', title: 'Neuroscience', term: 'neuroscience', blurb: 'How a kilogram of wet tissue produces memory, language, emotion and a self that thinks it is in charge.' },
  { slug: 'psychology', title: 'Psychology', term: 'psychology', blurb: 'What experiments actually show about attention, memory, bias and behaviour — including the ones that failed to replicate.' },
  { slug: 'economics', title: 'Economics', term: 'economics', blurb: 'Incentives, markets, money and the models that predict people badly — and sometimes exactly right.' },
  { slug: 'political-science', title: 'Politics & Power', term: 'political science', blurb: 'States, constitutions, elections and legitimacy: how societies decide who gets to decide.' },
  { slug: 'law', title: 'Law', term: 'law', blurb: 'Rules with consequences: how courts reason, why constitutions endure, and what rights actually cost to enforce.' },
  { slug: 'medicine', title: 'Medicine', term: 'medicine', blurb: 'The body as a machine that fails in patterned ways, and the long, often bloody road to evidence-based treatment.' },
  { slug: 'engineering', title: 'Engineering', term: 'engineering', blurb: 'Bridges, engines, materials and margins of safety — the discipline of making things that do not fall down.' },
  { slug: 'computer-science', title: 'Computer Science', term: 'computer science', blurb: 'Computation itself: algorithms, complexity, information, and why some problems are cheap and others are not.' },
  { slug: 'climate', title: 'Climate & Environment', term: 'climatology', blurb: 'How the atmosphere, oceans and ice work as one system, and what the measurements have shown over seventy years.' },
  { slug: 'geology', title: 'Geology & Earth', term: 'geology', blurb: 'Plate tectonics, deep time and the rocks that record four and a half billion years of it.' },
  { slug: 'anthropology', title: 'Anthropology', term: 'anthropology', blurb: 'What people do and why they say they do it — kinship, ritual, exchange, and the argument about culture.' },
  { slug: 'linguistics', title: 'Language & Linguistics', term: 'linguistics', blurb: 'Sound, grammar, meaning and change: how language works as a system, and how it reshapes itself in every generation.' },
  { slug: 'art-history', title: 'Art History', term: 'art history', blurb: 'How images were made, paid for and read — from cave walls to the gallery wall, and who got to be called an artist.' },
  { slug: 'architecture', title: 'Architecture', term: 'architecture', blurb: 'Buildings as decisions: structure, light, city, climate and the politics of putting a roof over people.' },
  { slug: 'poetry', title: 'Poetry', term: 'poetry', literary: true, blurb: 'The shortest form with the longest memory — how a line can carry more than a paragraph, and why metre matters.' },
];

const BY_SLUG = new Map(SUBJECTS.map((s) => [s.slug, s]));
const cache = new Map(); // slug → { at, works }
const stats = { through: 0, mirrored: 0, failed: 0, lastError: '' };

/** A work from the Open Library search payload, reduced to what a reader needs. */
function normalise(doc) {
  const key = String((doc && doc.key) || '');
  const title = String((doc && doc.title) || '').trim();
  if (!key || !title) return null;
  const editions = Number(doc.edition_count);
  const names = (doc.author_name && doc.author_name[0]) ? doc.author_name : [];
  return {
    title: title.slice(0, 180),
    author: String(names[0] || 'Unknown author').trim().slice(0, 120),
    authorKey: String(names[0] || '').toLowerCase(),
    year: Number.isFinite(Number(doc.first_publish_year)) ? Number(doc.first_publish_year) : null,
    editions: Number.isFinite(editions) && editions > 0 ? editions : null,
    slug: key.replace(/^\/works\//, ''),
  };
}

/**
 * Does this record actually carry the subject? The catalogue's search matches on more
 * than the subject list, and its subject pages return works that are not in the subject
 * at all — so the subject string is required on the record before it reaches a list.
 */
function carriesSubject(doc, term) {
  const want = String(term).toLowerCase();
  const subjects = (doc && doc.subject) || [];
  return Array.isArray(subjects) && subjects.some((s) => String(s).toLowerCase() === want);
}

// Fiction is a subject tag on thousands of records, so it has to be checked explicitly:
// "A Tale of Two Cities" is under history, and a history list of novels is not a history
// reading list.
const IS_FICTION = /\b(fiction|novel|romance|story)\b/i;

function isFiction(doc) {
  const subjects = (doc && doc.subject) || [];
  return Array.isArray(subjects) && subjects.some((s) => IS_FICTION.test(String(s)));
}

// Statute compilations, conference proceedings and parliamentary papers are catalogued as
// if they were books, because libraries hold them like books. "Laws, etc" (the label the
// record really carries) topped the law list with 3,456 editions, which is true of the
// United Kingdom's statute book and useless to a reader. A reading list is about works.
const IS_SERIAL = /^(laws|acts|resolves|session laws|public laws|proceedings|debates|transactions|memorials|journals?)\b/i;

function isSerial(doc) {
  return IS_SERIAL.test(String((doc && doc.title) || '').trim());
}

/**
 * The catalogue's matches for a subject, turned into the list a reader sees: keep only
 * records that really carry the subject, drop the novels unless the subject is a literary
 * one, order by editions, then let no author take more than two of the thirty slots.
 * Pure, so those four rules can be tested without the network.
 */
function rankWorks(docs, meta) {
  const term = (meta && meta.term) || meta; // accept the bare string, for tests and callers
  const literary = Boolean(meta && meta.literary);
  const seen = new Set();
  const perAuthor = new Map();
  const out = [];
  const pool = (Array.isArray(docs) ? docs : [])
    .filter((d) => carriesSubject(d, term))
    .filter((d) => literary || !isFiction(d))
    .filter((d) => !isSerial(d))
    .map(normalise)
    .filter((w) => w && !seen.has(w.slug) && seen.add(w.slug))
    .sort((a, b) => (b.editions || 0) - (a.editions || 0) || (a.year || 9999) - (b.year || 9999));
  // First pass honouring the per-author cap, then a second to top the list up if the cap
  // left it short — a cap should shorten a list, not empty it.
  const limit = LIMIT;
  for (const w of pool) {
    if (out.length >= limit) break;
    const k = w.authorKey || w.author;
    if ((perAuthor.get(k) || 0) >= MAX_PER_AUTHOR) continue;
    perAuthor.set(k, (perAuthor.get(k) || 0) + 1);
    out.push(w);
  }
  if (out.length < limit) {
    const taken = new Set(out.map((w) => w.slug));
    for (const w of pool) {
      if (out.length >= limit) break;
      if (!taken.has(w.slug)) { taken.add(w.slug); out.push(w); }
    }
    out.sort((a, b) => (b.editions || 0) - (a.editions || 0));
  }
  return out;
}

function readMirror() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMirror(slug, entry, all) {
  try {
    all[slug] = entry;
    fs.mkdirSync(path.dirname(MIRROR_FILE), { recursive: true });
    const tmp = `${MIRROR_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, MIRROR_FILE); // rename is atomic: a reader never sees half a file
    stats.mirrored++;
  } catch {
    // a failed mirror is a slow restart later, never a broken page now
  }
}

/**
 * The reading list for one subject.
 * Order: fresh memory → the network → the disk mirror (any age) → an empty list.
 * @returns {Promise<{works:Array, at:number|null, stale:boolean}>}
 */
async function subject(slug) {
  const meta = BY_SLUG.get(slug);
  if (!meta) return { works: [], at: null, stale: false };
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return { works: hit.works, at: hit.at, stale: false };

  const mirror = readMirror();
  try {
    const res = await http.get('https://openlibrary.org/search.json', {
      params: {
        // No `sort` on purpose: the server-side sort ignores the subject and ranks the
        // whole index, which is how Dickens ended up on a climate list. Relevance in,
        // editions ordered locally.
        q: `subject:"${meta.term}"`,
        limit: PER_SEARCH,
        fields: 'title,author_name,first_publish_year,edition_count,key,subject',
      },
    });
    const docs = (res.data && Array.isArray(res.data.docs)) ? res.data.docs : [];
    const works = rankWorks(docs, meta);
    if (!works.length) throw new Error('no works carry this subject');
    const entry = { at: Date.now(), works };
    cache.set(slug, entry);
    stats.through++;
    writeMirror(slug, { at: new Date(entry.at).toISOString(), works }, mirror);
    return { works, at: entry.at, stale: false };
  } catch (err) {
    stats.failed++;
    stats.lastError = String((err && err.message) || err).slice(0, 160);
    const last = mirror[slug];
    if (last && Array.isArray(last.works) && last.works.length) {
      const at = Date.parse(last.at) || null;
      cache.set(slug, { at: at || Date.now(), works: last.works });
      return { works: last.works, at, stale: true };
    }
    return { works: [], at: null, stale: false };
  }
}

/**
 * Fill the cache for every subject, one at a time, after boot. Without this the first
 * visitor to each of the twenty-four pages pays an up-to-16-second catalogue search, and
 * the first ten minutes after a deploy are exactly when a slow page goes unnoticed.
 * Sequential and spaced because this is a 4 GB box coming back up, and polite because
 * the searches belong to the Internet Archive, not to us. Never rejects.
 * `fetchOne` is injectable so the walk itself can be tested without the catalogue.
 */
async function prime({ gapMs = PRIME_GAP_MS, log = console.log, fetchOne = subject } = {}) {
  const done = new Set();
  const pass = async (list) => {
    for (const s of list) {
      try {
        const r = await fetchOne(s.slug);
        if (r && r.works && r.works.length && !r.stale) { done.add(s.slug); }
      } catch { /* one dead subject must not stop the other twenty-three */ }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  };
  await pass(SUBJECTS);
  // A catalogue search that times out is a bad second, not a bad day: the empties get one
  // more turn after a pause, which is what made the difference in testing — 23 of 24 on the
  // first pass, 24 on the second.
  const left = SUBJECTS.filter((s) => !done.has(s.slug));
  if (left.length) {
    await new Promise((resolve) => setTimeout(resolve, gapMs * 5));
    await pass(left);
  }
  log(`[books] primed ${done.size}/${SUBJECTS.length} subjects`);
  return done.size;
}

/** How the cluster is doing — for /health and for us. */
function status() {
  return {
    subjects: SUBJECTS.length,
    cached: cache.size,
    ...stats,
    lastError: stats.lastError || null,
  };
}

module.exports = {
  SUBJECTS, BY_SLUG, LIMIT, PER_SEARCH, MAX_PER_AUTHOR, TTL, MIRROR_FILE,
  subject, prime, status, normalise, rankWorks, carriesSubject, isFiction, isSerial, readMirror,
};
