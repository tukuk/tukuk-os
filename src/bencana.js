'use strict';
// ── TUKUK-OS BENCANA COMPLEX — pemantau acara alam langsung NASA EONET ──
// Sumber: https://eonet.gsfc.nasa.gov/api/v3 — NASA Earth Observatory Network,
// dibuka 24/7 oleh kurator manusia + satelit. TANPA kunci, tanpa daftar.
// Meliputi gunung berapi, taufan/ribut, kebakaran lahan, banjir, kemarau,
// tanah runtuh, salji, habuk, ais laut dan isu air di seluruh dunia.
const https = require('https');

const EONET = 'https://eonet.gsfc.nasa.gov/api/v3';
const cache = new Map();
const TTL_OPEN = 6 * 60 * 60 * 1000;  // senarai acara dibuka kemas kini beberapa kali sehari
const TTL_ONE = 24 * 60 * 60 * 1000;  //butiran satu acara

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + (ttl || TTL_OPEN) });
}

// Agent IPv6 didahulukan (pitfall dns ipv4first global server.js).
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Bencana-Client/1.0 (+https://tukuk.org)' } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpsGet(next, agent).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); }
  catch { return await httpsGet(url, v4Agent); }
}

// Kategori dipilih (id EONET → slug/bm), dengan blurb edukatif Bahasa Melayu
// yang menjadi bahan SEO setiap halaman kategori.
const CATS = [
  { id: 'volcanoes', slug: 'gunung-berapi', bm: 'Gunung Berapi', icon: '🌋',
    blurb: 'Aktiviti gunung berapi yang sedang dipantau — letusan, gegaran vulkanik, aliran lava dan amaran abu. Abu vulkanik boleh terbang ribuan kilometer dan menggangu penerbangan, jadi senarai ini dikemas kini kurator NASA dari laporan VAAC dan observatori seluruh dunia.' },
  { id: 'severeStorms', slug: 'taufan-ribut', bm: 'Taufan & Ribut', icon: '🌀',
    blurb: 'Siklon tropika, taufan, topan dan ribut petir dahsyat — dikesan dari angkasa lewat imbasan satelit geostasioner. Nama badai datang daripada senarai berputar enam regional; kekuatan diukur dengan skala Saffir–Simpson bagi belahan bumi barat dan skala JMA di Asia.' },
  { id: 'wildfires', slug: 'kebakaran-lahan', bm: 'Kebakaran Lahan & Hutan', icon: '🔥',
    blurb: 'Kebakaran hutan, semak dan lahan gambut yang aktif — dikesan oleh sensor MODIS/VIIRS yang menangkap haba terbakar dari orbit. Asap kebakaran boleh mengelilingi benua dan mempengaruhi kualiti udara negara yang jauh.' },
  { id: 'floods', slug: 'banjir', bm: 'Banjir', icon: '🌊',
    blurb: 'Banjir sungai, kilat dan monsun yang menjejaskan penduduk — laporan agensi bencana dan imej satelit perairan (Sentinel-1 menembus awan). Banjir adalah bencana paling kerap berlaku di dunia; lebih 1.5 bilion manusia pernah terjejas setiap dekad.' },
  { id: 'drought', slug: 'kemarau', bm: 'Kemarau', icon: '☀️',
    blurb: 'Tempat yang mengalami kekurangan hujan berpanjangan — dipantau dengan indeks kelewatan tanah dan suhu permukaan. Kemarau bergerak perlahan tetapi membunuh paling banyak ternakan dan tanaman daripada bencana lain yang tiba-tiba.' },
  { id: 'landslides', slug: 'tanah-runtuh', bm: 'Tanah Runtuh', icon: '⛰️',
    blurb: 'Runtuhan lereng, longsor dan aliran serpihan — selalunya dicetuskan hujan lebat atau gempa bumi di kawasan berbukit. Tropika yang bergunung seperti Indonesia dan Filipina sangat terdedah pada musim monsun.' },
  { id: 'snow', slug: 'salji-beku', bm: 'Salji & Cuaca Beku', icon: '❄️',
    blurb: 'Badai salji besar dan cuaca beku melampau — dari blizzard Amerika Utara hingga salji awal Himalaya. Peristiwa ini menguji grid tenaga, penerbangan dan bekalan air sebuah negara dalam satu malam.' },
  { id: 'dustHazard', slug: 'badai-habuk', bm: 'Badai Habuk & Pasir', icon: '🏜️',
    blurb: 'Habuk Sahara, ribut pasir Asia dan badai debu — awan debu yang boleh menyeberangi lautan hingga ke Caribbean. Habuk fosforus yang dibawa malah menyuburkan hutan Amazon setiap tahun.' },
  { id: 'seaAndLakeIce', slug: 'ais-laut', bm: 'Ais Laut & Tasik', icon: '🧊',
    blurb: 'Pembentukan dan peleraian ais laut Artik serta tasik beku — barometer iklim kutub yang paling jujur. Luas ais laut bermusim kini menyusut setiap dekad sejak pengukuran satelit bermula 1979.' },
  { id: 'icebergs', slug: 'gunung-ais', bm: 'Gunung Ais (Iceberg)', icon: '🚢',
    blurb: 'Gunung ais gergasi yang berpecah (calving) dari rak ais Greenland dan Antartika — ada sebesar bandar, boleh terapung bertahun-tahun. Pemantauan penting untuk laluan kapal dan kajian kenaikan paras laut.' },
  { id: 'waterIssues', slug: 'isu-air', bm: 'Isu Air', icon: '💧',
    blurb: 'Peristiwa yang menjejaskan bekalan air — pencemaran, tanah runtuh ke takungan, kegagalan empangan dan kekurangan bekalan. Lebih 2 bilion manusia tinggal di negara tertekan air; isu ini jarang menjadi berita utama tetapi bahaya lambat-launnya besar.' },
  { id: 'manmade', slug: 'insiden-manusia', bm: 'Insiden Manusia', icon: '🏭',
    blurb: 'Bencana teknologi dan industri yang dilihat dari angkasa: kebakaran gudang, runtuhan, tumpahan minyak dan letupan. Kategori ini mengingatkan bahawa satelit turut mengawal keselamatan manusia, bukan alam semata-mata.' },
];

