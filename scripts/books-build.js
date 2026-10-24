'use strict';
// ── Build the long tail of /books: real shelves, from the catalogue's own subject strings ──
//
// WHY THIS IS A SCRIPT AND NOT A PAGE REQUEST
// The curated twenty-six shelves in src/books.js fetch live, one search per subject, and are
// primed at boot. A thousand more shelves cannot work that way: priming them would take half an
// hour of the Internet Archive's time after every deploy, and a crawler that arrives before the
// priming finishes would be handed a sixteen-second search. So the shelves are built here, once,
// explicitly, and written to disk (data/books-shelves/<slug>.json plus a small index). A page
// request then costs one file read and never touches the network — the web process does not crawl,
// this process does, and it can be stopped, resumed and measured.
//
// WHERE THE SUBJECTS COME FROM
// Not invented. Every candidate term is a subject string that appeared on a record we had already
// fetched, counted across shelves. A term becomes a shelf only after six checks, in this order:
//
//   0. it is not a published shelf with an 's' on the end (twinOfPublished) — free, so it runs
//      before the catalogue is asked;
//   1. src/books.js's rejection rules — the shape of the label (subdivisions, form tags,
//      paperwork, punctuation, foreign spellings, bare umbrella words) — cost nothing, because
//      the term is a string we already hold;
//   2. at least SHELF_MIN_WORKS (20) works survive the four list rules on it;
//   3. the catalogue holds at least --minFound (120) works under it, so the list shown is a
//      sample of a real body of work and not the whole topic;
//   4. the label is a word its own books use (books.labelCoverage) — without this the harvest
//      serves up "Chemie", "Physik" and "Translations Into English" as page titles;
//   5. half of the list is not already on another shelf we published (biggestOverlap), which is
//      what stops "Social Sciences" sitting beside "Social Science".
//
// That is the whole quality gate: the catalogue says the topic exists, the catalogue says these
// books are about it, the books use the word on the page, and it adds titles we do not already
// show. If it cannot clear that, it does not get a url.
//
// BEING A GUEST ON SOMEBODY ELSE'S FREE API
// One axios instance with the outbound guard attached (deadline, cooldown, dedupe), a fixed
// concurrency, a gap between calls, and a load check: if this box's own 1-minute load average is
// above LOAD_MAX the run sleeps instead of adding to it, because a build that makes tukuk.org slow
// is not worth finishing. Roughly 0.7 requests per second per worker; 3,000 searches is about half
// an hour at concurrency 3, and that is the ceiling this script will spend without being told twice.
// Measured on the proof runs: about 1.6 searches per published shelf, so 1,000 shelves costs
// closer to 2,000-3,000 searches once the thin end of the pool is reached.
//
// USAGE
//   node scripts/books-build.js                          # default: 1,000 shelves, 3,000 calls
//   node scripts/books-build.js --shelves=60 --calls=200 # a proof run before the real one
//   node scripts/books-build.js --concurrency=1          # a quieter network, a longer run
//   node scripts/books-build.js --prune-only             # retire what is on disk, no searches
//   node scripts/books-build.js --terms=beekeeping,jazz  # build exactly these, nothing else
// Ctrl-C is safe: state is written after every shelf and re-running resumes from the file.
// --calls is measured against the LIFETIME total the state file remembers, not the current run:
// resuming a build that has spent 1,400 searches needs --calls above that number.
const fs = require('fs');
const path = require('path');
const books = require('../src/books');

const STATE_FILE = path.join(path.dirname(books.MIRROR_FILE), 'books-build-state.json');
const DEFAULTS = { shelves: 1000, calls: 3000, concurrency: 3, gapMs: 300, minFound: 120, seen: 3 };
const LOAD_MAX = 4;          // pause when the box is already doing more than this
const SAVE_EVERY = 50;       // shelves between shard/index writes
const CANDIDATE_CAP = 12000; // how much of the subject pool is remembered, so RAM stays boring
                             // (12,000 terms × ~40 bytes = half a megabyte; measured: a 61-shelf
                             // run harvested 3,549 and was still finding new ones at the cap)
