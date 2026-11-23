#!/usr/bin/env node
// Repair the geo redirect rows: the second codemod pass rewrote both sides of each
// pair, so every old address redirected to itself (and the Malay address 404s).
// This rebuilds the block from the mapping, old side first.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAP = [
  ['cagar', 'conservation-areas'], ['gunung', 'mountains'], ['danau', 'lakes'], ['pulau', 'islands'],
  ['sungai', 'rivers'], ['air-terjun', 'waterfalls'], ['gua', 'caves'], ['gletser', 'glaciers'],
  ['teluk', 'bays'], ['lembah', 'valleys'], ['semenanjung', 'peninsulas'], ['gunung-berapi', 'volcanoes'],
  ['selat', 'straits'], ['kepulauan', 'archipelagos'], ['ngarai', 'gorges'], ['bukit', 'hills'],
  ['celah', 'mountain-gaps'], ['tanjung', 'capes'], ['lagun', 'lagoons'], ['danau-garam', 'salt-lakes'],
  ['laut', 'seas'], ['waduk', 'reservoirs'], ['tanah-basah', 'wetlands'], ['air-panas', 'hot-springs'],
  ['terumbu-karang', 'coral-reefs'], ['kaldera', 'calderas'], ['bendungan', 'dams'],
  ['pencakar-langit', 'skyscrapers'], ['jambatan', 'bridges'], ['mercu-suar', 'lighthouses'],
  ['terusan', 'canals'], ['menara', 'towers'], ['pelabuhan', 'ports'], ['terowong', 'tunnels'],
  ['gereja', 'churches'], ['museum', 'museums'], ['tapak-arkologi', 'archaeological-sites'],
  ['universiti', 'universities'], ['stadium', 'stadiums'], ['kastil', 'castles'], ['masjid', 'mosques'],
  ['monumen', 'monuments'], ['katedral', 'cathedrals'], ['hospital', 'hospitals'], ['hotel', 'hotels'],
  ['istana', 'palaces'], ['taman-botani', 'botanical-gardens'], ['taman', 'parks'],
  ['sinagog', 'synagogues'], ['perpustakaan', 'libraries'], ['kubu', 'fortifications'],
  ['balai-cerap', 'astronomical-observatories'], ['akuarium', 'aquariums'], ['banjaran', 'mountain-ranges'],
  ['tanah-kubur', 'cemeteries'], ['lapangan-terbang', 'airports'], ['biara', 'monasteries'],
  ['patung', 'statues'], ['rumah-opera', 'opera-houses'], ['gurun', 'deserts'], ['akueduk', 'aqueducts'],
];

const rows = [];
for (const [oldRoot, newRoot] of MAP) {
  rows.push(`  ['/${oldRoot}/:slug', '/${newRoot}/:slug'],`);
  rows.push(`  ['/${oldRoot}', '/${newRoot}'],`);
}
const block = [
  '  // The geo/place clusters ride the same promise: the Malay root 301s to its English',
  '  // address, and a slug keeps its detail page on the way through.',
  ...rows,
].join('\n');

const file = path.join(ROOT, 'src', 'server.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('  // The geo/place clusters ride the same promise:');
const tail = '].forEach(function (pair) { legacyRedirect(pair[0], pair[1], pair[2]); });';
const end = src.indexOf(tail, start);
if (start < 0 || end < 0) throw new Error('anchor not found');
const out = src.slice(0, start) + block + '\n' + src.slice(end);
fs.writeFileSync(file, out);
console.log(`rebuilt ${MAP.length} geo pairs (${rows.length} rows)`);
