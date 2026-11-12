#!/usr/bin/env node
'use strict';
// ── Repair the HTML that crept into the place corpora ─────────────────────────
//
// WHY THIS EXISTS. src/warisan-data.json (/heritage — UNESCO World Heritage) was ingested
// from Wikipedia tables and the ingest never decoded what it copied. 153 of the 1,523 site
// NAMES and 39 of the `wiki` page titles are stored as MARKUP-AS-TEXT, and once the markup
// is decoded 28 of those rows turn out to be sites the file already held, spelled properly:
//
//   "Silk Roads: the Routes Network of Chang&apos;an-Tianshan Corridor"
//   "Qhapaq &#xd1;an, Andean Road System"
//   "Venetian Works of Defence ...: &lt;em&gt;Stato da Terra&lt;/em&gt; ..."   ← double-encoded
//   "Uluru-Kata Tjuta National Park"  +  "Ulu&lt;U&gt;r&lt;/U&gt;u-Kata ..."  ← the same site twice
//
// src/deepsky-data.json has the same class of defect in one place: "γ<sup>2</sup> Normae"
// stored as raw markup inside a constellation name.
//
// Three separate damages followed:
//   1. Display. The page shells escape every string once (that is correct), so `&apos;`
//      becomes `&amp;apos;` and the reader sees "Chang&apos;an" in the <h1> of a UNESCO
//      site — and so does the search engine.
//   2. Slug. slugify() runs on the stored text, so the address became
//      /heritage/fert-xf6-neusiedlersee-cultural-landscape instead of
//      /heritage/ferto-neusiedlersee-cultural-landscape.
//   3. The summary fetch. warisan.js asks the Wikipedia REST API for the `wiki` title
//      verbatim; "Chang&apos;an-Tianshan Corridor" is not a page, so those sites could
//      never load their introduction — the page fell back to "briefly reloading" forever.
//
// This script decodes entities (repeatedly, because of the double-encoded ones), drops the
// remaining tags (<em>, <sup> — the text inside them stays), collapses whitespace, and
// rewrites the file in its original one-record-per-line shape so the diff shows only the
// records that actually changed.
//
// Slug churn is handled honestly: every old slug goes into migrations/heritage-slug-301.json
// and is installed as a 301, so the sitemap address changes and the indexed one keeps working.
//
//   node scripts/fix-geo-entities.js                    # report only, nothing is written
//   node scripts/fix-geo-entities.js --apply            # rewrite the data files
//   node scripts/fix-geo-entities.js --emit-redirects   # print legacyRedirect rows
//   node scripts/fix-geo-entities.js --patch-redirects  # install them into src/server.js
//
// Idempotent both ways: a second run reports 0 changes, and --patch-redirects never adds a
// row that is already in server.js.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILES = ['src/warisan-data.json', 'src/deepsky-data.json'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeOnce(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});/g, (m, name) => {
    const low = name.toLowerCase();
    if (ENTITIES[low] !== undefined) return ENTITIES[low];
    // The capture group is `#xd1` / `&#39`-style WITHOUT the leading `&`. Hex has to be
    // tested before decimal: parseInt('#xd1'.slice(1), 10) is NaN, and the entity would
    // silently survive the "repair" (that is exactly what the first version did).
    let cp;
    if (low.startsWith('#x')) cp = parseInt(low.slice(2), 16);
    else if (low[0] === '#') cp = parseInt(low.slice(1), 10);
    else return m;
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return m; // leave junk alone
    try { return String.fromCodePoint(cp); } catch (_e) { return m; }
  });
}

// `&amp;lt;em&amp;gt;` needs two passes; stop when the string stops changing or when a
// pass would only resurrect markup (safety valve: never loop forever).
function decodeAll(s) {
  let prev;
  let cur = s;
  for (let i = 0; i < 4 && cur !== prev; i += 1) {
    prev = cur;
    cur = decodeOnce(cur);
  }
  return cur;
}

function clean(s) {
  if (typeof s !== 'string') return s;
  return decodeAll(s)
    .replace(/<\/?(?:sup|sub)>/g, '')              // γ<sup>2</sup> → γ2 (the digits stay, nothing invented)
    .replace(/<[^>]+>/g, '')                       // markup that survived decoding
    .replace(/\s+/g, ' ')
    .trim();
}

// Deep-clean any JSON shape: arrays of records, or one object holding arrays (deepsky).
function cleanDeep(v) {
  if (Array.isArray(v)) return v.map(cleanDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = cleanDeep(v[k]);
    return out;
  }
  return clean(v);
}