const DUP_SHARE = 0.5;       // a list that is half another shelf's list is that list under a new name
const TRY_MAX = 3;           // retries for a term the catalogue refused to answer for
const GIVE_UP_AFTER = 20;    // consecutive refusals that end the run (the refusal is not per-term)
const COOL_RETRY_MS = 130000; // the guard's cooldown is 120 s; ask again a minute after it lifts

function arg(name, fallback) {
  const m = new RegExp(`--${name}=(\\S+)`).exec(process.argv.join(' '));
  return m ? Number(m[1]) : fallback;
}
// Pruning what is already published needs no network at all, and a floor that moved has to be
// applied to the files the old floor produced. This flag does exactly that and exits.
const PRUNE_ONLY = /--prune-only\b/.test(process.argv.join(' '));
// A searched query that no page of ours answers is the best evidence there is for a topic we
// should have a door for — better than the catalogue's own subject strings, because somebody
// asked. `--terms` builds exactly the names it is given (comma separated, in order) through the
// same six gates, and does nothing else: the candidate pool is not consulted, nothing is
// harvested, and a term that fails is written into `visited` with its reason so the next run does
// not spend a second search on it. The list comes from the query log, not from a guess.
const TERMS = (() => {
  const m = /--terms=(\S+)/.exec(process.argv.join(' '));
  return parseTerms(m ? m[1] : '');
})();
/** `--terms=a, B ,c` → ['a','b','c']; anything else → []. Split out so a test can ask it. */
function parseTerms(list) {
  return String(list || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
const OPTS = {
  shelves: arg('shelves', DEFAULTS.shelves),
  calls: arg('calls', DEFAULTS.calls),
  concurrency: Math.max(1, arg('concurrency', DEFAULTS.concurrency)),
  gapMs: arg('gap', DEFAULTS.gapMs),
  minFound: arg('minFound', DEFAULTS.minFound),
  seen: arg('seen', DEFAULTS.seen),
};

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The box's own 1-minute load average, or 0 when /proc is not there (a laptop, a container). */
function load1() {
  try {
    return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]) || 0;
  } catch {
    return 0;
  }
}

/**
 * State on disk, written after every shelf. It holds what has been visited and the queue; the
 * works themselves are NOT kept here (that would be a 20 MB JSON re-read on every write) — they
 * live in the shards and are re-loaded at startup if this is a resumed run.
 */
function loadState() {
  const fresh = { published: [], visited: {}, queue: [], seen: {}, tries: {}, defer: {}, at: nowIso() };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && Array.isArray(raw.published) && Array.isArray(raw.queue)) return { ...fresh, ...raw };
  } catch { /* first run, or a hand-deleted file: start clean */ }
  return fresh;
}
function saveState(state) {
  state.at = nowIso();
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

/** Read every existing work shard back into the map, so a resumed run can rewrite a full index. */
function loadExistingWorks() {
  const map = new Map();
  for (let n = 0; n < books.WORK_SHARDS; n++) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(books.WORK_DIR, `shard-${n}.json`), 'utf8'));
    } catch { continue; }
    for (const [id, rec] of Object.entries(raw || {})) map.set(id, rec);
  }
  return map;
}

/**
 * Count the subject strings on the works that made it onto a shelf. A term that appears on
 * several books of one shelf is a real, load-bearing subject; one that appears on a single book
 * is a marginal tag. Harvesting the published list rather than the raw search matches also keeps
 * the pool honest — a candidate is only ever something a reader would find on a page we already
 * stand behind. The cap exists because the catalogue hands back twenty-odd strings per work.
 */
