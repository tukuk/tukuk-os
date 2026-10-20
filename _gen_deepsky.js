'use strict';
// One-off AUTHORING-TIME generator (not runtime). Parses Wikipedia IAU + Messier
// wikitext tables into a clean static JSON: src/deepsky-data.json. Delete after use.
const fs = require('fs');

const dash = (s) => String(s == null ? '' : s).replace(/\u2212/g, '-'); // Unicode minus -> hyphen

function cleanWiki(s) {
  s = dash(s);
  s = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/\{\{shy\|([^{}]*)\}\}/gi, (_, g) => g.replace(/\|/g, '')); // keep soft-hyphenated text joined
  let prev; do { prev = s; s = s.replace(/\{\{[^{}]*\}\}/g, ''); } while (s !== prev);
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/data-sort-value="[^"]*"/g, '');
  s = s.replace(/[\{\}\[\]]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

// ── CONSTELLATIONS: IAU designated constellations table ──
const cLines = dash(fs.readFileSync('/tmp/iaudc.wiki', 'utf8'));
const tblC = cLines.slice(cLines.indexOf('{| class="wikitable sortable sort-under')).split('\n|-');
const constellations = [];
for (const block of tblC) {
  if (!block.includes('||')) continue;
  const cells = block.split('\n').join(' ').split('||');
  if (cells.length < 10) continue;
  const m0 = cells[0].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!m0) continue;
  let name = cleanWiki(m0[2] || m0[1]).replace(/\s*\(constellation\)\s*$/i, '');
  const abbr = cleanWiki(cells[1]);
  if (!name || !/^[A-Z]/.test(name) || !/^[A-Za-z]{2,3}$/.test(abbr)) continue;
  const genitive = cleanWiki(cells[3]);
  const meaning = cleanWiki(cells[8]);
  const mb = cells[9].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const brightest = mb ? cleanWiki(mb[2] || mb[1]) : '';
  const nums = (cells[9].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const brightestMag = nums.length >= 2 ? nums[nums.length - 2] : null;
  const area = nums.length ? nums[nums.length - 1] : null;
  constellations.push({ name, abbr, genitive, meaning, brightest, brightestMag, area });
}

// ── HEMISPHERE + AREA: join from solid-angle table by abbreviation ──
const saRaw = dash(fs.readFileSync('/tmp/iau.wiki', 'utf8'));
const hemiByAbbr = {}, areaByAbbr = {};
for (const line of saRaw.split('\n')) {
  if (!line.includes('||')) continue;
  const cells = line.split('||').map((c) => c.trim());
  const abbr = cells[1];
  if (!/^[A-Za-z]{2,3}$/.test(abbr)) continue;
  const code = (cells[cells.length - 1] || '').replace(/[^A-Za-z].*$/, '');
  const L = (code[0] || '').toUpperCase();
  hemiByAbbr[abbr.toUpperCase()] = L === 'N' ? 'Northern' : L === 'S' ? 'Southern' : 'Equatorial';
  const a = parseFloat((cells[3] || '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(a)) areaByAbbr[abbr.toUpperCase()] = a;
}

// ── MESSIER: Messier object table ──
const mRaw = dash(fs.readFileSync('/tmp/messier.wiki', 'utf8'));
const tblM = mRaw.slice(mRaw.indexOf('{|class="wikitable'));
const colorType = { '#eef': 'Open cluster', '#feb': 'Globular cluster', '#fcc': 'Diffuse nebula', '#cfe': 'Planetary nebula', '#fce': 'Supernova remnant', '#ffc': 'Galaxy', '#fff': 'Deep-sky object' };
const constNames = new Set(constellations.map((c) => c.name.toLowerCase()));
const messier = [];
for (const block of tblM.split('\n|-')) {
  if (!/scope="row"/.test(block)) continue;
  const idm = block.match(/scope="row"\s*\|\s*\[\[[^\]]*?\|?(M\d{1,3})\]?\]/) || block.match(/\|(M\d{1,3})\]\]/) || block.match(/\b(M\d{1,3})\b/);
  if (!idm) continue;
  const id = idm[1].toUpperCase();
  const bg = (block.match(/style="background:(#[0-9a-f]{3})"/i) || [])[1];
  const type = (bg && colorType[bg.toLowerCase()]) || 'Deep-sky object';
  const ngc = (block.match(/\b(NGC\s*\d+[A-Za-z]?|IC\s*\d+[A-Za-z]?)\b/) || [])[1] || null;
  const nameM = block.match(/''([^']+)''/);
  let name = nameM ? cleanWiki(nameM[1]) : '';
  let constellation = null, mag = null, distance = null;
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lk = lines[i].match(/\[\[([^\]]+)\]\]/);
    if (lk && !constellation) {
      const disp = cleanWiki(lk[1].includes('|') ? lk[1].split('|').pop() : lk[1].split('(')[0]);
      if (constNames.has(disp.toLowerCase())) {
        constellation = constellations.find((c) => c.name.toLowerCase() === disp.toLowerCase()).name;
        const nm = (lines[i + 1] || '').match(/^\s*\|\s*(-?\d+(?:\.\d+)?)/);
        mag = nm ? Number(nm[1]) : null;
        const dm = (lines[i - 1] || '').match(/(\d+(?:\.\d+)?)/);
        distance = dm ? Number(dm[1]) : null;
      }
    }
  }
  messier.push({ id, name, type, constellation, ngc, mag, distance });
}

// dedupe
const seenC = new Set();
const cFinal = constellations.filter((c) => (seenC.has(c.name) ? false : (seenC.add(c.name), true)))
  .map((c) => ({ ...c, hemisphere: hemiByAbbr[c.abbr.toUpperCase()] || 'Equatorial', area: areaByAbbr[c.abbr.toUpperCase()] != null ? Math.round(areaByAbbr[c.abbr.toUpperCase()]) : c.area }));
const seenM = new Set();
const mFinal = messier.filter((o) => (seenM.has(o.id) ? false : (seenM.add(o.id), true)));

console.log('constellations:', cFinal.length, '| messier:', mFinal.length);
console.log('Andromeda:', JSON.stringify(cFinal.find((c) => c.name === 'Andromeda')));
console.log('Bootes:', JSON.stringify(cFinal.find((c) => c.name === 'Boötes')));
console.log('Orion:', JSON.stringify(cFinal.find((c) => c.name === 'Orion')));
console.log('M1:', JSON.stringify(mFinal.find((m) => m.id === 'M1')));
console.log('M31:', JSON.stringify(mFinal.find((m) => m.id === 'M31')));
console.log('M42:', JSON.stringify(mFinal.find((m) => m.id === 'M42')));
console.log('M102?:', JSON.stringify(mFinal.find((m) => m.id === 'M102')));
console.log('C missing hemisphere:', cFinal.filter((c) => !c.hemisphere).length);
console.log('M missing constellation:', mFinal.filter((m) => !m.constellation).map((m) => m.id).join(',') || 'none');
console.log('M missing mag:', mFinal.filter((m) => m.mag == null).map((m) => m.id).join(',') || 'none');
fs.writeFileSync('src/deepsky-data.json', JSON.stringify({ constellations: cFinal, messier: mFinal }));
console.log('wrote bytes:', fs.statSync('src/deepsky-data.json').size);
