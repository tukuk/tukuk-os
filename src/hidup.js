'use strict';
// ── TUKUK-OS WILDLIFE ATLAS (/hidupan) — iNaturalist API ─────────────────────
// Sumber: api.inaturalist.org — PERCUMA tanpa kunci (had anonim rendah; semua
// respons di-cache panjang + permintaan minimum). Rekod gred-kajian dengan foto
// berlesen Creative Commons; atribusi setiap foto dipaparkan seperti diminta
// lesen. ID takson TIDAK dihardcode — dicari semasa via exact_name dan dipaut
// dalam cache 30 hari supaya ralat nama saintifik tidak menjejaskan tapak.
const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }),
  headers: { 'User-Agent': 'TukukOS-Wildlife-Client/1.0 (+https://tukuk.org)' },
});

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

// Kurasi trek satwa — nama saintifik sah (sistem Binomial), blurb edukatif BM/EN
// jujur & dilabel konservatif. Slug menjadi URL halaman.
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

// Selesaikan nama saintifik → takon iNaturalist (exact match dahulu).
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

// Rekod kajian bertopik dengan foto (attribution CC disertakan).
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

module.exports = { TAXA, findTaxon, resolveTaxon, getObservations };
