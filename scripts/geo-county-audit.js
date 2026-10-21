#!/usr/bin/env node
// ── TUKUK-OS geo-county-audit — semak data county terhadap sumber authoritative ──
//
// Bandarkan setiap src/county-<negeri>-data.json dengan ahli kategori Wikipedia
// "<Negeri> counties" (ns=0, type=page). Kategori itu = SET SEMASA sahaja: county
// historik/lupa (Bancroft IA, Uncompahgre CO, Encinal TX, Princess Anne VA, …) dan
// county yang belum dibuka (Pearl MS, Birch SC) tidak menjadi ahli — jadi
// perbezaan HILANG/LEBIH di sini adalah ralat data kita, bukan beza tafsiran.
//
// Kegunaan:
//   node scripts/geo-county-audit.js                 → semua 34 negeri (±2 minit)
//   node scripts/geo-county-audit.js iowa california → negeri terpilih sahaja
// Keluar: laporan satu baris per negeri + /tmp/cat-add.json (calon baris dengan
// koordinat) + /tmp/cat-members.json (senarai penuh ahli kategori). Kod keluar
// 1 jika ada LEBIH/HILANG/DUPE — sesuai sebagai gerbang selepas sunting data.
//
// Negeri yang unitnya bukan county (Louisiana parishes) dilangkau automatik
// apabila fail data tidak wujud.
const fs = require('fs');

const STATES = ['Alabama', 'Arkansas', 'California', 'Colorado', 'Florida', 'Georgia', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kenya', 'Kentucky', 'Louisiana', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin'];

const UA = 'tukuk-os-geo-audit/1.0 (hello@tukuk.org)';

/* County digabung bandar-county yang artikelnya bukan "<Nama> County, <Negeri>". */
const CONSOLIDATED = {
  california: ['San Francisco', 'San Francisco County, California'],
  colorado: ['Denver', 'Broomfield, Colorado'],
};

/* Nama kategori yang tidak mengikut pola "<Negeri> counties". */
const CAT_OVERRIDE = {
  georgia: 'Georgia (U.S. state) counties',
  'new-york': 'New York (state) counties',
  washington: 'Washington (state) counties',
  kenya: 'Counties of Kenya',
};

/* Kunci perbandingan: buang ", <Negeri>", " County" hujung, awalan
   "City and County of ", titik (St. Louis ↔ Saint Louis) dan ruang lebihan. */
function keyOf(title, st) {
  let s = String(title).replace(new RegExp(`, ${st}$`), '');
  s = s.replace(/^City and County of /i, '').replace(/ County$/i, '').replace(/\./g, '');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function api(params, tries = 5) {
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams(params);
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept': 'application/json' } });
      if (res.status === 429) throw new Error('HTTP 429');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return await res.json();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 2500 * i));
    }
  }
}

(async () => {
  const only = process.argv.slice(2);
  const report = [];
  const add = [];
  const members = {};
  let bad = 0;
  for (const st of STATES) {
    const state = st.toLowerCase().replace(/\s+/g, '-');
    if (only.length && !only.includes(state)) continue;
    const file = `src/county-${state}-data.json`;
    if (!fs.existsSync(file)) { report.push(`${state}\tdilangkau (tiada fail county-${state}-data.json)`); continue; }
    const j = await api({
      action: 'query', format: 'json', generator: 'categorymembers',
      gcmtitle: `Category:${CAT_OVERRIDE[state] || `${st} counties`}`, gcmlimit: 500, gcmtype: 'page',
      prop: 'coordinates|info', coinfo: '', colimit: 500,
    });
    const cat = new Map();
    const skip = [];
    const allow = new Set(CONSOLIDATED[state] || []);
    for (const p of Object.values(j.query?.pages || {}).filter((x) => x.ns === 0)) {
      const t = p.title;
      const countyLike = /\bCounty\b/.test(t) || /^City and County of /i.test(t) || allow.has(t);
      if (!countyLike) { skip.push(t); continue; }
      const c = (p.coordinates || [])[0];
      if (!cat.has(keyOf(t, st))) cat.set(keyOf(t, st), { title: t, lat: c ? c.lat : null, lng: c ? c.lon : null });
    }
    const auth = [...cat.values()];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const byKey = new Map(data.map((x) => [keyOf(String(x.wiki || ''), st), x]));
    const seen = {};
    for (const x of data) { const k = keyOf(String(x.wiki || ''), st); seen[k] = (seen[k] || 0) + 1; }
    const extras = [...byKey.keys()].filter((k) => !cat.has(k));
    const dupes = Object.entries(seen).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
    const missing = auth.filter((a) => !byKey.has(keyOf(a.title, st)) && a.lat !== null);
    if (extras.length || missing.length || dupes.length) bad++;
    report.push(`${state}\tdata=${data.length}\twiki=${auth.length}\tLEBIH(${extras.length}): ${extras.map((k) => byKey.get(k).wiki || k).join(', ') || '-'}\tDUPE(${dupes.length}): ${dupes.join(', ') || '-'}\tHILANG(${missing.length}): ${missing.map((m) => m.title).join(', ') || '-'}`);
    for (const m of missing) add.push({ state, nice: st, ...m });
    members[state] = { countyLike: auth.map((a) => a.title), skip };
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(report.join('\n'));
  fs.writeFileSync('/tmp/cat-add.json', JSON.stringify(add, null, 1));
  fs.writeFileSync('/tmp/cat-members.json', JSON.stringify(members, null, 1));
  console.log(`kawasan tidak sepadan: ${bad} (calon tambah ${add.length} → /tmp/cat-add.json)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('RALAT:', e.message); process.exit(2); });
