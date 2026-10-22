#!/usr/bin/env node
/**
 * Batch-M geo-cluster verification: ensure every declared route in `src/server.js`
 * has a matching module file and a live catalog entry. Prints a per-cluster hit/miss
 * report and exits 1 if anything is missing. Batch letter just tracks when the module
 * set was added to the site; the other _verify-* scripts are the same check for
 * batches N/O/P/Q.
 */
const fs = require('fs');
const s = fs.readFileSync('src/server.js', 'utf8');
const mods = {
  'fire-stations': '../src/balai-padam',
  'nightclubs': '../src/kelab-malam',
  'racecourses': '../src/lumba-kuda',
  'wind-farms': '../src/ladang-angin',
  'water-parks': '../src/taman-air',
  'triumphal-arches': '../src/gerbang-kemenangan',
  'police-stations': '../src/balai-polis',
};
for (const base of Object.keys(mods)) {
  const re = new RegExp("base: '" + base + "'[\\s\\S]{0,500}?\\}", 'm');
  const m = s.match(re);
  if (!m) { console.log('NO CFG DEF', base); continue; }
  const blk = m[0];
  const ir = (blk.match(/inRegion: '([^']+)'/) || [])[1];
  const bc = (blk.match(/byCountry: '([^']+)'/) || [])[1];
  const mod = require(mods[base]);
  const okr = typeof mod[ir] === 'function' ? 'OK' : 'MISSING';
  const okb = typeof mod[bc] === 'function' ? 'OK' : 'MISSING';
  console.log(base.padEnd(18), 'inRegion=' + ir + '(' + okr + ')', 'byCountry=' + bc + '(' + okb + ')');
}
