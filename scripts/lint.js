'use strict';
// lint.js — semakan sintaks sebenar (node --check) merentas semua fail .js.
// Menggantikan stub lama yang hanya mencetak "No lint errors" tanpa memeriksa apa-apa.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOTS = ['src', 'mcp', 'scripts', 'worker'];
const SINGLE = ['index.js'];

function* jsFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* jsFiles(full); }
    else if (e.name.endsWith('.js')) yield full;
  }
}

let checked = 0;
const failures = [];
const all = [];
for (const r of ROOTS) for (const f of jsFiles(r)) all.push(f);
for (const f of SINGLE) if (fs.existsSync(f)) all.push(f);

for (const file of all) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); checked += 1; }
  catch (err) { failures.push({ file, msg: String(err.stderr || err.message).split('\n').slice(0, 3).join(' ') }); }
}

if (failures.length) {
  console.error(`✗ lint gagal — ${failures.length}/${all.length} fail mempunyai ralat sintaks:`);
  for (const f of failures) console.error(`  ${f.file}: ${f.msg}`);
  process.exit(1);
}
console.log(`✓ lint OK — ${checked} fail .js disemak (sintaks)`);
