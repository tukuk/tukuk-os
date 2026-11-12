#!/usr/bin/env node
/**
 * generate-icons.js — Generate the icons for the desktop app.
 *
 * Requires: sharp (already installed as a devDependency)
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SVG = path.join(BUILD_DIR, 'icon.svg');

function generate() {
  if (!fs.existsSync(SVG)) {
    console.error('Icon file is missing:', SVG);
    process.exit(1);
  }

  const sizes = [
    { name: 'icon.png', size: 512 },
    { name: 'icon-256.png', size: 256 },
    { name: 'icon-128.png', size: 128 },
    { name: 'icon-64.png', size: 64 },
    { name: 'icon-48.png', size: 48 },
    { name: 'icon-32.png', size: 32 },
    { name: 'icon-16.png', size: 16 }
  ];

  console.log('[icons] generating the PNG icons...');
  for (const { name, size } of sizes) {
    const out = path.join(BUILD_DIR, name);
    sharp(SVG)
      .resize(size, size)
      .png()
      .toFile(out)
      .then(() => console.log(`[icons] ${out}`))
      .catch((err) => {
        console.error(`[icons] failed to generate ${out}:`, err.message);
      });
  }

  // ICO for Windows (electron-builder generates it from the PNGs)
  console.log('[icons] skip icon.ico (electron-builder generates it automatically)');

  // ICNS for macOS (electron-builder generates it from the PNGs)
  if (process.platform === 'darwin') {
    console.log('[icons] skip icon.icns (electron-builder generates it automatically)');
  } else {
    console.log('[icons] skip icon.icns (macOS only)');
  }

  console.log('[icons] done!');
}

generate();
