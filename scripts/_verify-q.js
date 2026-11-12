#!/usr/bin/env node
/**
 * Batch-Q geo-cluster verification: same shape as scripts/_verify-m.js, different
 * subset of clusters. Ensures every route in `src/server.js` maps to a real module.
 */
const fs = require('fs');
const s = fs.readFileSync('src/server.js', 'utf8');
const map = {
  'pubs': '../src/kedai-minum', 'war-memorials': '../src/tanda-perang', 'post-offices': '../src/pejabat-pos',
  'springs': '../src/mata-air', 'concentration-camps': '../src/kem-tahanan', 'wadis': '../src/wadi',
  'hillforts': '../src/bukit-benteng',
};
let bad = 0;
for (const base of Object.keys(map)) {
  const line = s.split('\n').find((l) => l.includes("base: '" + base + "'") && l.includes('geoCfg'));
  if (!line) { console.log('NO CFG LINE', base); bad++; continue; }
  const ir = (line.match(/inRegion: '([^']+)'/) || [])[1];
  const bc = (line.match(/byCountry: '([^']+)'/) || [])[1];
  const fx = (line.match(/listKey: '([^']+)'/) || [])[1];
  const mod = require(map[base]);
  const okr = typeof mod[ir] === 'function' ? 'OK' : 'MISSING';
  const okb = typeof mod[bc] === 'function' ? 'OK' : 'MISSING';
  if (okr !== 'OK' || okb !== 'OK') bad++;
  console.log(base.padEnd(20), ir + '(' + okr + ')', bc + '(' + okb + ')');
}
console.log(bad ? 'BAD=' + bad : 'ALL CFG KEYS VALID');
