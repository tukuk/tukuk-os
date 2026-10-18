'use strict';
// ── TUKUK-OS STATISTIK COMPLEX — ranking dunia ikut indikator (PERCUMA, tanpa kunci) ──
// Sumber: World Bank Open Data (JSON awam, tanpa daftar) + dataset src/negara.js
// yang sudah di-cache (populasi/jangka hayat/urbanisasi field sedia ada).
// Modul ini hanya memuatin indikator TAMBAHAN dan menjana ranking siap-render.
const https = require('https');

const WB_IND_BASE = 'https://api.worldbank.org/v2/country/all/indicator';
const WB_YEAR_DEFAULT = 2023;
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // stat 2023 sudah tetap

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
}

// Agent IPv6 didahulukan — server.js tetapkan dns 'ipv4first' global (pitfall cuti).
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Statistik-Client/1.0 (+https://tukuk.org)' } }, (res) => {
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

// ——— Katalog indikator (slugs BM; `field` dipinjam dari rows negara.js) ———
// better: 'high' = makin tinggi makin hebat; 'low' = makin rendah makin baik; null neutral.
const INDICATORS = [
  { slug: 'populasi', code: null, field: 'population', bm: 'Populasi', unit: 'orang', dec: 0, better: 'high',
    intro: 'Jumlah penduduk setiap buah negara — anggaran rasmi World Bank bagi tahun 2023, dibundarkan kepada orang.' },
  { slug: 'kdnk-kapita', code: 'NY.GDP.PCAP.CD', field: null, bm: 'KDNK Sekepala', unit: 'USD', dec: 0, better: 'high',
    intro: 'Nilai keluaran dalam negara kasar dibahagi penduduk, dalam dolar AS nominal — ukuran kasar kekuatan ekonomi individu.' },
  { slug: 'jangka-hayat', code: null, field: 'life', bm: 'Jangka Hayat Lahir', unit: 'tahun', dec: 1, better: 'high',
    intro: 'Berapa tahun bayi yang lahir hari ini dijangka hidup, dengan pemeraian sistem kesihatan semasa.' },
  { slug: 'internet', code: 'IT.NET.USER.ZS', field: null, bm: 'Pengguna Internet', unit: '%', dec: 1, better: 'high',
    intro: 'Peratus penduduk yang menggunakan internet sekurang-kurangnya sekali dalam tiga bulan — nadi ekonomi digital.' },
  { slug: 'urbanisasi', code: null, field: 'urban', bm: 'Penduduk Bandar', unit: '%', dec: 1, better: null,
    intro: 'Peratus penduduk yang tinggal di kawasan bandar ikut definisi setiap negara — cermin transformasi ekonomi.' },
  { slug: 'kesuburan', code: 'SP.DYN.TFRT.IN', field: null, bm: 'Kadar Kesuburan', unit: 'anak/wanita', dec: 1, better: null,
    intro: 'Purata anak yang dilahirkan seorang wanita sepanjang hayat. Di bawah 2.1, populasi sesuatu negara mula mengecil.' },
  { slug: 'literasi', code: 'SE.ADT.LITR.ZS', field: null, bm: 'Kadar Literasi Dewasa', unit: '%', dec: 1, better: 'high',
    intro: 'Peratus penduduk berusia 15 tahun ke atas yang boleh membaca dan menulis dengan faham.' },
  { slug: 'pengangguran', code: 'SL.UEM.TOTL.ZS', field: null, bm: 'Kadar Pengangguran', unit: '%', dec: 1, better: 'low',
    intro: 'Peratus tenaga kerja yang aktif mencari pekerjaan tetapi belum mendapatkannya.' },
  { slug: 'inflasi', code: 'FP.CPI.TOTL.ZG', field: null, bm: 'Inflasi Harga Pengguna', unit: '%', dec: 1, better: 'low',
    intro: 'Perubahan tahunan indeks harga pengguna — kadar yang memacu saku rakyat setiap bulan.' },
  { slug: 'tenaga-boleh-diperbaharui', code: 'EG.FEC.RNEW.ZS', field: null, yr: 2021, bm: 'Tenaga Boleh Diperbaharui', unit: '%', dec: 1, better: 'high',
    intro: 'Bahagian tenaga boleh diperbaharui (hidro, solar, angin, bio) dalam penggunaan tenaga akhir keseluruhan. World Bank baru melaporkan 2021 untuk indikator ini — ia didahulukan tahun lain.' },
  { slug: 'pelepasan-co2', code: 'EN.GHG.CO2.PC.CE.AR5', field: null, bm: 'Pelepasan CO₂ Sekepala', unit: 'tan CO₂', dec: 1, better: 'low',
    intro: 'Ton karbon dioksida dilepaskan setiap penduduk setiap tahun (tidak termasuk penggunaan tanah) — cap kaki karbon negara.' },
  { slug: 'liputan-hutan', code: 'AG.LND.FRST.ZS', field: null, bm: 'Liputan Hutan', unit: '%', dec: 1, better: 'high',
    intro: 'Peratus keluasan tanah negara yang dilitupi hutan semula jadi dan tumbuhan — paru-paru dunia.' },
  { slug: 'kematian-bayi', code: 'SP.DYN.IMRT.IN', field: null, bm: 'Kematian Bayi', unit: 'per 1,000', dec: 1, better: 'low',
    intro: 'Bilangan bayi yang meninggal dunia sebelum mencapai usia satu tahun bagi setiap 1,000 kelahiran hidup.' },
  { slug: 'pertumbuhan-penduduk', code: 'SP.POP.GROW', field: null, bm: 'Pertumbuhan Penduduk', unit: '%', dec: 1, better: null,
    intro: 'Perubahan tahunan jumlah penduduk — positif bermakna negara membesar, negatif bermakna rakyatnya makin susut.' },
  { slug: 'kematian-kanak', code: 'SH.DYN.MORT', field: null, bm: 'Kematian Kanak-Kanak', unit: 'per 1,000', dec: 1, better: 'low',
    intro: 'Kanak yang meninggal dunia sebelum usia lima tahun bagi setiap 1,000 kelahiran hidup — penunjuk paling kuat kejayaan sistem kesihatan sesebuah negara.' },
];

function findIndicator(slug) {
  return INDICATORS.find((i) => i.slug === String(slug || '')) || null;
}

// Peta iso3 → nilai untuk indikator WB baharu; cache 30 hari + stale-serve.
async function loadWbMap(code, yr) {
  const year = yr || WB_YEAR_DEFAULT;
  const key = `wb:${code}:${year}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${WB_IND_BASE}/${code}?format=json&per_page=400&date=${year}`);
    const rows = {};
    for (const r of (Array.isArray(body) && body[1]) ? body[1] : []) {
      if (r && r.countryiso3code && r.value != null) rows[r.countryiso3code] = r.value;
    }
    if (Object.keys(rows).length) cacheSet(key, rows);
    return Object.keys(rows).length ? rows : (hit ? hit.data : rows);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Gabungkan dengan rows negara.js (nama BM + slug + bendera percuma daripada cache sana).
async function loadRanking(ind, countries) {
  let values = null;
  if (ind.field) {
    values = {};
    for (const c of countries) if (c[ind.field] != null) values[c.cca3] = c[ind.field];
  } else {
    values = await loadWbMap(ind.code, ind.yr);
  }
  const list = [];
  for (const c of countries) {
    const v = values[c.cca3];
    if (v != null && Number.isFinite(v)) list.push({ cca3: c.cca3, name: c.bm, slug: c.slug, flag: c.flag, cca2: c.cca2, value: v });
  }
  list.sort((a, b) => b.value - a.value);
  list.forEach((x, i) => { x.rank = i + 1; });
  const nums = list.map((x) => x.value).sort((a, b) => a - b);
  const sum = nums.reduce((s, x) => s + x, 0);
  const stats = {
    n: list.length,
    min: nums[0] ?? null,
    max: nums[nums.length - 1] ?? null,
    avg: nums.length ? sum / nums.length : null,
    median: nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null,
  };
  return { ind, list, stats };
}

module.exports = { INDICATORS, findIndicator, loadRanking, loadWbMap };