function harvest(works, seen) {
  for (const w of Array.isArray(works) ? works : []) {
    const list = Array.isArray(w.subjects) ? w.subjects : [];
    for (const s of list.slice(0, 20)) {
      const term = String(s || '').trim().toLowerCase();
      if (!term || books.rejected(term)) continue;
      seen[term] = (seen[term] || 0) + 1;
      if (Object.keys(seen).length > CANDIDATE_CAP) return;
    }
  }
}

/**
 * The next candidates: never tried, un-rejected, and seen on enough records to be a topic.
 * `term in visited` rather than `!visited[term]` — a published shelf stores an empty reason, and
 * testing the VALUE would hand the same two terms back forever (measured: 44 wasted searches on
 * "nonfiction" and "textbooks" before this line was fixed). `withDeferred` keeps the deferred
 * ones in, so the run can tell an empty queue from a queue that is merely waiting.
 */
function nextCandidates(state, withDeferred = false) {
  const now = Date.now();
  return Object.entries(state.seen)
    .filter(([term, n]) => n >= OPTS.seen && !(term in state.visited) && !books.rejected(term)
      && (withDeferred || !(state.defer[term] > now)))
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);
}

/** How long until the soonest deferred term may be asked again (0 when nothing is deferred). */
function soonestDefer(state) {
  const now = Date.now();
  let best = 0;
  for (const at of Object.values(state.defer || {})) {
    if (at > now && (best === 0 || at - now < best)) best = at - now;
  }
  return Math.min(best, 60000);
}

/**
 * How much of this list somebody else's shelf already carries. Every work we publish records
 * which shelves it landed on, so a candidate can be compared with the shelves already written —
 * for free, from the map already in memory.
 *
 * This rule exists because of the second proof run (24 Oct 2026, 45 shelves): it published
 * "Social Science" and "Social Sciences" from the same 105,899 works, "Cells", "Cellules" and
 * "Cytology" over the same books, "Atlas" and "Atlases", "Anatomy", "Human Anatomy" and
 * "Anatomie Humaine". A reader opening the second one finds the same thirty titles, and a site
 * that hands a crawler fifty copies of one list is a doorway page, not a library.
 */
function biggestOverlap(ranked, works) {
  const counts = new Map();
  for (const w of ranked) {
    const prev = works.get(w.slug);
    if (!prev) continue;
    for (const s of (prev.shelves || [])) counts.set(s, (counts.get(s) || 0) + 1);
  }
  let top = null;
  let n = 0;
  for (const [slug, c] of counts) if (c > n) { top = slug; n = c; }
  return { slug: top, share: ranked.length ? n / ranked.length : 0 };
}

/**
 * The one rule that needs no search at all: this candidate is an already published shelf with
 * an 's' on the end. The 150-shelf proof run (24 Oct 2026) published "Social Science" AND
 * "Social Sciences" (same 105,899 works, so the title-overlap rule below could not see it
 * because the two lists were ranked differently), "Atlas" and "Atlases", "Cells", "Cellules"
 * and "Cytology", "Genes", "Genetica" and "Genetics". Words are compared by stem prefix in
 * either direction — the same convention as the label gate — so "atlas"/"atlases", "cells"/
 * "cellules" and "child"/"children" all match, the last one on purpose: the catalogue writes one
 * heading under two spellings and a crawler handed both would find the same thirty books twice.
 */
// Every candidate is compared against every published term, which at 1,000 shelves is a couple
// of million word comparisons — and the same handful of strings comes back each time, so the
// stems are remembered rather than re-split. 12,000 candidate terms of two or three words is a
// few hundred KB, not a thing worth an eviction policy.
const stemCache = new Map();
function stemWords(term) {
  const key = String(term || '').toLowerCase();
  const hit = stemCache.get(key);
  if (hit) return hit;
  const stems = key.split(/[^a-z0-9]+/).filter(Boolean)
    .map((w) => w.replace(/s$/, '')).filter((w) => w.length >= 3).sort();
  stemCache.set(key, stems);
  return stems;
}
function twinOf(term, known) {
  const a = stemWords(term);
  if (!a.length) return null;
  for (const other of known) {
    const b = stemWords(other);
    if (b.length === a.length && a.every((w, i) => w.startsWith(b[i]) || b[i].startsWith(w))) return other;
  }
  return null;
}
function twinOfPublished(term, state) {
  return twinOf(term, [...state.published.map((p) => p.term), ...books.SUBJECTS.map((s) => s.term)]);
}

