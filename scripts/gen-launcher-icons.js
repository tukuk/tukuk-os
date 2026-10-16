#!/usr/bin/env node
/**
 * gen-launcher-icons.js — Jana ikon pelancaran APK (512×512 PNG) untuk setiap apl
 * dalam apk/catalog.json yang BELUM ada PNG khas (mis. chat guna chat-512.png sedia ada).
 *
 * Sumber: public/icons/apps/<slug>.svg (jubin gradien + emoji, dijana
 * generate-store-icons.js). Output: apk/launcher/<slug>.png — dipakai build-apk.sh.
 *
 * Guna: node scripts/gen-launcher-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'apk', 'catalog.json'), 'utf8')).apps;
const LAUNCH = path.join(ROOT, 'apk', 'launcher');
const ICONS = path.join(ROOT, 'public', 'icons', 'apps');

fs.mkdirSync(LAUNCH, { recursive: true });

(async () => {
  let made = 0, skip = 0, miss = [];
  for (const a of CATALOG) {
    const png512 = path.join(ICONS, `${a.slug}-512.png`);
    // Apl dengan PNG 512 khas (cth. chat) — build akan pakai itu; tak perlu jana.
    if (fs.existsSync(png512)) { skip++; continue; }
    const svg = path.join(ICONS, `${a.slug}.svg`);
    if (!fs.existsSync(svg)) { miss.push(a.slug); continue; }
    const out = path.join(LAUNCH, `${a.slug}.png`);
    // Render SVG pada DPI tinggi, padkan ke kanvas 512 dengan latar gelap (logo penuh).
    await sharp(svg, { density: 300 })
      .resize(512, 512, { fit: 'contain', background: '#0f1115' })
      .png()
      .toFile(out);
    made++;
  }
  console.log(`gen-launcher-icons: ${made} dijana, ${skip} guna PNG khas, ${miss.length} tiada SVG${miss.length ? ' → ' + miss.join(', ') : ''}`);
  if (miss.length) process.exitCode = 1;
})().catch(e => { console.error('gen-launcher-icons GAGAL:', e.message); process.exit(1); });
