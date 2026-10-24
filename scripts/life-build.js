'use strict';
// ── Build the long tail of /life: real species, from the world's own photographs ──
//
// WHY THIS IS A SCRIPT AND NOT A PAGE REQUEST
// The sixteen curated species in src/hidup.js resolve live, one lookup each, and that is fine at
// sixteen. A catalogue cannot work that way: a crawler arriving at a page that has to hit
// iNaturalist for the taxon AND for a wall of research-grade photographs would pay two slow calls
// to a free API with a low anonymous limit, and a thousand such pages is a thousand chances to be
// rate-limited or blocked. So species are built here, once, explicitly, and written to disk
// (data/life-species/<slug>.json plus a small index). A page request then costs one file read and
// never touches the network — the web process does not crawl, this process does, and it can be
// stopped, resumed and measured.
//
// WHICH SPECIES, AND WHY THEY ARE NOT INVENTED
// "The animals the world photographs most." iNaturalist returns its species list already sorted
// by observation count, so the build simply reads that order top down — no popularity is asserted
// here, the number on each page is the catalogue's own. A candidate becomes a page only after
// every one of these holds, in this order:
//   • it is a real, active, non-extinct species with an English common name to title it (hidup
//     .speciesQualifies) — otherwise we would be making a page called "Gerrhopilus depressiceps";
//   • it clears --min observations, so a research-grade photograph wall is guaranteed rather than
//     hoped for;
//   • it carries its OWN Wikipedia summary — the body text of a built page is that summary,
//     credited and linked, never prose this site writes about an animal it has not studied. A
//     species with no summary has nothing honest to say and is skipped;
//   • its wall actually has photographs on it after the observations call.
// The hand-authored sixteen are seeded first, so they keep their written blurbs and become disk
// pages too (robust, no live fetch), and a harvest that later reaches "Apis mellifera" reuses that
// slug and blurb instead of publishing a second, thinner page for the honey bee.
//
// BEING A GUEST ON SOMEBODY ELSE'S FREE API
// One axios instance with the outbound guard attached (deadline, cooldown, dedupe), a fixed gap
// between calls, a lifetime --calls budget, and a load check: if this box's own 1-minute load is
// above LOAD_MAX the run sleeps rather than adding to it. Two calls per published species (taxon
// then wall) plus one per discovery page; a 200-species run is roughly 420 calls, paced over many
// minutes. Ctrl-C is safe: state is written after every species and re-running resumes.
//
// USAGE
//   node scripts/life-build.js                       # default: 200 species, 800-call ceiling
//   node scripts/life-build.js --species=25 --calls=90   # a proof run before the real one
//   node scripts/life-build.js --gap=2000            # a quieter network, a longer run
const fs = require('fs');
const path = require('path');
const hidup = require('../src/hidup');

const STATE_FILE = path.join(path.dirname(hidup.SPECIES_INDEX_FILE), 'life-build-state.json');
const DEFAULTS = { species: 200, pages: 40, calls: 800, gap: 1200, min: hidup.OBS_MIN, wall: hidup.WALL };
const LOAD_MAX = 4;
const COOL_RETRY_MS = 130000; // the guard's cooldown is 120 s; ask again a moment after it lifts

function arg(name, fallback) {
  const m = new RegExp(`--${name}=(\\S+)`).exec(process.argv.join(' '));
  return m ? Number(m[1]) : fallback;
}
const OPTS = {
  species: arg('species', DEFAULTS.species),
  pages: arg('pages', DEFAULTS.pages),
  calls: arg('calls', DEFAULTS.calls),
  gap: arg('gap', DEFAULTS.gap),
  min: arg('min', DEFAULTS.min),
  wall: arg('wall', DEFAULTS.wall),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function load1() {
  try { return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]) || 0; } catch { return 0; }
}

