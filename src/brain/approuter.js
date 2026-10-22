// ═══ Tukuk App Router ════════════════════════════════════════════════════════
// The brain's "tool use" layer: map the user's question/request to the
// most fitting server APPLICATION. Scored from multilingual keywords
// (ms/id/en) — model-free, deterministic, and gated so suggestions only
// appear when truly relevant.
//
// Catalog source: only the LIVE SURFACE — files/routes that exist today.
// The Oct 2026 content pivot (b0542e7) removed the app/store/AI pages; the old
// catalog linked 404 URLs — fixed. The test (test/approuter.test.js) verifies
// every matched catalog path has an HTML file or a server route.
'use strict';

// ── Catalog: [name, url, icon, title, keywords (ms/id/en mixed, lowercase)] ──
const UTILITIES = [
  ['chat', '/apps/chat', '\uD83D\uDCAC', 'T Chat', 'chat message mesej messenger sembang room bilik call phone'],
];
const TOOLS = [
  ['cuaca', '/cuaca', '\uD83C\uDF24\uFE0F', 'World Weather', 'weather cuaca rain hujan forecast ramalan iklim temperature suhu angin wind'],
  ['udara', '/udara', '\uD83C\uDF2C\uFE0F', 'Air & Oxygen', 'air udara pollution pencemaran aqi quality oksigen oxygen co2 carbon'],
  ['gempa', '/gempa', '\uD83C\uDF0B', 'World Earthquakes', 'earthquake gempa seismic quake magnitud getaran tremor'],
  ['bencana', '/bencana', '\uD83D\uDEA8', 'Disaster Tracker', 'disaster bencana wildfire floods taufan storm cyclone letusan volcano'],
  ['nasa', '/nasa', '\uD83D\uDEF0\uFE0F', 'NASA Space Hub', 'nasa space astronomy planet bintang star apod angkasa iss asteroid exoplanet'],
  ['wang', '/wang', '\uD83D\uDCB1', 'World Currency', 'currency wang ringgit exchange rate usd myr euro dollar money tukar'],
  ['seni', '/seni', '\uD83C\uDFA8', 'Free Art Gallery', 'art seni museum painting lukisan gallery masterpiece'],
  ['hidupan', '/hidupan', '\uD83E\uDD8B', 'Wildlife Atlas', 'animal wildlife hidupan spesies species butterfly tiger bird ikan'],
  ['akademi', '/akademi', '\uD83C\uDF93', 'Akademi Tukuk-OS', 'lesson pelajaran academy akademi quiz general knowledge ilmu'],
  ['blog', '/blog', '\uD83D\uDCDD', 'Blog & Articles', 'blog article artikel baca reading tulisan post'],
  ['learn', '/learn', '\uD83D\uDCBB', 'Learn 0 → Hero', 'learn belajar code programming pengaturcaraan javascript node tutorial curriculum'],
  ['os', '/os', '\uD83D\uDCF1', 'Tukuk OS (web phone)', 'phone android os sistem web telefon operating home'],
  ['study', '/study', '\uD83D\uDD2C', 'Study Complex', 'study science fakta facts geography sains eksperimen teka'],
  ['wiki', '/wiki', '\uD83D\uDCDA', 'Tukuk Wiki', 'wiki ensiklopedia encyclopedia reference rujuk'],
  ['negara', '/negara', '\uD83C\uDF0D', 'Country Profiles', 'country negara capital bendera flag population rakyat'],
  ['cuti', '/cuti', '\uD83D\uDDD3\uFE0F', 'Public Holidays', 'holiday cuti calendar kalendar percutian long weekend'],
  ['statistik', '/statistik', '\uD83D\uDCCA', 'World Statistics', 'statistik statistics data angka population country record'],
  ['radio', '/cari?mode=radio', '\uD83D\uDCFB', 'World Radio', 'radio stesen station dengar siaran live muzik'],
  ['news', '/cari?mode=news', '\uD83D\uDCF0', 'News Search', 'news berita headline terkini semasa'],
  ['music', '/cari?mode=music', '\uD83C\uDFB5', 'Music Search', 'music song lagu muzik listen dengar'],
];

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'i', 'my', 'me',
  'please', 'can', 'how', 'what', 'why', 'with', 'tolong', 'saya', 'nak', 'mahu', 'boleh', 'kah', 'yang',
  'satu', 'dua', 'ini', 'itu', 'dalam', 'dan', 'atau', 'untuk', 'macam', 'bagaimana', 'buat',
  'buatkan', 'bina', 'mainkan', 'bukakan', 'kerjakan', 'sediakan']);

// ── Index builder: keyword → [entry] (only once, lazily invoked) ──
const CATALOG = [...UTILITIES, ...TOOLS];
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  for (const e of CATALOG) for (const w of e[4].split(/\s+/)) if (w) {
    if (!INDEX.has(w)) INDEX.set(w, []);
    INDEX.get(w).push(e);
  }
  return INDEX;
}

/**
 * Match a question against the server applications.
 * @param {string} query
 * @returns {{apps: Array<{name:string,url:string,ic:string,title:string,score:number}>}}
 */
function route(query) {
  const idx = index();
  const words = String(query || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const scores = new Map(); // name → {entry, score}
  for (const w of words) {
    for (const e of idx.get(w) || []) {
      const cur = scores.get(e[0]) || { e, score: 0 };
      cur.score += 1;
      scores.set(e[0], cur);
    }
  }
  // Loose: also match a 4+ character prefix (singular/plural, "weathers"→"weather").
  for (const w of words) {
    if (w.length < 4) continue;
    for (const [kw, list] of idx) {
      if (kw.length >= 4 && (kw.startsWith(w) || w.startsWith(kw))) {
        for (const e of list) {
          const cur = scores.get(e[0]) || { e, score: 0 };
          cur.score += 0.5;
          scores.set(e[0], cur);
        }
      }
    }
  }
  const ranked = [...scores.values()]
    .map((s) => ({ name: s.e[0], url: s.e[1], ic: s.e[2], title: s.e[3], score: Math.round(s.score * 10) / 10 }))
    .sort((a, b) => b.score - a.score);
  // Gate: only strong enough (1 full match OR 2 half) — otherwise empty.
  const apps = ranked.filter((r) => r.score >= 1).slice(0, 3);
  return { apps };
}

module.exports = { route, CATALOG, UTILITIES, TOOLS };
