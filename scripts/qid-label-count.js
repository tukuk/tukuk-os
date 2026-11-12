#!/usr/bin/env node
// Resolve a Wikidata class by exact English label and report its instance count
// (with coordinates + an English Wikipedia article) plus its QID.
// Usage: node scripts/qid-label-count.js "label1" "label2" ...
const https = require('https');
const UA = 'TukukOS-GeoFetch/1.0 (+https://tukuk.org)';

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
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  for (let attempt = 0; ; attempt++) {
    try { return await get(url, { Accept: 'application/sparql-results+json' }); }
    catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const labels = process.argv.slice(2);
  for (const label of labels) {
    const esc = label.replace(/"/g, '\\"');
    const q = `SELECT ?cls (COUNT(?e) AS ?n) WHERE {
      ?cls rdfs:label "${esc}"@en .
      ?e wdt:P31 ?cls ; wdt:P625 ?c .
      ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
    } GROUP BY ?cls ORDER BY DESC(?n) LIMIT 2`;
    try {
      const b = (await sparql(q)).results.bindings;
      if (!b.length) { console.log(`  ${label}  -> NONE`); }
      else b.forEach((x) => console.log(`  ${label}  ${x.cls.value.split('/').pop()}  n=${x.n.value}`));
    } catch (e) { console.log(`  ${label}  ERR ${e.message}`); }
    await sleep(7000);
  }
})();
