// Probe: resolve term -> QID (wbsearchentities) or accept a direct Qid, then
// SPARQL count of located items with an en-wiki article.
const https = require('https');
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tukuk-probe/1.0', ...headers } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
async function resolveQid(term) {
  const u = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' +
    encodeURIComponent(term) + '&language=en&format=json&limit=3&uselang=en';
  const j = JSON.parse(await get(u));
  const hit = (j.search || [])[0];
  return hit ? { id: hit.id, label: hit.label } : null;
}
async function count(qid) {
  const q = `SELECT (COUNT(*) AS ?n) WHERE { ?e wdt:P31 wd:${qid} ; wdt:P625 ?coord . ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> . }`;
  const u = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(q);
  const d = await get(u, { Accept: 'application/sparql-results+json' });
  try { return Number(JSON.parse(d).results.bindings[0].n.value); } catch { return -1; }
}
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const term of process.argv.slice(2)) {
    if (/^Q\d+$/.test(term)) { console.log(term.padEnd(22), term, '[direct]'.padEnd(22), 'count=' + await count(term)); await sleep(8000); continue; }
    const hit = await resolveQid(term);
    if (!hit) { console.log(term.padEnd(22), 'NO-RESOLVE'); await sleep(6000); continue; }
    console.log(term.padEnd(22), hit.id, ('[' + (hit.label || '') + ']').padEnd(22), 'count=' + await count(hit.id));
    await sleep(8000);
  }
})();
