'use strict';
// catalogue-truth.js — re-verify a rotating sample of curated shelves against
// Open Library, the same way the batches were verified by hand.
//
// Why this exists: every one of the 878 terms was proven to carry >= 30 exact
// subject matches at curation time (Nov 2026). "At the time" is the weak part —
// Open Library is a living catalogue, records get edited, subjects get renamed,
// and a shelf that silently stops matching books is a page of nothing offered
// as a reading list. Nothing else in CI can see this: unit tests mock fetch,
// the canary only proves the page returns 200.
//
// Rotation: samples every STRIDEST entry starting at a day-of-year offset, so
// consecutive runs walk different sevenths of the catalogue and a full sweep
// happens in weeks, not never. A fixed 120 would check the same alphabetically
// early shelves forever.
//
// Rate discipline (learned the hard way during batch verification): requests
// are strictly sequential with a gap, and one retry after a longer pause.
// Parallel bursts get throttled/ECONNRESET by openlibrary and the failures
// look exactly like dead shelves. A network that fails twice in a row is
// reported as rc 2 (the checker is blind), NOT as broken shelves — a blind
// monitor must never page for a redeploy.
//
// Usage: node scripts/catalogue-truth.js [--sample N] [--min CARRIES] [--day YYYY-MM-DD]
// Exit: 0 all sampled shelves carry books · 1 one or more shelves are dead/thin ·
//       2 the network made verification impossible (treat as blind, not red)
process.on('unhandledRejection', (err) => {
  console.error('[catalogue-truth] unhandled rejection:', err);
  process.exit(2);
});

const BOOKS_URL = 'https://openlibrary.org/search.json';
const GAP_MS = 280; // the cadence three verification batches ran without throttling
const RETRY_WAIT_MS = 3000;
const UA = 'tukuk.org-catalogue-truth/1.0 (https://tukuk.org; maintenance check)';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exact-lowercase carry count, byte-for-byte the product's own rule
// (books.carriesSubject) applied to a full search page.
async function carries(term) {
  const url = `${BOOKS_URL}?q=${encodeURIComponent(`subject:"${term}"`)}&limit=100&fields=title,subject`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from openlibrary`);
  const docs = ((await res.json()).docs) || [];
  const want = term.toLowerCase();
  return docs.filter((d) => Array.isArray(d.subject) && d.subject.some((s) => String(s).toLowerCase() === want)).length;
}

async function carriesTolerant(term) {
  try {
    return await carries(term);
  } catch (e) {
    await sleep(RETRY_WAIT_MS);
    return await carries(term); // second failure propagates — the caller counts blindness
  }
}

async function main() {
  const { SUBJECTS } = require('../src/books.js');
  const sample = Math.max(1, Math.min(Number(arg('sample', 120)), SUBJECTS.length));
  const minCarries = Number(arg('min', 10));
  const day = arg('day', new Date().toISOString().slice(0, 10));

  // Pick every (len/sample)-th shelf from a daily-moving start so runs tile the catalogue.
  const stride = Math.max(1, Math.floor(SUBJECTS.length / sample));
  const dayNum = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const offset = ((dayNum % stride) + stride) % stride;

  const picked = [];
  for (let i = offset; picked.length < sample && i < SUBJECTS.length; i += stride) picked.push(SUBJECTS[i]);

  console.log(`[catalogue-truth] day ${day}: sampling ${picked.length}/${SUBJECTS.length} shelves, min carries ${minCarries}`);
  const thin = [];
  const dead = [];
  let blind = 0;
  let ok = 0;
  for (const s of picked) {
    let n;
    try {
      n = await carriesTolerant(s.term);
    } catch (e) {
      blind++;
      console.log(`  BLIND  ${s.slug}: ${e.message}`);
      await sleep(GAP_MS);
      continue;
    }
    if (n === 0) {
      dead.push(s.slug);
      console.log(`  DEAD   ${s.slug} ("${s.term}") carries 0 works`);
    } else if (n < minCarries) {
      thin.push({ slug: s.slug, n });
      console.log(`  THIN   ${s.slug} ("${s.term}") carries ${n} (< ${minCarries})`);
    } else {
      ok++;
    }
    await sleep(GAP_MS);
  }

  console.log(`[catalogue-truth] ${ok} ok · ${thin.length} thin · ${dead.length} dead · ${blind} blind`);
  if (dead.length) console.log(`dead shelves: ${dead.join(', ')}`);
  if (thin.length) console.log(`thin shelves: ${thin.map((t) => `${t.slug}(${t.n})`).join(', ')}`);

  // Blindness is not evidence of broken shelves; only report it, never fail on it.
  if (blind > picked.length / 2) {
    console.log('[catalogue-truth] could not verify most of the sample — exiting blind (rc 2)');
    process.exit(2);
  }
  // Thin shelves are a warning, not an incident: OL counts wobble. Dead is a promise broken.
  if (dead.length) process.exit(1);
  if (blind > 0) console.log(`(${blind} shelves could not be checked this run; they will rotate back)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[catalogue-truth] failed:', (err && err.message) || err);
  process.exit(2); // a crashed checker is blind, not a verdict
});
