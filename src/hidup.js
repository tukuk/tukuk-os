'use strict';
// ── TUKUK-OS WILDLIFE ATLAS (/hidupan) — iNaturalist API ─────────────────────
// Source: api.inaturalist.org — FREE with no key (low anonymous limits; all
// responses are cached long-term + requests minimized). Research-grade records with
// Creative Commons-licensed photos; every photo's attribution is shown exactly as the
// license requires. Taxon IDs are NOT hardcoded — resolved at runtime via exact_name and cached
// for 30 days so a scientific-name typo can never hurt the site.
const axios = require('axios');
const { attachGuard } = require('./outbound');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }),
  headers: { 'User-Agent': 'TukukOS-Wildlife-Client/1.0 (+https://tukuk.org)' },
});
// Dedupe + failure cooldown, declared 15 s kept as the deadline (src/outbound.js).
attachGuard(http, { name: 'hidup' });

const API = 'https://api.inaturalist.org/v1';
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttlMs) { cache.set(key, { data, expiresAt: Date.now() + ttlMs }); }
const TTL_TAXON = 30 * 24 * 60 * 60 * 1000;
const TTL_OBS = 24 * 60 * 60 * 1000;

// Curated animal tracks — valid scientific names (binomial system), honest educational
// blurbs & conservatively labelled. The slug becomes the page URL.
const TAXA = [
  { slug: 'monarch-butterfly', sci: 'Danaus plexippus', icon: '🦋', name: 'Monarch Butterfly',
    blurb: 'Famous for a two-to-three-generation migration across a continent each autumn — no individual makes the round trip, yet the map is inherited. Milkweed is the only nursery its caterpillars accept.' },
  { slug: 'bengal-tiger', sci: 'Panthera tigris tigris', icon: '🐅', name: 'Bengal Tiger',
    blurb: 'The most numerous tiger subspecies, mostly inside India’s reserves. Fewer than 4,000 remain wild — an increase from the ~1,600 lows of the 1970s, proof that protection works when funded.' },
  { slug: 'snow-leopard', sci: 'Panthera uncia', icon: '🐆', name: 'Snow Leopard',
    blurb: 'High-central-Asia ghost: fur the colour of scree, a tail nearly body-length for balance on cliffs. Counted from camera traps and scat DNA because almost nobody has ever seen one at close range.' },
  { slug: 'giant-panda', sci: 'Ailuropoda melanoleuca', icon: '🐼', name: 'Giant Panda',
    blurb: 'A carnivore’s gut on a bamboo diet — it must eat 10+ hours daily. Downgraded from Endangered to Vulnerable in 2016 after reserve expansion grew wild numbers by roughly 17% in a decade.' },
  { slug: 'african-elephant', sci: 'Loxodonta africana', icon: '🐘', name: 'African Savanna Elephant',
    blurb: 'The largest land animal: up to 6 tonnes, ears that work as radiators, and a matriarchal memory for water across decades. A keystone engineer — whole landscapes depend on their browsing.' },
  { slug: 'red-fox', sci: 'Vulpes vulpes', icon: '🦊', name: 'Red Fox',
    blurb: 'The widest-ranging land carnivore on Earth — native across the northern hemisphere and introduced (and damaging) in Australia. Hunts rodents by hearing, pouncing ear-down into snow.' },
  { slug: 'barn-owl', sci: 'Tyto alba', icon: '🦉', name: 'Barn Owl',
    blurb: 'Nearly cosmopolitan, living with farms for a reason: a single pair reaps over 1,000 rodents a year. Its face disc is a tuned parabolic antenna; flight feathers are velvety-quiet.' },
  { slug: 'green-sea-turtle', sci: 'Chelonia mydas', icon: '🐢', name: 'Green Sea Turtle',
    blurb: 'Named for its green fat, not its shell — adults graze seagrass meadows, keeping them productive nurseries for fish. Returns to the beach where it hatched, decades earlier, to nest.' },
  { slug: 'honeybee', sci: 'Apis mellifera', icon: '🐝', name: 'Western Honey Bee',
    blurb: 'The managed pollinator behind roughly a third of food we buy — though wild pollinators do the unsung majority. Waggle dances encode distance and direction of flowers as body angles.' },
  { slug: 'monarch-moth', sci: 'Actias luna', icon: '🌙', name: 'Luna Moth',
    blurb: 'Pale-green satellites of eastern North American forests; adults have no mouthparts and live about a week on fat reserves alone. Tails on the hindwings tumble the flight path to confuse bat sonar.' },
  { slug: 'gray-squirrel', sci: 'Sciurus carolinensis', icon: '🐿️', name: 'Eastern Gray Squirrel',
    blurb: 'The city squirrel of two continents — introduced into Italy and Britain, where it outcompetes and hybridises with the native red. Plants forests by forgetting buried nuts.' },
  { slug: 'harpy-eagle', sci: 'Harpia harpyja', icon: '🦅', name: 'Harpy Eagle',
    blurb: 'The world’s strongest raptor by talon grip, taking sloths and monkeys from the canopy. Near-threatened: it needs unbroken rainforest and vanishes where logging fragments it.' },
  { slug: 'axolotl', sci: 'Ambystoma mexicanum', icon: '🦎', name: 'Axolotl',
    blurb: 'A salamander that never grows up — keeps gills and breeds as a larva. Critically endangered in the wild (one canal complex in Mexico City) while lab and aquarium numbers thrive.' },
  { slug: 'horseshoe-crab', sci: 'Tachypleus tridentatus', icon: '🦀', name: 'Horseshoe Crab',
    blurb: 'A 450-million-year lineage older than dinosaurs. Blue, copper-based blood that clots on bacteria made it the medical safety-test for injections; spawning beaches now need guards.' },
  { slug: 'bumblebee', sci: 'Bombus terrestris', icon: '🐝', name: 'Buff-tailed Bumblebee',
    blurb: 'Can buzz-pollinate — shaking flowers at flight frequency to blast pollen loose, the only way tomatoes and blueberries set fruit well. Thermoregulates by fanning in the nest.' },
  { slug: 'clown-anemonefish', sci: 'Amphiprion ocellaris', icon: '🐠', name: 'Ocellaris Clownfish',
    blurb: 'Lives immune inside a stinging anemone thanks to a protective mucus coat, and all are born male — the dominant one turns female when the queen dies. Made famous, then over-collected, by film.' },
];
function findTaxon(slug) {
  return TAXA.find((t) => t.slug === String(slug || '')) || null;
}

