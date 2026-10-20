const fs = require('fs');
const s = fs.readFileSync('src/server.js', 'utf8');
const map = {
  'mountain-passes': '../src/lewah', 'art-galleries': '../src/galeri-seni', 'casinos': '../src/kasino',
  'water-towers': '../src/menara-air', 'estuaries': '../src/muara', 'velodromes': '../src/velodrom',
  'planetariums': '../src/planetarium', 'amphitheatres': '../src/amphitheatre', 'menhirs': '../src/menhir',
};
let bad = 0;
for (const base of Object.keys(map)) {
  const line = s.split('\n').find((l) => l.includes("base: '" + base + "'") && l.includes('geoCfg'));
  if (!line) { console.log('NO CFG LINE', base); bad++; continue; }
  const ir = (line.match(/inRegion: '([^']+)'/) || [])[1];
  const bc = (line.match(/byCountry: '([^']+)'/) || [])[1];
  const mod = require(map[base]);
  const okr = typeof mod[ir] === 'function' ? 'OK' : 'MISSING';
  const okb = typeof mod[bc] === 'function' ? 'OK' : 'MISSING';
  if (okr !== 'OK' || okb !== 'OK') bad++;
  console.log(base.padEnd(16), ir + '(' + okr + ')', bc + '(' + okb + ')');
}
console.log(bad ? 'BAD=' + bad : 'ALL CFG KEYS VALID');
