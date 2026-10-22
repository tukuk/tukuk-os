#!/usr/bin/env node
/**
 * patch-satukata-favicon.js — Sisipkan favicon emoji (data-URI SVG) ke dalam
 * templat Satu Kata dan semua halaman generated/ yang sudah wujud, supaya
 * setiap app/game satu-kata ada icon sendiri pada tab pelayar.
 *
 * Guna: node scripts/patch-satukata-favicon.js
 */
const fs = require('fs');
const path = require('path');

const SNIPPET = `<script>(function(){try{var l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.href='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="'+CFG.palette.soft+'"/><text y=".9em" font-size="82" x="50" text-anchor="middle">'+CFG.emoji+'</text></svg>');document.head.appendChild(l);}catch(e){}})();</script>`;

const targets = [
  path.join(__dirname, 'satu-kata', 'templates', 'app.html'),
  path.join(__dirname, 'satu-kata', 'templates', 'game.html'),
];
// semua halaman generated sedia ada (app/game index)
const GEN = path.join(__dirname, '..', 'generated', 'public');
for (const word of fs.readdirSync(GEN)) {
  for (const sub of ['app', 'game']) {
    const f = path.join(GEN, word, sub, 'index.html');
    if (fs.existsSync(f)) targets.push(f);
  }
}

let patched = 0, skipped = 0;
for (const f of targets) {
  let h = fs.readFileSync(f, 'utf8');
  if (h.includes("l.rel='icon'")) { skipped++; continue; } // sudah ditampal
  const m = h.match(/^<script>var CFG = .*;<\/script>$/m);
  if (!m) { console.log('NO CFG line:', f); skipped++; continue; }
  h = h.replace(m[0], m[0] + '\n' + SNIPPET);
  fs.writeFileSync(f, h);
  patched++;
}
console.log(`Favicon satu-kata: ${patched} patched, ${skipped} skipped (already present / no CFG)`);
