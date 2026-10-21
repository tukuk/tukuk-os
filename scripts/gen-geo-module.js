#!/usr/bin/env node
// Generates simple geo-cluster modules (name,wiki,country,region,lat,lng) from a spec.
const fs = require('fs');
const SPECS = [
  { file: 'hospital-jiwa', label: 'PSYCHIATRIC-HOSPITALS', title: 'Psychiatric Hospitals of the World', var: 'PSYHIATRIC', sing: 'PsychiatricHospital', finder: 'psychiatric', finders: 'psychiatricInRegion', pfx: 'py', cap: 'Psychiatric' },
  { file: 'lombong-terbuka', label: 'OPEN-PIT-MINES', title: 'Open-Pit Mines of the World', var: 'OPENPIT', sing: 'OpenPitMine', finder: 'openpit', finders: 'openPitsInRegion', pfx: 'op', cap: 'OpenPit' },
  { file: 'kuasa-pasang', label: 'TIDAL-POWER', title: 'Tidal Power Stations of the World', var: 'TIDALPOWER', sing: 'TidalPowerStation', finder: 'tidalpower', finders: 'tidalPowerInRegion', pfx: 'tp', cap: 'TidalPower' },
  { file: 'balai-kereta', label: 'CARRIAGE-HOUSES', title: 'Carriage Houses of the World', var: 'CARRIAGE', sing: 'CarriageHouse', finder: 'carriage', finders: 'carriagesInRegion', pfx: 'cy', cap: 'Carriage' },
  { file: 'hacienda', label: 'HACIENDAS', title: 'Haciendas of the World', var: 'HACIENDAS', sing: 'Hacienda', finder: 'hacienda', finders: 'haciendasInRegion', pfx: 'ha', cap: 'Haciendas' },
  { file: 'stesen-telegraf', label: 'TELEGRAPH-STATIONS', title: 'Telegraph Stations of the World', var: 'TELEGRAPH', sing: 'TelegraphStation', finder: 'telegraph', finders: 'telegraphsInRegion', pfx: 'te', cap: 'Telegraph' },
  { file: 'kubur-gua', label: 'ROCK-CUT-TOMBS', title: 'Rock-Cut Tombs of the World', var: 'ROCKTOMBS', sing: 'RockCutTomb', finder: 'rocktomb', finders: 'rockTombsInRegion', pfx: 'rc', cap: 'RockTombs' },
  { file: 'rumah-miskin', label: 'POORHOUSES', title: 'Poorhouses of the World', var: 'POORHOUSE', sing: 'Poorhouse', finder: 'poorhouse', finders: 'poorhousesInRegion', pfx: 'po', cap: 'Poorhouses' },
  { file: 'gua-candi', label: 'CAVE-TEMPLES', title: 'Cave Temples of the World', var: 'CAVETEMPLE', sing: 'CaveTemple', finder: 'cavetemple', finders: 'caveTemplesInRegion', pfx: 'cv', cap: 'CaveTemples' },
];
for (const s of SPECS) {
  const itemsVar = s.var;
  const bySlug = itemsVar[0] + 'BySlug';
  const content = `#!/usr/bin/env node
// ── TUKUK-OS ${s.label} (/${s.file}) — ${s.title} ──
const https = require('https');
const DATA = require('./${s.file}-data.json');
const UA = 'TukukOS-${s.cap}/1.0 (+https://tukuk.org)';
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000;
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const REGION_ORDER = ['Africa', 'Americas', 'Antarctica', 'Asia', 'Europe', 'Oceania'];
const ${itemsVar} = DATA.map((x) => ({ ...x, slug: slugify(x.name), countrySlug: slugify(x.country) }));
const ${bySlug} = new Map(${itemsVar}.map((x) => [x.slug, x]));
function countInRegion(r) { let n = 0; for (const x of ${itemsVar}) if (x.region === r) n++; return n; }
const REGIONS = REGION_ORDER.map((r) => ({ name: r, slug: slugify(r), count: countInRegion(r) }));
const R_BY_SLUG = new Map(REGIONS.map((r) => [r.slug, r]));
function find${s.sing}(slug) { return ${bySlug}.get(String(slug || '').toLowerCase()) || null; }
function findRegion(slug) { return R_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function ${s.finders || s.finder + 'sInRegion'}(region) { return ${itemsVar}.filter((x) => x.region === region); }
function ${s.finder}ByCountry(countrySlug) { return ${itemsVar}.filter((x) => x.countrySlug === countrySlug); }
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });
function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume(); httpsGet(next, agent).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(\`HTTP \${res.statusCode}\`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (d) => { size += d.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); } catch { return await httpsGet(url, v4Agent); }
}
async function fetchSummary(wikiTitle) {
  const t = String(wikiTitle || '').trim();
  if (!t) return null;
  const key = \`${s.pfx}:\${t.toLowerCase()}\`;
  const hit = cache.get(key);
  if (hit && Date.now() <= hit.expiresAt) return hit.data;
  try {
    const sum = await fetchJson(\`https://en.wikipedia.org/api/rest_v1/page/summary/\${encodeURIComponent(t.replace(/ /g, '_'))}\`);
    if (!sum || !sum.extract) { const out = null; cache.set(key, { data: out, expiresAt: Date.now() + TTL }); return out; }
    const out = {
      extract: String(sum.extract).trim(),
      description: sum.description ? String(sum.description).trim() : '',
      thumb: sum.thumbnail && sum.thumbnail.source ? sum.thumbnail.source : null,
      thumbW: sum.thumbnail && sum.thumbnail.width ? sum.thumbnail.width : null,
      thumbH: sum.thumbnail && sum.thumbnail.height ? sum.thumbnail.height : null,
      url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || \`https://en.wikipedia.org/wiki/\${encodeURIComponent(t.replace(/ /g, '_'))}\`,
    };
    cache.set(key, { data: out, expiresAt: Date.now() + TTL });
    return out;
  } catch { return hit ? hit.data : null; }
}
module.exports = { ${itemsVar}, REGIONS, REGION_ORDER, find${s.sing}, findRegion, ${s.finders || s.finder + 'sInRegion'}, ${s.finder}ByCountry, fetchSummary, slugify };
`;
  fs.writeFileSync(`src/${s.file}.js`, content);
  console.log('wrote src/' + s.file + '.js  exports:', itemsVar, 'find' + s.sing, (s.finders || s.finder + 'sInRegion'), s.finder + 'ByCountry');
}