/**
 * The gates are written down, so they change — and a shelf published under rules that have since
 * been found wrong must not stay up simply because it was written first. Re-checking what is
 * already on disk costs no search, so every run begins by pruning its own published list: a term
 * rejected now, or a twin of an earlier shelf, loses its file, its index row and — when no shelf
 * links to them any more — its work records, because the work index is what a sitemap is allowed
 * to promise. Measured on the VPS (24 Oct 2026) after the 1,000-shelf run: this dropped "Peur",
 * "Amor", "Kind", "Wiskunde", "Mort", "Femmes", "Mujeres", "Will", "Sick", "Face", "Play" and a
 * second copy of "Atlas", leaving the run to refill those slots with shelves that clear the rules.
 */
function prunePublished(state, works) {
  const byTime = state.published.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const kept = [];
  const dropped = [];
  for (const p of byTime) {
    const why = books.rejected(p.term);
    const twin = why ? null : twinOf(p.term, kept.map((k) => k.term));
    if (why || twin) dropped.push({ ...p, why: why || `the same shelf is published as “${twin}”` });
    else kept.push(p);
  }
  if (!dropped.length) return { dropped, kept: kept.length };
  for (const d of dropped) state.visited[d.term] = `pruned: ${d.why}`;
  dropShelves(state, works, dropped, kept);
  console.log(`[books-build] pruned ${dropped.length} shelf files under rules newer than they are:`);
  for (const d of dropped.slice(0, 12)) console.log(`  ✂ ${d.term} — ${d.why}`);
  return { dropped, kept: kept.length };
}

/**
 * The other half of that re-check, and the only one that has to read the files: a shelf shorter
 * than SHELF_MIN_WORKS is a stub that cleared the gates on a thin day. The floor was eight for the
 * first full build; measured on the VPS (24 Oct 2026) out of 2,660 shelves 139 sat under twenty
 * works, and a page carrying nine books costs a crawl to say what the shelf beside it already
 * says. Their URLs go with the files: the sitemap stops advertising them on the same run, so the
 * 404s are never promised to anybody.
 */
function pruneThin(state, works) {
  const min = books.SHELF_MIN_WORKS;
  const kept = [];
  const dropped = [];
  for (const p of state.published) {
    // The file is the count that matters: the index row was written by whichever run published
    // the shelf, and a list re-written since then may carry fewer works than the row remembers.
    // A row whose file has vanished counts as zero and goes the same way.
    const size = books.shelfWorks(p.slug).length;
    if (size < min) dropped.push({ ...p, size, why: `${size} works — a shelf needs ${min}` });
    else kept.push(p);
  }
  if (!dropped.length) return { dropped, kept: kept.length };
  for (const d of dropped) state.visited[d.term] = `pruned: only ${d.size} works`;
  dropShelves(state, works, dropped, kept);
  console.log(`[books-build] pruned ${dropped.length} shelves below the ${min}-work floor:`);
  for (const d of dropped.slice(0, 12)) console.log(`  ✂ ${d.term} (${d.size} works)`);
  return { dropped, kept: kept.length };
}

/**
 * What both prunes do to the disk: the file, the index row, and every work record the surviving
 * shelves no longer link to. The work index is what a sitemap is allowed to promise, so a record
 * left behind is a page advertised with nothing to show.
 */