function findCat(slug) {
  const s = String(slug || '');
  return CATS.find((c) => c.slug === s || c.id === s) || null;
}

// Senarai acara masih dibuka bagi satu kategori EONET.
async function loadEvents(cat) {
  const key = `open:${cat.id}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${EONET}/events?category=${encodeURIComponent(cat.id)}&status=open&limit=300&include=geo`);
    const events = (body && Array.isArray(body.events)) ? body.events : null;
    if (!events) throw new Error('tiada senarai');
    cacheSet(key, events, TTL_OPEN);
    return events;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Buka semua kategori serentak untuk hab (kegagalan satu kategori tak gagalkan hab).
async function loadAllOpen() {
  const results = await Promise.all(CATS.map(async (c) => {
    try { return { cat: c, events: await loadEvents(c) }; }
    catch { return { cat: c, events: null }; }
  }));
  const ok = results.filter((r) => r.events && r.events.length);
  if (!ok.length) throw new Error('semua suapan gagal');
  return results; // kekalkan urutan CATS; pemanggil semak events === null
}

// Butiran satu acara — geometri/garis masa penuh.
async function loadEvent(eonetId) {
  const id = String(eonetId || '');
  if (!/^EONET_\d+$/.test(id)) throw new Error('id janggal');
  const key = `ev:${id}`;
  const hit = cacheGet(key, TTL_ONE);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${EONET}/events/${id}`);
    if (!body || !body.id) throw new Error('tiada acara');
    cacheSet(key, body, TTL_ONE);
    return body;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Pembantu paparan: koordinat [lng,lat] → label cantik + URL peta terbuka.
function geoLabel(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]); const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, text: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'U' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'T' : 'B'}` };
}

module.exports = { CATS, findCat, loadEvents, loadAllOpen, loadEvent, geoLabel };
