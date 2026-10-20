const fs = require('fs');
const s = fs.readFileSync('src/server.js', 'utf8');
const map = {
  'protected-areas': '../src/kawasan-lindung', 'summits': '../src/puncak', 'city-gates': '../src/gerbang-kota',
  'canal-locks': '../src/terusan-kunci', 'quarries': '../src/kuari', 'state-forests': '../src/hutan-negeri',
  'expressways': '../src/lebuh-raya', 'shipyards': '../src/galangan-kapal', 'obelisks': '../src/obelisk',
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
