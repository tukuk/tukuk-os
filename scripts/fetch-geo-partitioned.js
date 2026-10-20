#!/usr/bin/env node
// ── Partitioned Wikidata geographic-cluster fetcher (for very large classes) ──
// Usage: node scripts/fetch-geo-partitioned.js <QID> <out-data.json>
// Strategy: instead of one giant OFFSET crawl (which Wikidata truncates for
// huge classes), first list each country (P17) with its continent (P30) and a
// COUNT, then fetch each country's items with a bounded query. Items without a
// country are fetched last as an "unbound" group. Emits the same rows shape as
// fetch-geo.js: [{name,wiki,country,region,lat,lng}].
const https = require('https');
const fs = require('fs');

const QID = process.argv[2];
const OUT = process.argv[3];
if (!QID || !OUT) { console.error('usage: fetch-geo-partitioned.js <QID> <out.json>'); process.exit(1); }

const UA = 'TukukOS-GeoFetch/1.0 (+https://tukuk.org)';
const CONT_REGION = {
  Q15: 'Africa', Q18: 'Americas', Q49: 'Americas', Q46: 'Europe',
  Q48: 'Asia', Q538: 'Oceania', Q55643: 'Oceania', Q13205424: 'Americas', Q22033684: 'Antarctica',
};
// Fallback continent inference from coordinates when P30 is missing.
function regionByCoord(lat, lng) {
  if (lat < -60) return 'Antarctica';
  if (lat >= 12 && lat <= 72 && lng >= -170 && lng <= -50) return 'Americas';
  if (lat >= -60 && lat <= 40 && lng >= -90 && lng <= -25) return 'Americas';
  if (lat >= 35 && lng >= -12 && lng <= 45) return 'Europe';
  if (lat >= -40 && lat <= 40 && lng >= -20 && lng <= 55) return 'Africa';
  if (lng >= 55 || (lat >= 0 && lng >= 45)) return 'Asia';
  if (lat < 0 && lng >= 110) return 'Oceania';
  return 'Other';
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}) }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        res.resume(); return get(new URL(res.headers.location, url).toString(), headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0; const chunks = [];
      res.on('data', (d) => { size += d.length; if (size > 32 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/[\u0000-\u001F]+/g, ' '))); } catch (e) { reject(e); } });
    });
    req.setTimeout(180000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  for (let attempt = 0; ; attempt++) {
    try { return await get(url, { Accept: 'application/sparql-results+json' }); }
    catch (e) {
      if (attempt >= 4) throw e;
      const wait = 5000 * (attempt + 1);
      console.error('  sparql retry', attempt + 1, 'after', e.message, '(' + wait + 'ms)');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function labels(qids) {
  const map = {};
  const uniq = [...new Set(qids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50).join('|');
    const u = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + batch + '&props=labels&languages=en&format=json';
    const d = await get(u);
    for (const id of Object.keys(d.entities || {})) {
      map[id] = (d.entities[id].labels && d.entities[id].labels.en && d.entities[id].labels.en.value) || '';
    }
  }
  return map;
}

const qidOf = (u) => (u && u.value ? u.value.split('/').pop() : null);

(async () => {
  // 1) country groups (with continent + count) for items that have coordinates.
  const gq = `SELECT ?c ?cont (COUNT(?e) AS ?n) WHERE {
    ?e wdt:P31 wd:${QID} ; wdt:P625 ?coord .
    OPTIONAL { ?e wdt:P17 ?c . OPTIONAL { ?c wdt:P30 ?cont } }
  } GROUP BY ?c ?cont ORDER BY ?c`;
  console.error('listing country groups for', QID, '...');
  const gres = await sparql(gq);
  const groups = gres.results.bindings.map((b) => ({
    c: qidOf(b.c), cont: qidOf(b.cont), n: parseInt(b.n.value, 10) || 0,
  }));
  const withCountry = groups.filter((g) => g.c);
  const noCountry = groups.filter((g) => !g.c);
  console.error('  groups:', groups.length, '(with-country:', withCountry.length, ', no-country:', noCountry.length, ')');

  const cmap = await labels(withCountry.map((g) => g.c));

  const seen = new Set();
  const out = [];
  const PAGE = 8000;

  function pushRows(page, countryName, regionHint) {
    for (const b of page) {
      const art = b.article.value;
      const title = decodeURIComponent(art.split('/wiki/')[1] || '').replace(/_/g, ' ');
      if (!title) continue;
      const slug = slugify(title);
      if (!slug || seen.has(slug)) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
      const region = regionHint || regionByCoord(lat, lng);
      out.push({ name: title, wiki: title, country: countryName, region, lat, lng });
      seen.add(slug);
    }
  }

  for (let gi = 0; gi < withCountry.length; gi++) {
    const g = withCountry[gi];
    const countryName = cmap[g.c] || 'Other';
    const regionHint = (g.cont && CONT_REGION[g.cont]) || null;
    let off = 0;
    for (; ; off += PAGE) {
      const q = `SELECT ?e ?article ?coord WHERE {
        ?e wdt:P31 wd:${QID} ; wdt:P625 ?coord ; wdt:P17 wd:${g.c} .
        ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
      } ORDER BY ?e LIMIT ${PAGE} OFFSET ${off}`;
      let page;
      try { page = (await sparql(q)).results.bindings; }
      catch (e) { console.error(`  [${gi}] ${countryName} offset ${off} FAILED: ${e.message} — skipping`); break; }
      pushRows(page, countryName, regionHint);
      if (page.length < PAGE) break;
      if (off > 100000) { console.error(`  [${gi}] ${countryName} safety stop at offset ${off}`); break; }
    }
    console.error(`  [${gi + 1}/${withCountry.length}] ${countryName} done (total so far ${out.length})`);
  }

  // no-country group: items with coordinates but no P17 (Antarctica, ocean etc.)
  for (let off = 0; ; off += PAGE) {
    const q = `SELECT ?e ?article ?coord WHERE {
      ?e wdt:P31 wd:${QID} ; wdt:P625 ?coord .
      ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
      FILTER NOT EXISTS { ?e wdt:P17 ?any }
    } ORDER BY ?e LIMIT ${PAGE} OFFSET ${off}`;
    let page;
    try { page = (await sparql(q)).results.bindings; }
    catch (e) { console.error(`  no-country offset ${off} FAILED: ${e.message} — skipping`); break; }
    for (const b of page) {
      const title = decodeURIComponent((b.article.value.split('/wiki/')[1] || '').replace(/_/g, ' '));
      if (!title) continue;
      const slug = slugify(title);
      if (!slug || seen.has(slug)) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
      const region = lat < -60 ? 'Antarctica' : regionByCoord(lat, lng);
      const country = region === 'Antarctica' ? 'Antarctica' : 'Other';
      out.push({ name: title, wiki: title, country, region, lat, lng });
      seen.add(slug);
    }
    if (page.length < PAGE) break;
    if (off > 100000) { console.error('  no-country safety stop'); break; }
  }

  out.sort((a, x) => a.name.localeCompare(x.name));
  fs.writeFileSync(OUT, JSON.stringify(out));
  const countries = new Set(out.map((x) => x.country)).size;
  const regions = {};
  for (const x of out) regions[x.region] = (regions[x.region] || 0) + 1;
  console.error('wrote', out.length, 'entries,', countries, 'countries');
  console.error('regions:', JSON.stringify(regions));
})().catch((e) => { console.error('ERR', e); process.exit(1); });
