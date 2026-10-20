const fs = require('fs');
const s = fs.readFileSync('src/server.js', 'utf8');
const map = {
  'hindu-temples': '../src/candi-hindu', 'country-houses': '../src/rumah-pedesaan', 'shinto-shrines': '../src/kuil-shinto',
  'plateaus': '../src/dataran-tinggi', 'plains': '../src/dataran-rendah', 'stone-circles': '../src/lingkaran-batu',
  'pagodas': '../src/pagoda', 'dolmens': '../src/dolmen', 'barrows': '../src/gundar', 'bell-towers': '../src/menara-loceng',
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