// Same rules as slugify() in src/warisan.js — kept here so the report matches the app.
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function serialize(rec) {
  return '{' + Object.keys(rec).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(rec[k])}`).join(', ') + '}';
}

const apply = process.argv.includes('--apply');
const emit = process.argv.includes('--emit-redirects');
const redirects = [];
const dropped = [];

for (const rel of DATA_FILES) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(original);
  const list = Array.isArray(parsed) ? parsed : null;

  let changedRecords = 0;
  let changedFields = 0;
  let out = list;

  if (list) {
    // ── an array of records (warisan): clean in place, then collapse true duplicates ──
    for (const rec of list) {
      const before = { ...rec };
      for (const k of Object.keys(rec)) rec[k] = clean(rec[k]);
      if (JSON.stringify(rec) !== JSON.stringify(before)) {
        changedRecords += 1;
        changedFields += Object.keys(rec).filter((k) => rec[k] !== before[k]).length;
        if (before.name !== rec.name) redirects.push([slugify(before.name), slugify(rec.name)]);
      }
    }
    // Two ingest passes left some sites in the file TWICE — once spelled properly, once as
    // markup ("Uluru-Kata Tjuta National Park" and "Ulu<U>r</U>u-Kata Tju<U>t</U>a National
    // Park"). After decoding they are the SAME site, so the later row is dropped. Keyed on the
    // SLUG, not the spelling: "Archaeological Ensemble of Merida" (accent lost) and
    // "Archaeological Ensemble of Mérida" are one site at one address. Dropping the extras
    // also removes 28 duplicate pages — the same site answering two URLs is a search penalty
    // as well as a reader confusion.
    const keep = [];
    const taken = new Set();
    for (const r of list) {
      const slug = slugify(r.name);
      if (taken.has(slug)) dropped.push({ slug, name: r.name });
      else { taken.add(slug); keep.push(r); }
    }
    out = keep;
  } else {
    // ── any other shape (deepsky is one object of arrays): clean, report, don't restructure ──
    out = cleanDeep(parsed);
    if (JSON.stringify(out) !== JSON.stringify(parsed)) { changedRecords = 1; changedFields = -1; }
  }

  // The whole array is re-emitted in the file's own shape (one record per line, or compact).
  // That also normalises a number like -3.0 to -3, which is why this repair is a one-off run:
  // the second run reports 0 changes and writes nothing.
  const perLine = list && original.split('\n').length > 50;
  const body = perLine
    ? '[\n' + out.map((r, i) => serialize(r) + (i < out.length - 1 ? ',' : '')).join('\n') + '\n]\n'
    : JSON.stringify(out);
  console.log(`${rel}: ${changedRecords} record(s) cleaned${list ? `, ${changedFields} field(s) touched, ${dropped.length} duplicate(s) dropped` : ''}`);
  if (apply && changedRecords > 0) fs.writeFileSync(file, body);

  // Every place slug must stay unique — a second record with the same slug would be
  // unreachable for ever (Map.get() in src/warisan.js keeps only one of them).
  if (list) {
    const slugs = out.map((r) => slugify(r.name));
    const seen = new Map();
    for (const s of slugs) seen.set(s, (seen.get(s) || 0) + 1);
    const dupe = [...new Set(slugs.filter((s) => seen.get(s) > 1))];
    if (dupe.length) {
      // Exit non-zero rather than only print: a duplicated slug is a page no request can
      // ever reach, so a repair that quietly produces one is not a repair.
      console.error(`COLLISION in ${rel} — ${dupe.length} slug(s) not unique: ${dupe.slice(0, 10).join(', ')}`);
      process.exitCode = 1;
    }
  }
}

const real = redirects.filter(([o, n]) => o !== n);
console.log(`slug changes needing a 301: ${real.length}; duplicate rows dropped: ${dropped.length}`);
if (dropped.length && !emit) console.log(`  dropped: ${dropped.slice(0, 6).map((d) => d.name).join(' | ')}${dropped.length > 6 ? ' …' : ''}`);
if (emit) {
  for (const [o, n] of real) console.log(`  ['/heritage/${o}', '/heritage/${n}'],`);
}
if (!apply && real.length) console.log('(dry run — nothing was written; pass --apply)');

// ── install the committed rename table as 301 routes ────────────────────────────────
if (process.argv.includes('--patch-redirects')) {
  const MAPFILE = path.join(ROOT, 'migrations', 'heritage-slug-301.json');
  const srvfile = path.join(ROOT, 'src', 'server.js');
  const map = JSON.parse(fs.readFileSync(MAPFILE, 'utf8'));
  let src = fs.readFileSync(srvfile, 'utf8');
  const anchor = '].forEach(function (pair) { legacyRedirect(pair[0], pair[1], pair[2]); });';
  if (!src.includes(anchor)) { console.error('patch-redirects: the legacyRedirect table was not found — nothing touched'); process.exit(1); }
  const missing = map.filter((m) => !src.includes(`'${m.from}'`));
  if (!missing.length) { console.log(`patch-redirects: all ${map.length} rows are already installed`); }
  else {
    const block = [
      '  // /heritage: the World Heritage corpus stored 153 names as HTML entities, so the slug',
      '  // derived from them ("/heritage/fert-xf6-neusiedlersee-…") was junk, and decoding the data',
      '  // moved those pages. Every old address 301s to the clean one — table and repair recorded',
      '  // in scripts/fix-geo-entities.js + migrations/heritage-slug-301.json.',
      ...missing.map((m) => `  ['${m.from}', '${m.to}'],`),
      '',
    ].join('\n');
    src = src.replace(anchor, block + anchor);
    fs.writeFileSync(srvfile, src);
    console.log(`patch-redirects: installed ${missing.length} of ${map.length} rows into src/server.js`);
  }
}
