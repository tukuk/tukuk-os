#!/usr/bin/env node
// Generates simple geo-cluster modules (name,wiki,country,region,lat,lng) from a spec.
const fs = require('fs');
const SPECS = [
  { file: 'muzium-perang', label: 'WAR-MUSEUMS', title: 'War Museums of the World', var: 'WARMUSEUM', sing: 'WarMuseum', finder: 'warMuseum', finders: 'warMuseumsInRegion', pfx: 'mpr', cap: 'WarMuseums' },
  { file: 'muzium-arkeologi', label: 'ARCHAEOLOGICAL-MUSEUMS', title: 'Archaeological Museums of the World', var: 'ARCHMUSEUM', sing: 'ArchaeologicalMuseum', finder: 'archaeologicalMuseum', finders: 'archaeologicalMuseumsInRegion', pfx: 'akm', cap: 'ArchaeologicalMuseums' },
  { file: 'terowong-jalan', label: 'ROAD-TUNNELS', title: 'Road Tunnels of the World', var: 'ROADTUN', sing: 'RoadTunnel', finder: 'roadTunnel', finders: 'roadTunnelsInRegion', pfx: 'tjl', cap: 'RoadTunnels' },
  { file: 'jambatan-kereta', label: 'RAILWAY-BRIDGES', title: 'Railway Bridges of the World', var: 'RAILBRDG', sing: 'RailwayBridge', finder: 'railwayBridge', finders: 'railwayBridgesInRegion', pfx: 'jtk', cap: 'RailwayBridges' },
  { file: 'muzium-sejarah-alam', label: 'NATURAL-HISTORY-MUSEUMS', title: 'Natural History Museums of the World', var: 'NATHMUSEUM', sing: 'NaturalHistoryMuseum', finder: 'naturalHistoryMuseum', finders: 'naturalHistoryMuseumsInRegion', pfx: 'msa', cap: 'NaturalHistoryMuseums' },
  { file: 'muzium-penerbangan', label: 'AVIATION-MUSEUMS', title: 'Aviation Museums of the World', var: 'AVIAMUSEUM', sing: 'AviationMuseum', finder: 'aviationMuseum', finders: 'aviationMuseumsInRegion', pfx: 'mpn', cap: 'AviationMuseums' },
  { file: 'muzium-maritima', label: 'MARITIME-MUSEUMS', title: 'Maritime Museums of the World', var: 'MARIMUSEUM', sing: 'MaritimeMuseum', finder: 'maritimeMuseum', finders: 'maritimeMuseumsInRegion', pfx: 'mmr', cap: 'MaritimeMuseums' },
  { file: 'muzium-sains', label: 'SCIENCE-MUSEUMS', title: 'Science Museums of the World', var: 'SCIMUSEUM', sing: 'ScienceMuseum', finder: 'scienceMuseum', finders: 'scienceMuseumsInRegion', pfx: 'msx', cap: 'ScienceMuseums' },
  { file: 'runtuhan-biara', label: 'MONASTERY-RUINS', title: 'Monastery Ruins of the World', var: 'MONARUIN', sing: 'MonasteryRuin', finder: 'monasteryRuin', finders: 'monasteryRuinsInRegion', pfx: 'rbi', cap: 'MonasteryRuins' },
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