// Resolve a scientific name → iNaturalist taxon (exact match first).
async function resolveTaxon(t) {
  const key = `taxon:${t.sci}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get(`${API}/taxa`, { params: { q: t.sci, exact_name: t.sci, limit: 1 } });
  const r = res.data && res.data.results && res.data.results[0];
  if (!r) throw new Error('taxon not found: ' + t.sci);
  const out = {
    id: r.id, sci: r.name, rank: r.rank,
    common: (r.common_name && r.common_name.name) || t.name,
    photo: r.default_photo && (r.default_photo.medium_url || r.default_photo.square_url),
    photoCredit: (r.default_photo && r.default_photo.attribution) || '',
    wikiUrl: r.wikipedia_url || null,
    ancestorIds: (r.ancestry || '').split(',').filter(Boolean).map(Number),
  };
  cacheSet(key, out, TTL_TAXON);
  return out;
}

// Research-grade records for a taxon with photos (CC attribution included).
async function getObservations(taxonId, want) {
  const key = `obs:${taxonId}:${want}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get(`${API}/observations`, {
    params: { taxon_id: taxonId, quality_grade: 'research', 'has[]': 'photos', per_page: want, page: 1 },
  });
  const rows = ((res.data && res.data.results) || []).map((o) => {
    const p = (o.photos && o.photos[0]) || null;
    const t = o.taxon || {};
    return {
      id: o.id,
      date: o.observed_on || (o.time_observed_at || '').slice(0, 10) || '',
      place: o.place_guess || (o.geoprivacy === 'obscured' ? 'private location' : ''),
      uri: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
      photoUrl: p ? (p.medium_url || p.square_url) : null,
      attribution: p ? (p.attribution || `${(o.identity && o.identity.user && o.identity.user.name) || 'observer'} / iNaturalist`) : '',
      license: p && p.license ? String(p.license) : null,
      taxonName: t.name || '',
      taxonCommon: (t.common_name && t.common_name.name) || '',
    };
  }).filter((r) => r.photoUrl);
  cacheSet(key, rows, TTL_OBS);
  return rows;
}

