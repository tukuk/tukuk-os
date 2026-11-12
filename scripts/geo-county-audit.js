#!/usr/bin/env node
// ── TUKUK-OS geo-county-audit — check county data against the authoritative source ──
//
// Compares every src/county-<state>-data.json with the Wikipedia category members
// "<State> counties" (ns=0, type=page). That category is the CURRENT set only:
// historic/forgotten counties (Bancroft IA, Uncompahgre CO, Encinal TX, Princess
// Anne VA, …) and counties not yet created (Pearl MS, Birch SC) are not members —
// so a MISSING/EXTRA difference here is an error in our data, not a difference of
// interpretation.
//
// Usage:
//   node scripts/geo-county-audit.js                 → all 37 states (±2 minutes)
//   node scripts/geo-county-audit.js iowa california → selected states only
// Output: one report line per state + /tmp/cat-add.json (candidate rows with
// coordinates) + /tmp/cat-members.json (full category member list). Exit code
// 1 when there are EXTRA/MISSING/DUPES — fits as a gate after a data edit.
//
// States whose unit is not a county (Louisiana = parish, New Jersey = borough) are
// NO LONGER skipped: they are registered in UNITS below so our data checks have no
// blind spots.
const fs = require('fs');

const STATES = ['Alabama', 'Arkansas', 'California', 'Colorado', 'Florida', 'Georgia', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kenya', 'Kentucky', 'Louisiana', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin'];

const UA = 'tukuk-os-geo-audit/1.0 (hello@tukuk.org)';

/* Counties merged with a city-county whose article is not "<Name> County, <State>". */
const CONSOLIDATED = {
  california: ['San Francisco', 'San Francisco County, California'],
  colorado: ['Denver', 'Broomfield, Colorado'],
};

/* Category names that do not follow the "<State> counties" pattern. */
const CAT_OVERRIDE = {
  georgia: 'Georgia (U.S. state) counties',
  'new-jersey': 'Boroughs in New Jersey',
  'new-york': 'New York (state) counties',
  washington: 'Washington (state) counties',
  kenya: 'Counties of Kenya',
};

/* Datasets whose file and unit are not county-<state>. Louisiana uses "parish" —
   64 of them; New Jersey has 255 boroughs. The Pennsylvania borough category is
   split by county (only 2 direct members) so it is NOT audited here.
   `matchAll`: borough names do NOT contain the word "Borough" (e.g. "Allendale,
   New Jersey"), so every category member outside NOT_MEMBERS counts as a unit. */
const UNITS = {
  louisiana: { prefix: 'parish', word: 'parishes', unitWord: 'Parish' },
  'new-jersey': { prefix: 'borough', word: 'boroughs', unitWord: 'Borough', matchAll: true },
};

/* Category members that are not real units — main/verification articles, skipped. */
const NOT_MEMBERS = {
  'new-jersey': ['Borough (New Jersey)'],
};

/* Comparison key: strip ", <State>", a trailing " County", the "City and County of "
   prefix, periods (St. Louis ↔ Saint Louis) and extra spaces. */
function keyOf(title, st, unitWord = 'County') {
  let s = String(title).replace(new RegExp(`, ${st}$`), '');
  s = s.replace(/^City and County of /i, '').replace(new RegExp(` ${unitWord}$`, 'i'), '').replace(/\./g, '');
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
    const unit = UNITS[state] || { prefix: 'county', word: 'counties', unitWord: 'County' };
    const file = `src/${unit.prefix}-${state}-data.json`;
    if (!fs.existsSync(file)) { report.push(`${state}\tskipped (no ${unit.prefix}-${state}-data.json file)`); continue; }
    const j = await api({
      action: 'query', format: 'json', generator: 'categorymembers',
      gcmtitle: `Category:${CAT_OVERRIDE[state] || `${st} ${unit.word}`}`, gcmlimit: 500, gcmtype: 'page',
      prop: 'coordinates|info', coinfo: '', colimit: 500,
    });
    const cat = new Map();
    const skip = [];
    const allow = new Set(CONSOLIDATED[state] || []);
    const notUnits = new Set(NOT_MEMBERS[state] || []);
    const unitRe = new RegExp(`\\b${unit.unitWord}\\b`);
    for (const p of Object.values(j.query?.pages || {}).filter((x) => x.ns === 0)) {
      const t = p.title;
      if (notUnits.has(t)) { skip.push(t); continue; }
      const unitLike = unit.matchAll || unitRe.test(t) || /^City and County of /i.test(t) || allow.has(t);
      if (!unitLike) { skip.push(t); continue; }
      const c = (p.coordinates || [])[0];
      if (!cat.has(keyOf(t, st, unit.unitWord))) cat.set(keyOf(t, st, unit.unitWord), { title: t, lat: c ? c.lat : null, lng: c ? c.lon : null });
    }
    const auth = [...cat.values()];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const byKey = new Map(data.map((x) => [keyOf(String(x.wiki || ''), st, unit.unitWord), x]));
    const seen = {};
    for (const x of data) { const k = keyOf(String(x.wiki || ''), st, unit.unitWord); seen[k] = (seen[k] || 0) + 1; }
    const extras = [...byKey.keys()].filter((k) => !cat.has(k));
    const dupes = Object.entries(seen).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
    const missing = auth.filter((a) => !byKey.has(keyOf(a.title, st, unit.unitWord)) && a.lat !== null);
    if (extras.length || missing.length || dupes.length) bad++;
    report.push(`${state}\tdata=${data.length}\twiki=${auth.length}\tEXTRA(${extras.length}): ${extras.map((k) => byKey.get(k).wiki || k).join(', ') || '-'}\tDUPES(${dupes.length}): ${dupes.join(', ') || '-'}\tMISSING(${missing.length}): ${missing.map((m) => m.title).join(', ') || '-'}`);
    for (const m of missing) add.push({ state, nice: st, ...m });
    members[state] = { unitLike: auth.map((a) => a.title), skip };
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(report.join('\n'));
  fs.writeFileSync('/tmp/cat-add.json', JSON.stringify(add, null, 1));
  fs.writeFileSync('/tmp/cat-members.json', JSON.stringify(members, null, 1));
  console.log(`regions out of sync: ${bad} (add candidates ${add.length} → /tmp/cat-add.json)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('ERROR:', e.message); process.exit(2); });