function dropShelves(state, works, dropped, kept) {
  const gone = new Set(dropped.map((d) => d.slug));
  for (const d of dropped) {
    try { fs.unlinkSync(path.join(books.SHELF_DIR, `${d.slug}.json`)); } catch { /* already gone */ }
  }
  for (const [id, rec] of works) {
    rec.shelves = (rec.shelves || []).filter((s) => !gone.has(s));
    if (!rec.shelves.length) works.delete(id);
  }
  state.published = kept;
  books.saveShelfIndex(kept.slice().sort((a, b) => a.title.localeCompare(b.title)));
  books.replaceWorks([...works.values()]);
}

/**
 * One shelf: search, apply the list rules, publish what survives. Returns the shelf it wrote, or
 * a reason string for the rejection — a rejected candidate costs nothing but a line in the log.
 */
async function buildShelf(term, { works, state }) {
  const twin = twinOfPublished(term, state);
  if (twin) return `the same shelf is already published as “${twin}”`;
  const { docs, found } = await books.searchSubject(term);
  state.calls = (state.calls || 0) + 1;
  if (!docs.length) return `no records at all`;
  const ranked = books.rankWorks(docs, { term, literary: false });
  if (ranked.length < books.SHELF_MIN_WORKS) return `only ${ranked.length} works carry “${term}”`;
  if (found < OPTS.minFound) return `the catalogue holds just ${found} works`;

  // The label gate. Everything above asks whether the TOPIC has enough books; this asks
  // whether the WORDS on the page are the words the books use, which is the one thing a
  // harvested subject string cannot be trusted about (eleven of the first thirty shelves were
  // German, French, Dutch or Turkish spellings of a topic we already had, or catalogue jargon).
  const label = books.labelCoverage(term, ranked.map((w) => w.title));
  if (label && label.coverage < books.LABEL_MIN_TITLE_COVERAGE) {
    return `“${term}” appears in ${Math.round(label.coverage * 100)}% of its own titles (needs ${Math.round(books.LABEL_MIN_TITLE_COVERAGE * 100)}%)`;
  }

  const dup = biggestOverlap(ranked, works);
  if (dup.slug && dup.share >= DUP_SHARE) {
    const other = books.shelfMeta(dup.slug);
    return `${Math.round(dup.share * 100)}% of the list is already on “${(other && other.title) || dup.slug}”`;
  }

  const slug = books.shelfSlug(term);
  if (books.BY_SLUG.get(slug)) return `“${term}” is already a curated shelf`;
  const title = books.titleCase(term);
  const at = nowIso();

  books.saveShelf({ slug, term, title, found, works: ranked, at });
  state.published = state.published.filter((p) => p.slug !== slug);
  state.published.push({ slug, term, title, works: ranked.length, found, at });
  harvest(ranked, state.seen);

  for (const w of ranked) {
    const id = w.slug;
    const prev = works.get(id) || { id };
    works.set(id, {
      id, title: w.title, author: w.author, year: w.year, editions: w.editions,
      subjects: w.subjects || [], ia: w.ia || [],
      shelves: [...new Set([...(prev.shelves || []), slug])].slice(0, 6),
      at,
    });
  }
  return null;
}

