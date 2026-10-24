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
//   • no crawl from the web process. Twenty-four curated subjects fetch live (one request
//     each, cached a day, mirrored to disk). Everything beyond them is built by
//     scripts/books-build.js as an explicit, bounded, resumable run and written to disk;
//     a request never reaches the catalogue for one of those, so a crawler storm on a
//     thousand shelves costs this box file reads, not somebody else's API.
//
// SCALE, and why the files are shaped this way (measured while planning, 24 Oct 2026):
// a sample of 40 topics found 24 with at least 100 works and 17 with 1,000+, so roughly
// one in two candidate subjects is a real shelf. At ~1,000 shelves the JSON for every
// work on every shelf is ~20 MB — which must never be parsed into RAM at boot on a box
// that has 6.8 GB shared with Meilisearch, a tunnel and nginx. So the data lives in three
// pieces: a small shelf *index* (one entry per shelf, ~110 KB, read once), one file per
// shelf (~6 KB, read per request), and works in 40 shards chosen by a hash of the Open
// Library id — no lookup table needed to find a work's shard, and an LRU keeps the four
// hottest shards parsed.
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
  const subjects = Array.isArray(doc.subject) ? doc.subject : [];
  const ia = Array.isArray(doc.ia) ? doc.ia : [];
  return {
    title: title.slice(0, 180),
    author: String(names[0] || 'Unknown author').trim().slice(0, 120),
    authorKey: String(names[0] || '').toLowerCase(),
    year: Number.isFinite(Number(doc.first_publish_year)) ? Number(doc.first_publish_year) : null,
    editions: Number.isFinite(editions) && editions > 0 ? editions : null,
    slug: key.replace(/^\/works\//, ''),
    // Kept for the book page, which is built from the same payload rather than from a
    // second request per work: what else the record is tagged with, and whether an
    // archive.org copy exists that a reader can actually open.
    subjects: subjects.slice(0, 12).map((s) => String(s).slice(0, 80)),
    ia: ia.slice(0, 2).map((s) => String(s).slice(0, 120)),
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
 * The catalogue search behind a shelf: one request, the works it matched, and how many the
 * subject holds in total. Exported because scripts/books-build.js builds a thousand shelves
 * through exactly this call — the deadline, the cooldown and the dedupe in src/outbound.js
 * apply to the build exactly as they do to a page, which is the point of having one choke
 * point. A quote in a subject string would break the query, so it is stripped rather than
 * escaped: no Open Library subject contains one.
 */
async function searchSubject(term) {
  const res = await http.get('https://openlibrary.org/search.json', {
    params: {
      // No `sort` on purpose: the server-side sort ignores the subject and ranks the
      // whole index, which is how Dickens ended up on a climate list. Relevance in,
      // editions ordered locally.
      q: `subject:"${String(term).replace(/"/g, '')}"`,
      limit: PER_SEARCH,
      fields: 'title,author_name,first_publish_year,edition_count,key,subject,ia',
    },
  });
  const data = (res && res.data) || {};
  return {
    docs: Array.isArray(data.docs) ? data.docs : [],
    found: Number.isFinite(Number(data.numFound)) ? Number(data.numFound) : 0,
  };
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
    const { docs } = await searchSubject(meta.term);
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

// ── The built shelves: everything past the curated twenty-four, read off disk ────────
// Written by scripts/books-build.js, never by a page request. Three files and a directory,
// because the whole point is that a visitor opening /books/amateur-radio must not pay a
// catalogue search: the shelf is a 6 KB file already on this box.
const DATA_DIR = path.dirname(MIRROR_FILE);
const SHELF_DIR = path.join(DATA_DIR, 'books-shelves');
const SHELF_INDEX_FILE = path.join(DATA_DIR, 'books-shelves.json');
const WORK_DIR = path.join(DATA_DIR, 'books-works');
const WORK_INDEX_FILE = path.join(DATA_DIR, 'books-works-index.jsonl');
const WORK_SHARDS = 40;          // ~30,000 works ÷ 40 ≈ 750 records a shard, ~250 KB
const SHELF_MIN_WORKS = 8;       // below this it is a stub, not a reading list

// Subject strings are the catalogue's own lowercase labels ("beekeeping", "quantum
// computing"). Capitalising them is formatting, not authorship — but the words are the
// source's, which is why nothing here invents a title out of prose.
const SMALL_WORDS = new Set(['of', 'and', 'in', 'the', 'for', 'a', 'an', 'on', 'to', 'de', 'la', 'with', 'at', 'by']);

/** Display name for a catalogue subject, by title case with the small words left down. */
function titleCase(term) {
  const words = String(term || '').split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const low = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ')
    .replace(/\s,\s/g, ', ').replace(/\(\s?/g, '(').replace(/\s?\)/g, ')')
    .slice(0, 70);
}

/** A url-safe shelf slug from a subject string, accents folded, never truncated mid-word. */
function shelfSlug(term) {
  const folded = String(term || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    .replace(/-+$/, '');
  return folded || 'subject';
}

// Four families of subject string produce a page nobody would read, all of them seen in
// the catalogue while this was being written:
//   • a subdivision ("beekeeping--history") is half a subject and returned 24 works;
//   • a form tag ("juvenile fiction", "nonfiction", "textbooks") describes the SHAPE of a book
//     rather than what it is about, and is broad enough to be a subject in the catalogue — the
//     first two of those came back as the top candidates on the very first build run, which is
//     how we know they had to be rejected: a list of everything the library calls nonfiction is
//     not a reading list, it is the whole shelf sorted by reprint count;
//   • the paperwork of a discipline (statistics, congresses, directories, sources) is
//     catalogued under the topic and tops an editions-sorted list every single time;
//   • a bare umbrella word — "history", "science", "world" — is so wide that ordering it by
//     editions returns Dickens, which is the exact failure the curated rules were built to
//     stop. It is anchored to the WHOLE label on purpose: "history of science" and "world
//     war" are shelves, "history" is a shrug. The second proof run (45 shelves) added the last
//     few words of that list by measurement: "Methods" (91,291 works, a subdivision), "Origin"
//     (14,889, half of them Victorian), "Behavior", "Medical" and "Translations Into English"
//     (a label for the book's language, not its topic) all came back as top candidates;
//   • the catalogue's subject strings are not all English, and not all of them are labels a
//     reader would recognise. The first 30-shelf proof run (24 Oct 2026) published "Chemie",
//     "Physik", "Histoire", "Lehrbuch", "Natuurkunde", "Economie Politique", "Problemes Et
//     Exercices", "Manuels D'enseignement Superieur", "Early Works To 1800", "Popular Works",
//     "Chemistry, Organic", "Study And Teaching (Secondary)" and "Open_syllabus_Project" —
//     eleven of thirty pages that nobody would have read. Two of the three families below
//     exist because of that list, measured rather than imagined.
// The `bare` additions are a different failure: "will", "sick" and "face" are English, but the
// catalogue folds several headings into one string, so their lists are incoherent — measured on
// the VPS, "Will" (12,441 works) is Schopenhauer's "Die Welt als Wille und Vorstellung" next to
// "Will of General George Washington" next to "La Ley Del Exito", and "Sick" (8,836) is the
// "Rituale Romanum" next to "Long day's journey into night". One label standing for two
// unrelated topics is not a reading list, it is a homophone. "Play" is the same family and is
// anchored for the opposite reason: the plural is a form tag wherever it sits, while "play"
// standing alone is the catalogue's drama heading — but "play therapy" is a real topic, so it
// must not be caught by a substring rule.
const REJECT = {
  // A subject label is a topic, so it is written with words and spaces. Commas are the
  // inverted subdivision order ("chemistry, organic" — the same topic as "organic
  // chemistry", already a candidate in its own right); parentheses, slashes, underscores,
  // apostrophes and full stops are catalogue machinery ("study and teaching (secondary)",
  // "science/mathematics", "open_syllabus_project"). Accents go with them: this is an
  // English-language site and "problèmes et exercices" is not an English label.
  label: /[^a-z0-9 -]/,
  subdivision: /--/,
  form: /\b(fiction|novels?|romance|juvenile|drama|poetry|poems|stories|tales|legends|myths|essays|speeches|addresses|plays|nonfiction|non-fiction)\b/i,
  // Where a form or paperwork word sits anywhere in the label, the label describes the book
  // rather than the topic: "science textbooks", "laboratory manuals", "popular works" and
  // "early works to 1800" all topped the harvested pool with counts over 60. "problems" and
  // "exercises" are only rejected as the pair the catalogue writes, so that "problem solving"
  // stays a subject.
  shape: /\b(textbooks?|handbooks?|manuals?|popular works|early works|pictorial works|illustrated|miscellanea|bestsellers?|criticism and interpretation|physiological phenomena|aspects?)\b|problems?[^a-z]{0,3}exercises?|translat\w*\s+into/i,
  // The coverage gate catches most foreign spellings by their titles, but not those whose
  // books are written in the same language as the label: the 150-shelf proof run (24 Oct 2026)
  // published "Anatomie Humaine", "Cellules", "Enfants", "Denken", "Exito En Los Negocios",
  // "Genetica", "Strategisch Management" and "Ontwikkelingspsychologie" with coverages over the
  // threshold, because a French subject does find French titles. This is an English-language
  // site, so the tokens that were actually seen are refused by name. Every word here was
  // observed in the harvested pool and each is a spelling of a topic the catalogue already
  // offers in English — nothing here is a guess about a language.
  // …and the 1,000-shelf run (24 Oct 2026, on the VPS) added the rest of them by reading every
  // label of eight characters or fewer: peur, mort, amor, kind, femmes, mujeres, erfolg, ethik,
  // raison, quelle and wiskunde all cleared the coverage gate, because the catalogue holds the
  // topic's books in that language too. Two routes were measured and rejected before this list
  // was written: the `language` field is a list of every translation a work has ("The Wisdom of
  // Insecurity" = spa,tur,eng,fre,slv,chi,ger), so it cannot say what language a TITLE is; and
  // there is no English lexicon on this box (/usr/share/dict/words is absent, none in
  // node_modules). A named list of strings the harvest really published is the honest shape.
  //
  // The tail is a shape rather than a list, and this part is a rule instead of more words: no
  // English word ends in "…ologie" or "…iek", while the Dutch and German spellings of a
  // discipline do — "cosmologie", "dermatologie", "diagnostiek" were all live shelves beside the
  // English ones they duplicate, and their stem differs at the last letter, so the twin rule
  // cannot see them either ("cosmologi" is not a prefix of "cosmology").
  foreign: /\b(anatomie|humaine|cellules|enfants|denken|exito|negocios|genetica|genetik|strategisch|strategisches|entwicklungspsychologie|ontwikkelingspsychologie|psychologie|chemie|chimie|physik|physique|natuurkunde|histoire|philosophie|lehrbuch|economie|politique|mathematiques|manuels|problemes|exercices|d-enseignement|sociale|sociologie|medicina|historia|literatura|ciencias|peur|mort|amor|kind|femmes|mujeres|erfolg|ethik|raison|quelle|wiskunde|alimentos|amerikanisches|englisch|bonheur|christentum|ciencia|corps humain|cuidado|desarrollo|diccionarios|dieu|droit|embarazo|economia|esprit|esthetica|etik|europa|felicidad|filosofia|glaube|magia|malades|miedo|muerte|mujer|mythen|naturwissenschaften|occultisme|padres|politica|relaciones|sociedade|theorie|travail|comportement|humain|projets|jeunesse|visuelle|naturelles|signes|symboles|connaissance|contemporaine|socialisme|populaire|technologiques|betrekkingen|wereldgeschiedenis|productiemanagement|informatiesystemen|internationale|moderne|psychisches|informationstechnik|naturopathie|leben|liebe|mystik|origines|ouvrages|personnelles|nourrissons|espirit|actualisation|amour|anatomia|communisme|comunismo|ergonomie|informatica|mythologie|souffrance|soziale|probleme|technik|intellectuelle|zeit)\b|^(?:\w+ologie|\w+iek)$|^(?:\w+osofia|\w+ologias|\w+esthetik|\w+ysik|\w+emie)$|\b(?:ciencias|relaciones|alimentos)\b/i,
  paperwork: /^(laws|acts|bills|treaties|agreements|reports|proceedings|congresses|conferences|symposia|colloquia|periodicals|serials|dictionaries|enc[oa]cl[oa]p[ae]dias|directories|yearbooks|almanacs|statistics|sources|bibliograph\w*|indexes|abstracts|microforms?|microfilms?|patents?|standards?|specifications|catalogs|catalogues|pictures\b)/i,
  bare: /^(history|society|geography|science|technology|nature|world|civilization|civilisation|commerce|trade|industry|education|research|methodology|miscellany|miscellaneous|biography|autobiography|diaries|correspondence|letters|interviews|obituaries|study and teaching|study and travel|description and travel|origin|origins|methods|behavior|behaviour|medical|physiological|phenomena|will|sick|face|play)$/i,
};

/**
 * Should this subject string become a page? Returns a reason string when it should not,
 * or null when it may be tried. Pure, so the rules can be argued about in a test rather
 * than discovered in a live 404. Note that a rejection here costs nothing: the term was
 * read off a record we already fetched.
 */
function rejected(term) {
  const t = String(term || '').trim().toLowerCase();
  if (t.length < 4 || t.length > 52) return 'too short or too long to be a subject';
  if (!/[a-z]{3}/.test(t)) return 'no real word in it';
  if (/^[\d\s.,-]+$/.test(t)) return 'a number, not a subject';
  for (const [name, re] of Object.entries(REJECT)) if (re.test(t)) return `a ${name} label, not a topic`;
  if (/\bin\s+(fiction|literature)\b|\bof\s+the\b/.test(t)) return 'a qualified fragment';
  return null;
}

/**
 * The last gate, and the only one that needs the shelf's own books: how often does the
 * label actually appear in the titles on the list?
 *
 * A real subject is a word its books use. Measured on 24 Oct 2026 over thirty titles a
 * term: beekeeping 0.57, gardening 0.57, organic chemistry 0.93, astronomy 0.50,
 * mountaineering 0.27, numismatics 0.33, cosmology 0.20, economics 0.20 — while every
 * foreign label came in at or under 0.13 (chimie 0.03, physik 0.03, histoire 0.00,
 * lehrbuch 0.00, natuurkunde 0.00, economie politique 0.03) and so did the catalogue
 * jargon the shape rule misses (long now manual for civilization 0.03, new york times
 * bestseller 0.13). The gate is the maximum over the label's words, because "organic
 * chemistry" needs only "organic" to be a title-word; a stem match both ways so
 * "photography" is credited by "Photographic" and "numismatics" by "Numismatic".
 *
 * Returns null when the label has no word long enough to test ("art", "dna"): an
 * untestable label is not a false label, so the build keeps it.
 */
const LABEL_MIN_TITLE_COVERAGE = 0.15;
const stemWord = (w) => String(w).replace(/[^a-z]/g, '').replace(/s$/, '');
function labelCoverage(term, titles) {
  const words = [...new Set(String(term || '').toLowerCase().split(/[^a-z0-9]+/)
    .map(stemWord).filter((w) => w.length >= 4))];
  const list = Array.isArray(titles) ? titles.filter(Boolean) : [];
  if (!words.length || !list.length) return null;
  const stems = list.map((t) => String(t).toLowerCase().split(/[^a-z0-9]+/).map(stemWord));
  let best = 0;
  let word = words[0];
  for (const w of words) {
    const hits = stems.filter((line) => line.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (hits / list.length > best) { best = hits / list.length; word = w; }
  }
  return { coverage: best, word };
}

const readJson = (file) => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
};
const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // rename is atomic: a reader never sees half a file
};

// The shelf index is read and kept — 1,000 entries of {slug, term, title, works, found, at} is
// 130 KB, and every hub, A–Z page and sitemap row comes from it. It is re-read when the file's
// mtime moves rather than parsed exactly once: a build that finishes while the server is running
// must become visible without restarting the site, and measured on the VPS (24 Oct 2026) the
// opposite choice left /books/a-z and /sitemap-books.xml reporting sixty shelves after the run had
// written a thousand, while the work sitemaps — which already cache by mtime — were correct.
let shelfIndex = null;
let shelfIndexAt = 0;
function autoShelves() {
  let mtime = 0;
  try { mtime = fs.statSync(SHELF_INDEX_FILE).mtimeMs; } catch { /* no index yet */ }
  if (shelfIndex && shelfIndexAt === mtime) return shelfIndex;
  const raw = readJson(SHELF_INDEX_FILE);
  shelfIndex = Array.isArray(raw) ? raw.filter((s) => s && s.slug && s.term && s.works > 0) : [];
  shelfIndexAt = mtime;
  return shelfIndex;
}
/** Forget the parsed index — the build script and the tests both need this. */
function reloadShelves() { shelfIndex = null; shelfIndexAt = 0; workCountCache = null; }

/** Curated first, then built: the twenty-four hand-written shelves always lead. */
function shelfMeta(slug) {
  const key = String(slug || '').toLowerCase();
  return BY_SLUG.get(key) || autoShelves().find((s) => s.slug === key) || null;
}

function allShelves() {
  return [...SUBJECTS.map((s) => ({ ...s, curated: true })), ...autoShelves().map((s) => ({ ...s, curated: false }))];
}

// Last twenty-four shelf files parsed. Twenty-four is the number a crawler can plausibly
// have open at once across the whole cluster; past that a page costs one file read, which
// is what this box is good at. The mtime rides along with the parse for the same reason the
// index's does: the build rewrites a shelf file, and a reader must not be served the old list
// because this process happened to look at it first.
const shelfLru = new Map();
function shelfFile(slug) { return path.join(SHELF_DIR, `${slug}.json`); }

/** The works on a built shelf, from disk. Never the network, never a surprise. */
function shelfWorks(slug) {
  const file = shelfFile(slug);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return []; }
  const hit = shelfLru.get(slug);
  if (hit && hit.mtime === mtime) return hit.works;
  const raw = readJson(file);
  const works = raw && Array.isArray(raw.works) ? raw.works : [];
  shelfLru.set(slug, { mtime, works });
  if (shelfLru.size > 24) shelfLru.delete(shelfLru.keys().next().value);
  return works;
}

/**
 * Which shard file holds a work. An Open Library key is "/works/OL2941508W", so the digits
 * give a stable bucket with no lookup table to keep in step with the data. The digits are
 * extracted rather than the prefix trimmed, because a key reaches this code both as a bare
 * id and as the "/works/…" path off the record.
 */
function shardOf(id) {
  const m = /OL(\d+)W/i.exec(String(id || ''));
  return m ? Number(m[1]) % WORK_SHARDS : 0;
}

const shardLru = new Map();
function shard(n) {
  const file = path.join(WORK_DIR, `shard-${n}.json`);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return {}; }
  const hit = shardLru.get(n);
  if (hit && hit.mtime === mtime) return hit.map;
  const raw = readJson(file) || {};
  shardLru.set(n, { mtime, map: raw });
  if (shardLru.size > 4) shardLru.delete(shardLru.keys().next().value);
  return raw;
}

/** One catalogue record by Open Library work id, or null. */
function work(id) {
  const m = /OL(\d+)W/i.exec(String(id || ''));
  if (!m) return null;
  return shard(shardOf(`OL${m[1]}W`))[`OL${m[1]}W`] || null;
}

// The work index is one JSON line per work. It exists for exactly one reason: a sitemap may
// only promise urls the site can serve, so the list of what was built has to be readable
// without parsing 20 MB of shards. Cached by mtime, because the build rewrites it.
let workCountCache = null;
function workIds() {
  let mtime = 0;
  try { mtime = fs.statSync(WORK_INDEX_FILE).mtimeMs; } catch { return []; }
  if (workCountCache && workCountCache.mtime === mtime) return workCountCache.ids;
  try {
    const ids = fs.readFileSync(WORK_INDEX_FILE, 'utf8').split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((r) => r && r.id).map((r) => ({ id: r.id, at: r.at || null }));
    workCountCache = { mtime, ids };
    return ids;
  } catch {
    return [];
  }
}

/**
 * What the site can actually serve right now — the only honest source for a sitemap.
 * A curated shelf counts when its mirror holds works; a built shelf counts when its file
 * does, which means a partially finished build simply publishes fewer urls, not 404s.
 */
function inventory() {
  const mirror = readMirror();
  const shelves = [];
  for (const s of SUBJECTS) {
    const m = mirror[s.slug];
    if (m && Array.isArray(m.works) && m.works.length) {
      shelves.push({ slug: s.slug, title: s.title, at: m.at || null, curated: true, works: m.works.length });
    }
  }
  for (const s of autoShelves()) {
    // The shelf file is not parsed here. At a thousand shelves that is a thousand JSON reads on
    // every crawler hit to /sitemap-books.xml — measured live at 1.5 s — and the only question
    // this route asks of the file is whether it is there at all, which is what a half-finished
    // build changes. The number of works comes from the index row the builder wrote beside it.
    let shelved = false;
    try { shelved = fs.statSync(shelfFile(s.slug)).size > 2; } catch { shelved = false; }
    if (shelved && s.works > 0) {
      shelves.push({ slug: s.slug, title: s.title, at: s.at || null, curated: false, works: s.works });
    }
  }
  return { shelves, works: workIds() };
}

/**
 * How many work-sitemap chunks a build of `total` works needs — and zero works is zero chunks.
 * A sitemap index may not advertise a file that answers 404. This is not theoretical: the VPS
 * was probed before its first build (24 Oct 2026) and /sitemap-book-works.xml listed chunk 0
 * while chunk 0 replied "No such book sitemap chunk", because the route had a Math.max(1, …) in
 * it. An empty index is valid XML and simply says the cluster has no pages to offer yet.
 */
function workSitemapChunks(total, chunk) {
  const n = Number(total) || 0;
  const size = Number(chunk) || 1;
  return n <= 0 ? 0 : Math.ceil(n / size);
}

// ── Writers, used by the build script only ─────────────────────────────────────────
/** Save one shelf: the index entry plus its own file, so a page reads one small file. */
function saveShelf(shelf) {
  const { slug, term, title, works, found, at } = shelf;
  writeAtomic(shelfFile(slug), JSON.stringify({ slug, term, title, found, at, works }));
}

/** Persist the whole shelf index at once — a reader never sees a half-written list. */
function saveShelfIndex(list) {
  writeAtomic(SHELF_INDEX_FILE, JSON.stringify(list));
  shelfIndex = null;
}

/** Write every work into its shard and rewrite the index. */
function saveWorks(records) { writeWorks(records, true); }

/**
 * The same, but every shard is written from scratch, so a record nobody gave you any more is
 * gone rather than merely absent. Used when a shelf is pruned: its works must leave the store
 * with it, because the work index is what a sitemap is allowed to promise.
 */
function replaceWorks(records) { writeWorks(records, false); }

function writeWorks(records, merge) {
  const byShard = new Map();
  for (const r of records) {
    const n = shardOf(r.id);
    if (!byShard.has(n)) byShard.set(n, {});
    byShard.get(n)[r.id] = r;
  }
  const all = [];
  for (let n = 0; n < WORK_SHARDS; n += 1) all.push(n);
  for (const n of (merge ? [...byShard.keys()] : all)) {
    const file = path.join(WORK_DIR, `shard-${n}.json`);
    const map = byShard.get(n) || {};
    writeAtomic(file, JSON.stringify(merge ? { ...readJson(file), ...map } : map));
  }
  shardLru.clear();
  writeAtomic(WORK_INDEX_FILE, records.map((r) => JSON.stringify({ id: r.id, at: r.at })).join('\n') + '\n');
  workCountCache = null;
}

/**
 * How the cluster is doing — for /health and for us.
 */
function status() {
  const built = autoShelves();
  return {
    subjects: SUBJECTS.length,
    built: built.length,
    builtWorks: built.reduce((a, s) => a + (s.works || 0), 0),
    records: workIds().length,
    cached: cache.size,
    ...stats,
    lastError: stats.lastError || null,
  };
}

module.exports = {
  SUBJECTS, BY_SLUG, LIMIT, PER_SEARCH, MAX_PER_AUTHOR, TTL, MIRROR_FILE,
  SHELF_DIR, SHELF_INDEX_FILE, WORK_DIR, WORK_INDEX_FILE, WORK_SHARDS, SHELF_MIN_WORKS,
  LABEL_MIN_TITLE_COVERAGE,
  subject, prime, status, normalise, rankWorks, carriesSubject, isFiction, isSerial, readMirror,
  searchSubject, titleCase, shelfSlug, rejected, labelCoverage, shelfMeta, allShelves, autoShelves, shelfWorks,
  work, workIds, shardOf, inventory, saveShelf, saveShelfIndex, saveWorks, replaceWorks, reloadShelves,
  workSitemapChunks,
};
