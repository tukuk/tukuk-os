#!/usr/bin/env node
/**
 * generate-chat-icons.js — Jana PNG ikon PWA untuk T Chat daripada chat.svg.
 * Hasil: chat-192.png, chat-512.png (any) dan chat-maskable-512.png (maskable,
 * kandungan discalar ke safe-zone 70% dengan latar penuh tanpa bucu bundar).
 * Guna: node scripts/generate-chat-icons.js   (prasyarat: sharp devDependency)
 */
const fs = require('fs');
const path = require('path');

async function main() {
  let sharp;
  try { sharp = require('sharp'); } catch (e) { console.error('sharp tidak dijumpai (npm i -D sharp)'); process.exit(1); }

  const svgPath = path.join(__dirname, '..', 'public', 'icons', 'apps', 'chat.svg');
  const outDir = path.dirname(svgPath);
  const svg = fs.readFileSync(svgPath, 'utf8');

  const targets = [
    { name: 'chat-192.png', size: 192, src: svg },
    { name: 'chat-512.png', size: 512, src: svg },
  ];

  // Versi maskable: latar penuh tanpa bucu bundar + SEMUA kandungan (kecuali
  // rect latar & border inset) discalar ke safe-zone ~72% di tengah.
  const defs = (svg.match(/<defs>[\s\S]*<\/defs>/) || [''])[0];
  const body = svg.replace(/<\?xml[^?]*\?>/, '').replace(/<svg[^>]*>/, '').replace('</svg>', '')
    .replace(/<defs>[\s\S]*<\/defs>/, '')
    .replace('<rect width="128" height="128" rx="28" fill="url(#bg)"/>', '')
    .replace(/<rect x="6" y="6"[^/]*\/>/, '')
    .trim();
  const bgFlat = '<rect width="128" height="128" fill="url(#bg)"/>';
  const maskSrc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
    + defs + bgFlat
    + '<g transform="translate(64 64) scale(0.72) translate(-64 -64)">' + body + '</g></svg>';
  targets.push({ name: 'chat-maskable-512.png', size: 512, src: maskSrc });

  for (const t of targets) {
    await sharp(Buffer.from(t.src), { density: 384 }).resize(t.size, t.size).png().toFile(path.join(outDir, t.name));
    console.log('[chat-icons] ' + t.name);
  }
  // Manifest juga guna SVG (pelayar moden sokong); pastikan ia wujud.
  console.log('[chat-icons] siap.');
}
main().catch((e) => { console.error(e); process.exit(1); });