// ── THE BUILT ATLAS (scale) ───────────────────────────────────────────────────
// The sixteen above are hand-authored, with a hand-written natural-history blurb each. That
// is not something a machine can honestly mass-produce, so the expansion works exactly like
// /books: an explicit, bounded, resumable build (scripts/life-build.js) harvests "the species
// the world photographs most" — iNaturalist's default species sort IS observation count — and
// writes each one to disk. A page request then reads a small file already on this box and NEVER
// reaches the API, because a crawler storm of live lookups against iNaturalist's low anonymous
// limit would be both fragile and rude. The body text of a built page is not invented here: it
// is the taxon's own Wikipedia summary, credited and linked — the same rule /recipes keeps with
// the Wikibooks Cookbook.
//
// Data lives in two places, mirroring books: a small index (one row per built species) that
// every hub, A–Z and sitemap reads, and one JSON file per species (the page: summary, lineage,
// conservation status, the reference photo and a wall of research-grade observations) read only
// when that species is opened. Photo URLs point at iNaturalist's own open-data S3; we store the
// link and the credit, never the bytes.
const DATA_DIR = path.dirname(config.store.path);
const SPECIES_DIR = path.join(DATA_DIR, 'life-species');
const SPECIES_INDEX_FILE = path.join(DATA_DIR, 'life-species.json');
const OBS_MIN = 50;              // below this there may be no research-grade photo to show
const WALL = 8;                  // community photographs per species page

const readJson = (file) => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch { return null; }
};
const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // rename is atomic: a reader never sees half a file
};

/** A url-safe species slug from a display name; the caller guarantees uniqueness. */
function slugify(name) {
  const folded = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return folded || '';
}

/**
 * Does a candidate taxon deserve a page? Pure, so the honest bar can be argued in a test rather
 * than discovered as a thin page. A species qualifies only if it is a real, active species with
 * an English common name (else we would be titling a page by a Latin binomial nobody searches),
 * enough observations that a research-grade photograph wall is guaranteed, and — checked once the
 * full taxon is fetched — its own Wikipedia summary, because without sourced prose a built page
 * would be a picture with nothing honest to say about it. `obsCount` here is the catalogue's own
 * number, not a claim we make.
 */
function speciesQualifies(t) {
  if (!t || t.rank !== 'species') return 'not a species';
  if (t.is_active === false || t.extinct === true || t.provisional === true) return 'inactive, extinct or provisional';
  const common = String(t.preferred_common_name || '').trim();
  if (!common) return 'no English common name to title the page';
  if (!(Number(t.observations_count) >= OBS_MIN)) return `only ${t.observations_count || 0} observations (needs ${OBS_MIN})`;
  return null;
}

// A curated scientific name → its hand-authored entry, so the build reuses the good slug and
// keeps the written blurb instead of publishing a second, thinner page for the same animal.
const curatedBySci = new Map(TAXA.map((t) => [String(t.sci).toLowerCase(), t]));

/**
 * The index of built species, re-read when the file's mtime moves (as books does) so a finished
 * build becomes visible without restarting the site. Only rows with a display name and a record
 * on disk are trusted; the count is used by the hub and the A–Z page.
 */
let builtCache = null;
let builtCacheAt = 0;
function builtSpecies() {
  let mtime = 0;
  try { mtime = fs.statSync(SPECIES_INDEX_FILE).mtimeMs; } catch { /* not built yet */ }
  if (builtCache && builtCacheAt === mtime) return builtCache;
  const raw = readJson(SPECIES_INDEX_FILE);
  builtCache = Array.isArray(raw) ? raw.filter((r) => r && r.slug && r.name).sort((a, b) => (b.obs || 0) - (a.obs || 0)) : [];
  builtCacheAt = mtime;
  return builtCache;
}
function reloadSpecies() { builtCache = null; builtCacheAt = 0; }

/** The full page record for one species, or null if it has not been built. */
function speciesRecord(slug) {
  const key = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!key) return null;
  return readJson(path.join(SPECIES_DIR, `${key}.json`));
}

