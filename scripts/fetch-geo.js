#!/usr/bin/env node
// ── Generic Wikidata geographic-cluster fetcher ──
// Usage: node scripts/fetch-geo.js <QID> <out-data.json>
// Emits: [{name,wiki,country,region,lat,lng}] — name from en-wiki article title.
const https = require('https');
const fs = require('fs');

const QID = process.argv[2];
const OUT = process.argv[3];
if (!QID || !OUT) { console.error('usage: fetch-geo.js <QID> <out.json>'); process.exit(1); }

const UA = 'TukukOS-GeoFetch/1.0 (+https://tukuk.org)';
const CONT_REGION = {
  Q15: 'Africa', Q18: 'Americas', Q49: 'Americas', Q46: 'Europe',
  Q48: 'Asia', Q538: 'Oceania', Q55643: 'Oceania', Q13205424: 'Americas', Q22033684: 'Antarctica',
};

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}) }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        res.resume(); return get(new URL(res.headers.location, url).toString(), headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0; const chunks = [];
      res.on('data', (d) => { size += d.length; if (size > 32 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  return get(url, { Accept: 'application/sparql-results+json' });
}

async function labels(qids) {
  const map = {};
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50).join('|');
    const u = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + batch + '&props=labels&languages=en&format=json';
    const d = await get(u);
    for (const id of Object.keys(d.entities || {})) {
      map[id] = (d.entities[id].labels && d.entities[id].labels.en && d.entities[id].labels.en.value) || '';
    }
  }
  return map;
}

(async () => {
  const q = `SELECT ?e ?article ?coord ?country ?cont ?cont2 WHERE {
    ?e wdt:P31 wd:${QID} ; wdt:P625 ?coord .
    ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
    OPTIONAL { ?e wdt:P17 ?country . OPTIONAL { ?country wdt:P30 ?cont } }
    OPTIONAL { ?e wdt:P30 ?cont2 }
  } LIMIT 8000`;
  console.error('fetching', QID, '...');
  const r = await sparql(q);
  const rows = r.results.bindings;
  console.error('rows:', rows.length);

  const countryQids = [...new Set(rows.map((b) => b.country && b.country.value.split('/').pop()).filter(Boolean))];
  const cmap = await labels(countryQids);

  const seen = new Set();
  const out = [];
  for (const b of rows) {
    const art = b.article.value;
    const title = decodeURIComponent(art.split('/wiki/')[1] || '').replace(/_/g, ' ');
    if (!title) continue;
    const slug = slugify(title);
    if (!slug || seen.has(slug)) continue;
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
    if (!m) continue;
    const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
    const cqid = b.country && b.country.value.split('/').pop();
    const contQid = (b.cont && b.cont.value.split('/').pop()) || (b.cont2 && b.cont2.value.split('/').pop());
    let region = (contQid && CONT_REGION[contQid]) || '';
    if (!region) region = lat < -60 ? 'Antarctica' : 'Other'; // coordinate fallback
    let country = (cqid && cmap[cqid]) || '';
    if (!country) country = region === 'Antarctica' ? 'Antarctica' : 'Other';
    seen.add(slug);
    out.push({ name: title, wiki: title, country, region, lat, lng });
  }
  out.sort((a, x) => a.name.localeCompare(x.name));
  fs.writeFileSync(OUT, JSON.stringify(out));
  const countries = new Set(out.map((x) => x.country)).size;
  const regions = {};
  for (const x of out) regions[x.region] = (regions[x.region] || 0) + 1;
  console.error('wrote', out.length, 'entries,', countries, 'countries');
  console.error('regions:', JSON.stringify(regions));
})().catch((e) => { console.error('ERR', e); process.exit(1); });
