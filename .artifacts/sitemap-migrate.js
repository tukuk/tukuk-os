#!/usr/bin/env node
// The sitemap file names are public URLs too (robots.txt lists them), so the Malay
// ones move to English. Old names keep answering with a 301 so a crawler holding the
// previous address still lands on the new file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAP = [
  ['cuaca', 'weather'], ['gempa', 'earthquakes'], ['cuti', 'holidays'], ['negara', 'countries'],
  ['statistik', 'statistics'], ['bencana', 'disasters'], ['akademi', 'academy'], ['wang', 'money'],
  ['seni', 'art'], ['hidupan', 'life'], ['unsur', 'elements'], ['pepatah', 'proverbs'],
  ['rekod', 'records'], ['sejarah', 'history'], ['kota', 'cities'], ['warisan', 'heritage'],
];

const files = [
  ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.txt')).map((f) => `public/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.js')).map((f) => `test/${f}`),
];

const write = process.argv.includes('--write');
let hits = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  let src = before;
  for (const [oldName, newName] of MAP) {
    const re = new RegExp(`sitemap-${oldName}\\.xml`, 'g');
    hits += (src.match(re) || []).length;
    src = src.replace(re, `sitemap-${newName}.xml`);
  }
  if (src !== before) {
    if (write) fs.writeFileSync(abs, src);
    console.log(`${write ? 'wrote' : 'would write'} ${rel}`);
  }
}
console.log(`${write ? 'APPLIED' : 'DRY RUN'} - ${hits} sitemap name mentions`);