/** Save one species page + upsert its index row. Called only by the build script. */
function saveSpecies(record) {
  writeAtomic(path.join(SPECIES_DIR, `${record.slug}.json`), JSON.stringify(record));
  const list = readJson(SPECIES_INDEX_FILE);
  const rows = Array.isArray(list) ? list : [];
  const row = { slug: record.slug, name: record.name, sci: record.sci, obs: record.obsCount || 0, blurb: Boolean(record.blurb), at: record.at };
  const i = rows.findIndex((r) => r && r.slug === record.slug);
  if (i >= 0) rows[i] = row; else rows.push(row);
  writeAtomic(SPECIES_INDEX_FILE, JSON.stringify(rows));
  reloadSpecies();
  return row;
}

function inventory() {
  try { return fs.statSync(SPECIES_INDEX_FILE).size > 2; } catch { return false; }
}

// iNaturalist carries the IUCN code verbatim; expanding it to words is formatting, and the
// page always names the assessment as the catalogue's own rather than a claim we are making.
const IUCN = { ex: 'Extinct', ew: 'Extinct in the Wild', cr: 'Critically Endangered', en: 'Endangered',
  vu: 'Vulnerable', nt: 'Near Threatened', dd: 'Data Deficient', lc: 'Least Concern', ne: 'Not Evaluated' };

/** Wikipedia's summary markup reduced to safe plain text — we render no external HTML. */
function summarise(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&(?:#39|apos);/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\[[a-z0-9 ,]*\]/gi, '')
    .replace(/\s+/g, ' ').trim().slice(0, 900);
}

/**
 * The full iNaturalist taxon object (from /taxa/{id}?locale=en, which is the only shape that
 * returns preferred_common_name AND wikipedia_summary together) folded into what a page needs.
 * Pure and offline so the mapping — especially the lineage filter and the status expansion — can
 * be checked in a test against a captured payload rather than discovered on a thin page.
 */
function taxonToRecord(r, opts) {
  const o = opts || {};
  const keep = ['kingdom', 'phylum', 'class', 'order', 'family'];
  const ancestors = Array.isArray(r.ancestors) ? r.ancestors.filter((a) => keep.includes(a.rank)) : [];
  const cs = r.conservation_status && r.conservation_status.status ? r.conservation_status : null;
  const dp = r.default_photo || null;
  return {
    slug: o.slug, taxonId: r.id, sci: r.name, name: String(r.preferred_common_name || '').trim(),
    rank: r.rank, ...(o.blurb ? { blurb: o.blurb } : {}),
    summary: summarise(r.wikipedia_summary), summaryUrl: r.wikipedia_url || null,
    classification: ancestors.map((a) => ({ rank: a.rank, name: a.name })),
    ...(cs ? { conservation: { code: cs.status, label: IUCN[cs.status] || cs.status, authority: cs.authority || null } } : {}),
    obsCount: Number(r.observations_count) || 0,
    photo: dp ? { url: dp.medium_url || dp.square_url, credit: dp.attribution || '', license: dp.license_code || null } : null,
    iNatUrl: `https://www.inaturalist.org/taxa/${r.id}`,
  };
}

// One full call per surviving species returns everything a page shows except the photograph
// wall; the wall is a second call. Both go through the same guarded client (src/outbound.js).
async function fetchFullTaxon(id) {
  const res = await http.get(`${API}/taxa/${id}`, { params: { locale: 'en' } });
  const r = res.data && res.data.results && res.data.results[0];
  if (!r) throw new Error(`taxon ${id} not found`);
  return r;
}

/**
 * One page of the species catalogue in iNaturalist's own default order — which IS observation
 * count, highest first. That is why no sort parameter is needed and why the harvest reads top
 * down: page 1 is the mallard, the honey bee, the ladybird and the house sparrow, the animals the
 * world photographs most. Returns the compact rows (id, name, rank, observations_count, flags).
 */
async function fetchSpeciesPage(page, perPage = 30) {
  const res = await http.get(`${API}/taxa`, { params: { rank: 'species', per_page: perPage, page } });
  return (res.data && res.data.results) || [];
}

module.exports = { TAXA, findTaxon, resolveTaxon, getObservations,
  SPECIES_DIR, SPECIES_INDEX_FILE, OBS_MIN, WALL, curatedBySci,
  slugify, speciesQualifies, builtSpecies, reloadSpecies, speciesRecord, saveSpecies, inventory,
  summarise, taxonToRecord, fetchFullTaxon, fetchSpeciesPage };

