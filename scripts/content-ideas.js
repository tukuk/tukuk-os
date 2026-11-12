'use strict';
// content-ideas.js — the shelf-finding pipeline that built the catalogue, automated.
//
// Batches 1-3 (27 → 135 → 497 → 878 shelves) all worked the same way: pick
// candidate subject strings, then PROVE each one against Open Library with the
// product's own rule (exact lowercase subject match, 30+ carrying works) before
// it becomes a page. Famous-looking headings that failed the check (napoleon,
// sparta, linux, black holes) stayed out. This script keeps that pipeline
// running on a schedule so the queue of next shelves is never assembled by hand.
//
// Where candidates come from: the books already on today's sampled shelves.
// A work on /books/fermentation is tagged with other subjects — those
// co-occurrences are exactly "topics our readers of this shelf also have books
// about", which is a better source of ideas than a list someone types from
// memory. The rotation by day means a week of runs walks the whole catalogue.
//
// Every candidate goes through the same three gates the manual batches used:
//   1. not already in the catalogue, by term or by stem set (so "Squids" cannot
//      be proposed next to "squid");
//   2. not a label the crawler's rejection rules already eat (subdivisions,
//      form tags, bare umbrellas) — for NEW shelves the heuristic is welcome,
//      the curator only overrode it for entries already curated on purpose;
//   3. the truth check: 30+ works carrying the exact subject string, verified
//      sequentially with a polite gap, the cadence three batches ran without
//      ever getting throttled.
// Nothing is committed by this script — it ranks and reports. A human (or a
// later batch) curates. That split is deliberate: ideas are cheap, the carries
// check is what makes them publishable, and the commit stays reviewed.
//
// Usage: node scripts/content-ideas.js [--seeds N] [--verify N] [--min CARRIES] [--day YYYY-MM-DD]
// Exit: 0 = report produced (possibly empty) · 2 = Open Library unreachable
process.on('unhandledRejection', (err) => {
  console.error('[content-ideas] unhandled rejection:', err);
  process.exit(2);
});

const SEARCH = 'https://openlibrary.org/search.json';
const GAP_MS = 280;
const UA = 'tukuk.org-content-ideas/1.0 (https://tukuk.org; catalogue research)';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let blind = 0;
async function ol(qs) {
  try {
    const res = await fetch(`${SEARCH}?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()).docs) || [];
  } catch (e) {
    await sleep(3000);
    try {
      const res = await fetch(`${SEARCH}?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).docs) || [];
    } catch (e2) {
      blind++;
      await sleep(GAP_MS);
      return null;
    }
  }
}

async function main() {
  const books = require('../src/books.js');
  const build = require('../scripts/books-build.js');
  const SUBJECTS = books.SUBJECTS;

  const seedCount = Number(arg('seeds', 6));
  const verifyCount = Number(arg('verify', 25));
  const minCarries = Number(arg('min', 30)); // the same bar the manual batches used
  const day = arg('day', new Date().toISOString().slice(0, 10));
  const dayNum = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);

  // What already exists: exact terms and stem sets, plus the four fixture words
  // the unit tests rely on (see test/books-catalogue.test.js — proposing one of
  // these is proposing a merge that fails its own test suite).
  const haveTerms = new Set(SUBJECTS.map((s) => s.term.toLowerCase()));
  const forbidden = new Set(['amateur radio', 'child psychology', 'bees', 'sun']);
  const haveStems = new Set(SUBJECTS.map((s) => build.stemWords(s.term).join('|')));

  // 1. co-occurrence harvest from shelves rotating by day.
  const count = new Map();
  for (let i = 0; i < seedCount; i++) {
    const seed = SUBJECTS[(dayNum * seedCount + i) % SUBJECTS.length];
    const docs = await ol(`q=${encodeURIComponent(`subject:"${seed.term}"`)}&limit=100&fields=subject`);
    if (docs === null) continue;
    for (const doc of docs) {
      for (const raw of doc.subject || []) {
        const term = String(raw).toLowerCase().trim();
        if (!term || term === seed.term.toLowerCase()) continue;
        count.set(term, (count.get(term) || 0) + 1);
      }
    }
    await sleep(GAP_MS);
  }

  // 2. gates that cost no network.
  const candidates = [...count.entries()]
    .filter(([term]) => !haveTerms.has(term) && !forbidden.has(term))
    .filter(([term]) => !haveStems.has(build.stemWords(term).join('|')))
    .filter(([term]) => term.length >= 3 && term.length <= 60)
    .filter(([term]) => books.rejected(term) === null)
    .sort((a, b) => b[1] - a[1])
    .slice(0, verifyCount)
    .map(([term]) => term);

  // 3. the truth check: the bar is the product's own — 30+ works carrying the
  // exact lowercase subject string, measured on a full search page.
  const ideas = [];
  for (const term of candidates) {
    const docs = await ol(`q=${encodeURIComponent(`subject:"${term}"`)}&limit=100&fields=subject`);
    if (docs === null) continue;
    const carries = docs.filter((d) =>
      Array.isArray(d.subject) && d.subject.some((s) => String(s).toLowerCase() === term)).length;
    if (carries >= minCarries) ideas.push({ term, carries, cooccurs: count.get(term) });
    await sleep(GAP_MS);
  }

  if (blind > candidates.length + seedCount && ideas.length === 0) {
    console.log('[content-ideas] openlibrary could not be reached — no report, exiting blind');
    process.exit(2);
  }

  ideas.sort((a, b) => b.carries - a.carries);
  console.log(`[content-ideas] ${day}: ${count.size} distinct co-occurring subjects → ${candidates.length} candidates verified → ${ideas.length} new shelves that pass the 30-work bar`);
  for (const i of ideas) {
    console.log(`  ${String(i.carries).padStart(3)} works · seen ${String(i.cooccurs).padStart(2)}× beside today's shelves · ${i.term}`);
  }
  if (!ideas.length) console.log('  (nothing passed this run — the rotation is shallow, not empty; schedule again)');
  process.exit(0);
}

main().catch((err) => {
  console.error('[content-ideas] failed:', (err && err.message) || err);
  process.exit(2);
});