async function main() {
  const state = loadState();
  const works = loadExistingWorks();
  prunePublished(state, works);
  pruneThin(state, works);

  if (PRUNE_ONLY) {
    saveState(state);
    console.log(`[books-build] prune-only run: ${state.published.length} shelves left, ${works.size} works`);
    return;
  }

  if (TERMS.length) {
    const built = [];
    for (const term of TERMS) {
      if (state.visited[term] === 'published' || state.published.some((p) => p.term === term)) {
        console.log(`  skip  ${term} — already published`);
        continue;
      }
      let why;
      try {
        while (load1() > LOAD_MAX) { console.log(`[books-build] load is ${load1()}, pausing 20s`); await sleep(20000); }
        why = await buildShelf(term, { works, state });
      } catch (err) {
        why = `the catalogue refused the search (${String((err && err.message) || err).slice(0, 120)})`;
      }
      if (why) {
        state.visited[term] = why;
        console.log(`  skip  ${term} — ${why}`);
      } else {
        state.visited[term] = 'published';
        built.push(term);
        console.log(`  built ${term} (${state.calls} calls so far)`);
      }
      saveState(state);
      books.saveWorks([...works.values()]);
      books.saveShelfIndex(state.published.slice().sort((a, b) => a.title.localeCompare(b.title)));
      await sleep(OPTS.gapMs);
    }
    console.log(`[books-build] terms run: ${built.length} built of ${TERMS.length} asked; `
      + `${state.published.length} shelves, ${works.size} works, ${state.calls || 0} calls`);
    for (const t of built) console.log(`  ✓ ${t}`);
    return;
  }

  for (const s of state.published) state.visited[s.term] = 'published';

  console.log(`[books-build] target ${OPTS.shelves} shelves, ${OPTS.calls} calls, ${OPTS.concurrency} workers`);
  console.log(`[books-build] resuming: ${state.published.length} published, ${works.size} works on disk, `
    + `${Object.keys(state.seen).length} candidate terms known`);
  // `calls` is a lifetime budget kept in the state file, not a per-run one — so a resume given a
  // smaller --calls than the run has already spent does nothing at all, and did exactly that here
  // (993 shelves, 1,387 calls spent, --calls=600: the loop never started). Say so instead of
  // looking like a build that ran and found the catalogue empty.
  if ((state.calls || 0) >= OPTS.calls && state.published.length < OPTS.shelves) {
    console.log(`[books-build] NOTE: ${state.calls} searches have already been spent against a budget of `
      + `${OPTS.calls}, and ${state.published.length} of ${OPTS.shelves} shelves are published. `
      + `--calls is the lifetime budget; raise it above ${state.calls} to keep building.`);
  }

  let stop = false;
  const budget = () => state.published.length < OPTS.shelves && (state.calls || 0) < OPTS.calls;

  // Seed the candidate pool from the curated twenty-six. `books.subject()` is used rather than a
  // raw search because it keeps the cache/mirror order and rewrites the mirror in the current
  // shape — an old mirror entry has no `subjects` on its works, which is exactly the case that
  // would otherwise leave the pool empty and the run with nothing to build.
  for (const s of books.SUBJECTS) {
    if (state.visited[s.term] === 'curated') continue;
    try {
      const { works: ranked } = await books.subject(s.slug);
      harvest(ranked, state.seen);
      for (const w of ranked) if (w.slug && !works.has(w.slug)) {
        works.set(w.slug, { id: w.slug, ...w, shelves: [s.slug], at: nowIso() });
      }
      state.visited[s.term] = 'curated';
      saveState(state);
    } catch (err) {
      console.log(`  curated ${s.slug} failed: ${String((err && err.message) || err).slice(0, 60)}`);
    }
  }
  console.log(`[books-build] seeded ${Object.keys(state.seen).length} candidate terms from the curated shelves`);

  let sinceWrite = 0;
  let refusals = 0;
  while (!stop && budget()) {
    const queue = nextCandidates(state);
    if (!queue.length) {
      // An empty queue with terms waiting on the cooldown is not an exhausted catalogue: sleep
      // until the soonest one is askable again, then continue. Bounded by soonestDefer() at a
      // minute, so a run can never hang on a term that will never come back.
      const waiting = nextCandidates(state, true).length;
      if (!waiting) { console.log('[books-build] the catalogue offered no more candidates'); break; }
      const nap = soonestDefer(state);
      console.log(`[books-build] ${waiting} candidates are cooling; waiting ${Math.round(nap / 1000)}s`);
      await sleep(nap || 15000);
      continue;
    }

    const batch = queue.slice(0, OPTS.concurrency);
    const results = await Promise.all(batch.map(async (term) => {
      // A worker that throws would take the whole run down with it, and one failed second on a
      // free catalogue is normal: log it, keep going.
      try {
        while (load1() > LOAD_MAX) { console.log(`[books-build] load is ${load1()}, pausing 20s`); await sleep(20000); }
        await sleep(Math.random() * OPTS.gapMs);          // never a synchronised burst of workers
        const why = await buildShelf(term, { works, state });
        await sleep(OPTS.gapMs);
        return { term, why };
      } catch (err) {
        // A refused search is not an answer about the subject, so it must not be recorded as one:
        // measured on 24 Oct 2026, a search that blew the 16 s deadline put that URL in the
        // guard's two-minute cooldown, and the old code wrote "catalogue did not answer" into
        // `visited` — which quietly retired a shelf that was perfectly good. A cooldown is not
        // even a failed attempt: the term is deferred until the cooldown lifts and asked again.
        const cooled = Boolean(err && err.cooling);
        return {
          term,
          cooled,
          transient: true,
          why: `${cooled ? 'the guard is cooling that search' : 'the catalogue refused the search'} (${String((err && err.message) || err).slice(0, 150)})`,
        };
      }
    }));

    for (const { term, why, cooled, transient } of results) {
      if (!why) { state.visited[term] = 'published'; refusals = 0; continue; }
      if (transient && cooled) {
        state.defer[term] = Date.now() + COOL_RETRY_MS;
        console.log(`  wait  ${term} — ${why}`);
        continue;                                  // not visited, not a try spent
      }
      if (transient && (state.tries[term] = (state.tries[term] || 0) + 1) <= TRY_MAX) {
        refusals += 1;
        console.log(`  retry ${term} — ${why}`);
        continue;                                  // left out of `visited`: it comes back next pass
      }
      state.visited[term] = why;
      console.log(`  skip  ${term} — ${why}`);
    }
    // Twenty refusals in a row is not a bad subject string, it is the Internet Archive telling
    // us to go away for a while. Finish what is on disk and stop, rather than spending the rest
    // of the budget on a closed door.
    if (refusals >= GIVE_UP_AFTER) {
      console.log(`[books-build] ${refusals} refused searches in a row — stopping. Re-run to resume from the state file.`);
      break;
    }
    sinceWrite += results.filter((r) => !r.why).length;
    saveState(state);

    if (sinceWrite >= SAVE_EVERY) {
      books.saveWorks([...works.values()]);
      books.saveShelfIndex(state.published.slice().sort((a, b) => a.title.localeCompare(b.title)));
      sinceWrite = 0;
      console.log(`  wrote ${state.published.length} shelves, ${works.size} works (${state.calls} calls)`);
    }
    if (results.every((r) => r.why)) await sleep(OPTS.gapMs * (refusals ? 40 : 10)); // a dry spell: back off, do not spin
    stop = !budget();
  }

  books.saveWorks([...works.values()]);
  books.saveShelfIndex(state.published.slice().sort((a, b) => a.title.localeCompare(b.title)));
  saveState(state);

  const rejected = Object.entries(state.visited).filter(([, why]) => why && why !== 'curated' && why !== 'published');
  console.log(`[books-build] done: ${state.published.length} shelves, ${works.size} works, ${state.calls || 0} calls`);
  console.log(`[books-build] ${rejected.length} candidates rejected`);
  for (const [term, why] of rejected.slice(-12)) console.log(`  ${term} — ${why}`);
}

// The pure rules are exported and the run is guarded, so test/books.test.js can ask this file
// what it would publish without opening a socket — a build script that only runs as a CLI is a
// script whose worst bugs are found in production data.
module.exports = { stemWords, twinOf, twinOfPublished, prunePublished, pruneThin, biggestOverlap, nextCandidates, buildShelf, parseTerms, OPTS };

if (require.main === module) {
  main().catch((err) => {
    console.error('[books-build] failed:', (err && err.message) || err);
    process.exitCode = 1;
  });
}
