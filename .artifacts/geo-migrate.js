#!/usr/bin/env node
// One-off codemod: the Malay geo/place section roots get English addresses.
// Data slugs (mountain names, park names) are already English, so only the root
// segment changes. Sitemap XML file names stay as they are (separate pass).
// Usage: node .artifacts/geo-migrate.js --dry | --write
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// [Malay root, English root]. /fjord and /zoo are already English words and are
// absent. Roots whose natural English name is taken by an existing cluster get a
// distinct name instead, so two datasets are never merged under one address.
const MAP = [
  ['cagar', 'conservation-areas'],
  ['gunung', 'mountains'],
  ['danau', 'lakes'],
  ['pulau', 'islands'],
  ['sungai', 'rivers'],
  ['air-terjun', 'waterfalls'],
  ['gua', 'caves'],
  ['gletser', 'glaciers'],
  ['teluk', 'bays'],
  ['lembah', 'valleys'],
  ['semenanjung', 'peninsulas'],
  ['gunung-berapi', 'volcanoes'],
  ['selat', 'straits'],
  ['kepulauan', 'archipelagos'],
  ['ngarai', 'gorges'],
  ['bukit', 'hills'],
  ['celah', 'mountain-gaps'],
  ['tanjung', 'capes'],
  ['lagun', 'lagoons'],
  ['danau-garam', 'salt-lakes'],
  ['laut', 'seas'],
  ['waduk', 'reservoirs'],
  ['tanah-basah', 'wetlands'],
  ['air-panas', 'hot-springs'],
  ['terumbu-karang', 'coral-reefs'],
  ['kaldera', 'calderas'],
  ['bendungan', 'dams'],
  ['pencakar-langit', 'skyscrapers'],
  ['jambatan', 'bridges'],
  ['mercu-suar', 'lighthouses'],
  ['terusan', 'canals'],
  ['menara', 'towers'],
  ['pelabuhan', 'ports'],
  ['terowong', 'tunnels'],
  ['gereja', 'churches'],
  ['museum', 'museums'],
  ['tapak-arkologi', 'archaeological-sites'],
  ['universiti', 'universities'],
  ['stadium', 'stadiums'],
  ['kastil', 'castles'],
  ['masjid', 'mosques'],
  ['monumen', 'monuments'],
  ['katedral', 'cathedrals'],
  ['hospital', 'hospitals'],
  ['hotel', 'hotels'],
  ['istana', 'palaces'],
  ['taman-botani', 'botanical-gardens'],
  ['taman', 'parks'],
  ['sinagog', 'synagogues'],
  ['perpustakaan', 'libraries'],
  ['kubu', 'fortifications'],
  ['balai-cerap', 'astronomical-observatories'],
  ['akuarium', 'aquariums'],
  ['banjaran', 'mountain-ranges'],
  ['tanah-kubur', 'cemeteries'],
  ['lapangan-terbang', 'airports'],
  ['biara', 'monasteries'],
  ['patung', 'statues'],
  ['rumah-opera', 'opera-houses'],
  ['gurun', 'deserts'],
  ['akueduk', 'aqueducts'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rewrite every address-shaped mention of the root, never the module file name
// (require('./gunung-data.json') and sitemap-gunung.xml must survive untouched).
function rulesFor(oldRoot, newRoot) {
  const o = escapeRe(oldRoot);
  return [
    [new RegExp(`(geoRoutes\\(')${o}(')`, 'g'), `$1${newRoot}$2`],
    [new RegExp(`(tukuk\\.org/)${o}(?=[/"'\`)\\s])`, 'g'), `$1${newRoot}`],
    [new RegExp(`(?<=["'\`(])\\/${o}(?=["'\`)/*\\s])`, 'g'), `/${newRoot}`],
    // The base also travels as a bare segment: geoSitemap('teluk', …), base: 'teluk',
    // geoHubPage(mod, 'teluk', CFG), and the cacheable-base list.
    [new RegExp(`(?<![\\w/.])'${o}'`, 'g'), `'${newRoot}'`],
    // A bespoke cluster registers its sitemap with a literal file name.
    [new RegExp(`sitemap-${o}\\.xml`, 'g'), `sitemap-${newRoot}.xml`],
  ];
}

const targets = ['src/server.js'];
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) if (f.endsWith('.js')) targets.push(`src/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'public'))) if (/\.(html|txt)$/.test(f)) targets.push(`public/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'test'))) if (f.endsWith('.js')) targets.push(`test/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'content', 'blog'))) if (f.endsWith('.md')) targets.push(`content/blog/${f}`);

const write = process.argv.includes('--write');
const perKey = new Map();
const changedFiles = [];

for (const rel of targets) {
  const abs = path.join(ROOT, rel);
  let src = fs.readFileSync(abs, 'utf8');
  const before = src;
  for (const [oldRoot, newRoot] of MAP) {
    for (const [re] of rulesFor(oldRoot, newRoot)) {
      const hits = (src.match(re) || []).length;
      if (hits) perKey.set(oldRoot, (perKey.get(oldRoot) || 0) + hits);
    }
  }
  for (const [oldRoot, newRoot] of MAP) {
    for (const [re, to] of rulesFor(oldRoot, newRoot)) src = src.replace(re, to);
  }
  if (src !== before) {
    if (write) fs.writeFileSync(abs, src);
    changedFiles.push(rel);
  }
}

let total = 0;
for (const [, n] of perKey) total += n;
console.log(`${write ? 'APPLIED' : 'DRY RUN'} - ${total} address mentions across ${changedFiles.length} files`);
const missing = MAP.map(([o]) => o).filter((o) => !perKey.has(o));
if (missing.length) console.log('roots with no mention found:', missing.join(', '));
if (write) console.log('files:', changedFiles.join(' '));
