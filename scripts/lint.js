'use strict';
// lint.js — real syntax check (node --check) across every .js file we ship.
// Replaces the old stub that only printed "No lint errors" without checking anything.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// public/ was missing from this list for a long time and the browser-side code is
// exactly where a typo hides: public/sw.js shipped with an unbalanced bracket, so the
// service worker never installed. Anything the browser loads has to be parsed here.
const ROOTS = ['src', 'mcp', 'scripts', 'worker', 'public', 'templates', 'desktop', 'cloudflare-worker'];
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

// Second step: check the INLINE scripts inside HTML + the scope chain of every JS file.
// `node --check` is blind to both — an error like a variable used outside its scope only
// shows up when a visitor presses the button in a browser.
function* htmlFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* htmlFiles(full); }
    else if (e.name.endsWith('.html')) yield full;
  }
}
const scopeTargets = [...htmlFiles('public'), ...htmlFiles('templates'), ...all];
let scopeOut = '', scopeFail = null, scopeSkipped = false;
try {
  scopeOut = execFileSync(process.execPath, ['scripts/lint-inline.js', ...scopeTargets], { stdio: 'pipe' }).toString().trim();
} catch (err) {
  const msg = String(err.stderr || err.message || '');
  if (/Cannot find module/.test(msg) && /acorn|eslint-scope/.test(msg)) scopeSkipped = true;
  else scopeFail = (err.stdout ? err.stdout.toString() : '') + msg;
}

if (failures.length) {
  console.error(`✗ lint failed — ${failures.length}/${all.length} files have syntax errors:`);
  for (const f of failures) console.error(`  ${f.file}: ${f.msg}`);
  process.exit(1);
}
if (scopeFail) {
  console.error('✗ the scope check failed:');
  console.error(scopeFail);
  process.exit(1);
}
if (scopeSkipped) console.log('- scope check skipped (acorn/eslint-scope not installed)');
else console.log(`✓ scope OK — ${scopeTargets.length} files checked (inline scripts + variables)`);
if (scopeOut && !/^CLEAN/.test(scopeOut)) console.log('  ' + scopeOut);
console.log(`✓ lint OK — ${checked} .js files checked (syntax)`);
