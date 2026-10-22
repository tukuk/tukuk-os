#!/usr/bin/env node
/**
 * generate-chat-icons.js — Generate the PWA PNG icons for T Chat from chat.svg.
 * Output: chat-192.png, chat-512.png (any) and chat-maskable-512.png (maskable,
 * content scaled into the 70% safe-zone on a full square background with no rounded corners).
 * Usage: node scripts/generate-chat-icons.js   (requires the sharp devDependency)
 */
const fs = require('fs');
const path = require('path');

async function main() {
  let sharp;
  try { sharp = require('sharp'); } catch (e) { console.error('sharp is missing (npm i -D sharp)'); process.exit(1); }

  const svgPath = path.join(__dirname, '..', 'public', 'icons', 'apps', 'chat.svg');
  const outDir = path.dirname(svgPath);
  const svg = fs.readFileSync(svgPath, 'utf8');

  const targets = [
    { name: 'chat-192.png', size: 192, src: svg },
    { name: 'chat-512.png', size: 512, src: svg },
  ];

  // Maskable variant: full square background with no rounded corners + ALL content (except
  // the background rect & the inset border) scaled into a ~72% safe-zone in the middle.
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
  // The manifest also uses the SVG (modern browsers support it); make sure it exists.
  console.log('[chat-icons] done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