function loadState() {
  const fresh = { ids: {}, slugs: {}, published: 0, page: 1, calls: 0, at: '' };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && raw.ids && typeof raw.ids === 'object') return { ...fresh, ...raw };
  } catch { /* first run: start clean */ }
  return fresh;
}
function saveState(state) {
  state.at = new Date().toISOString();
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

// The run's own call counter, and the pacing + load + cooldown wrapper every API call goes
// through. A cooled URL is waited out, not failed over, because there is no second source.
let spent = 0;
async function call(label, fn) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (spent >= OPTS.calls) throw new Error('call budget reached');
    if (load1() > LOAD_MAX) { console.log(`  load above ${LOAD_MAX}, waiting…`); await sleep(30000); }
    spent += 1;
    try {
      const out = await fn();
      await sleep(OPTS.gap);
      return out;
    } catch (e) {
      if (e && (e.cooling || e.code === 'EOUTBOUND_COOLING')) {
        console.log(`  ${label} cooling, waiting ${Math.round(COOL_RETRY_MS / 1000)}s…`);
        await sleep(COOL_RETRY_MS);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`${label}: gave up after cooldowns`);
}

/** A page deserves a body: sourced Wikipedia text, or a hand-written blurb for the curated set. */
function hasBody(full, curated) {
  return Boolean(curated) || (full.wikipedia_summary && String(full.wikipedia_summary).trim().length > 40);
}

/**
 * Turn one iNaturalist taxon into a published page: gate it, fetch its wall, keep it only if the
 * photographs are actually there. Returns the row, or a short reason it was refused (logged, not
 * an error — a refusal is the normal outcome for the thin end of the list).
 */
async function publish(taxonId, { slug, blurb, curated, knownName }) {
  const full = await call(`taxa/${taxonId}`, () => hidup.fetchFullTaxon(taxonId));
  const why = hidup.speciesQualifies(full);
  if (why) return `skip: ${why}`;
  if (!hasBody(full, curated)) return 'skip: no sourced summary to write from';

  const wall = await call(`obs/${taxonId}`, () => hidup.getObservations(taxonId, OPTS.wall));
  if (!wall.length) return 'skip: no research-grade photographs';

  const name = String(full.preferred_common_name || knownName || full.name || '').trim();
  const record = hidup.taxonToRecord(full, { slug, blurb });
  record.name = name;
  record.wall = wall;
  record.at = new Date().toISOString();
  hidup.saveSpecies(record);
  return `+ ${name} (${full.name}) · ${wall.length} photos`;
}

async function seedCurated(state) {
  for (const t of hidup.TAXA) {
    if (state.published >= OPTS.species || spent >= OPTS.calls) return;
    if (state.slugs[t.slug]) continue; // already written by a prior run
    try {
      const res = await call(`resolve/${t.sci}`, () => hidup.resolveTaxon(t));
      const msg = await publish(res.id, { slug: t.slug, blurb: t.blurb, curated: true, knownName: t.name });
      state.ids[res.id] = 1; state.slugs[t.slug] = 1;
      if (msg[0] === '+') state.published += 1;
      console.log(`[curated] ${msg}`);
      saveState(state);
    } catch (e) {
      console.log(`[curated] ! ${t.sci}: ${e.message}`);
    }
  }
}

// A slug from the English name, made unique against everything already published by appending the
// taxon id — two species can share a common name ("gray squirrel" and dozens of "bee" pages), and
// a url must never be ambiguous.
function uniqueSlug(base, taxonId, state) {
  let slug = base || `species-${taxonId}`;
  if (state.slugs[slug]) slug = `${base}-${taxonId}`.slice(0, 70);
  return slug;
}

async function harvest(state) {
  let page = state.page || 1;
  let emptyStreak = 0;
  while (state.published < OPTS.species && page <= OPTS.pages && spent < OPTS.calls) {
    let rows;
    try {
      rows = await call(`page/${page}`, () => hidup.fetchSpeciesPage(page, 30));
    } catch (e) {
      console.log(`[page ${page}] ! ${e.message}`);
      if (e.message === 'call budget reached') break;
      page += 1; continue;
    }
    if (!rows.length) { emptyStreak += 1; page += 1; if (emptyStreak > 2) { console.log('  no more species offered'); break; } continue; }
    emptyStreak = 0;

    for (const row of rows) {
      if (state.published >= OPTS.species || spent >= OPTS.calls) break;
      // Cheap reject on the compact row before spending two calls on it: the full object is what
      // carries the common name and summary, so only the flags that are already here are checked.
      if (row.rank !== 'species' || row.is_active === false || row.extinct === true) continue;
      if (!(Number(row.observations_count) >= OPTS.min)) continue;
      if (state.ids[row.id]) continue;
      const curatedMatch = hidup.curatedBySci.get(String(row.name).toLowerCase());
      if (curatedMatch && state.slugs[curatedMatch.slug]) { state.ids[row.id] = 1; continue; }
      try {
        const slug = curatedMatch ? curatedMatch.slug : uniqueSlug(hidup.slugify(row.preferred_common_name || row.name), row.id, state);
        const msg = await publish(row.id, {
          slug, curated: Boolean(curatedMatch),
          ...(curatedMatch ? { blurb: curatedMatch.blurb, knownName: curatedMatch.name } : {}),
        });
        state.ids[row.id] = 1;
        if (msg[0] === '+') { state.slugs[slug] = 1; state.published += 1; }
        console.log(`[${state.published}/${OPTS.species}] ${msg}`);
      } catch (e) {
        if (e.message === 'call budget reached') { console.log('  call budget reached'); break; }
        console.log(`  ! ${row.name}: ${e.message}`);
      }
    }
    page += 1; state.page = page; saveState(state);
  }
}

async function main() {
  const state = loadState();
  // Adopt anything already on disk into the in-memory sets so a resumed run never duplicates.
  for (const row of hidup.builtSpecies()) { state.slugs[row.slug] = 1; }
  spent = Number(state.calls) || 0;
  console.log(`life-build: target ${OPTS.species} species · call budget ${OPTS.calls} · min ${OPTS.min} obs · resume at ${state.published} published, ${spent} calls spent`);
  await seedCurated(state);
  await harvest(state);
  state.calls = spent;
  saveState(state);
  console.log(`\ndone: ${state.published} species published, ${spent} calls spent.`);
  console.log(`a page request now costs one small file read and never reaches iNaturalist.`);
}

main().catch((e) => { console.error('life-build failed:', e.message); process.exit(1); });
