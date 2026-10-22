#!/usr/bin/env node
/**
 * sync-store-catalog.js — Reconcile apk/catalog.json with the LIVE tukuk.org store.
 *
 * The /api/store shelf serves EVERY item (default bv-, arcade ak-, Satu Kata sk-/skg-,
 * community km-). The static apk/catalog.json is only the source of truth for the
 * Android Studio Gradle project (one productFlavour per item) + build-store-apks.sh.
 * This script adds items that DON'T exist yet so "all games" really means all.
 *
 * For every new item:
 *   1. package slug = the apkSlug() rule in src/server.js (bv-/ak- drop the prefix;
 *      sk-/skg-/km- are kept → no cross-source collisions).
 *   2. a unique SVG icon (hashed gradient + the emoji from the API) → public/icons/apps/<slug>.svg
 *      → PNG 512 (public/icons/apps/<slug>-512.png + apk/launcher/<slug>.png).
 *   3. per-flavour mipmaps (5 densities) → apk/app/src/<slug>/res/mipmap-<dpi>/ic_launcher.png
 *      — AGP merges flavour sources automatically; each APK gets its own launcher icon.
 *   4. the catalog entry {slug,label,pkg,url,media,icon,vc,vn} is stored (existing
 *      entries are NOT touched — special vc/vn/media such as chat stay).
 *
 * Usage: node scripts/sync-store-catalog.js [--dry]
 *   --dry : report only, no file writes.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const STORE_URL = process.env.STORE_URL || 'https://tukuk.org/api/store';
const APK_ORIGIN = process.env.APK_ORIGIN || 'https://tukuk.org';
const CATALOG_PATH = path.join(ROOT, 'apk', 'catalog.json');
const ICONS_DIR = path.join(ROOT, 'public', 'icons', 'apps');
const LAUNCH_DIR = path.join(ROOT, 'apk', 'launcher');
const APPS_SRC = path.join(ROOT, 'apk', 'app', 'src');
const DEFAULT_ICON = path.join(ROOT, 'public', 'icons', 'launcher-default.png');
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const DRY = process.argv.includes('--dry');

// Mirrors apkSlug() in src/server.js — strips the bv-/ak- prefix, cleans & lowercases.
function slugFromId(id) {
  let base = String(id || '');
  if (base.startsWith('bv-')) base = base.slice(3);
  else if (base.startsWith('ak-')) base = base.slice(3);
  const cleaned = base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!cleaned) return 'app';
  return (/^[a-z]/.test(cleaned) ? cleaned : 'a' + cleaned).slice(0, 40);
}

// Mirrors apkLabel() — strips shell/XML-dangerous characters, capped at 30 characters.
function cleanLabel(title) {
  const clean = String(title || '').replace(/[<>&"'`$\\]/g, '').replace(/\s+/g, ' ').trim();
  return (clean || 'Tukuk App').slice(0, 30);
}

// FNV-1a hash → two deterministic gradient colors (unique per slug, stable across runs).
function gradFor(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hue = Math.abs(h) % 360;
  const c1 = hslCss(hue, 78, 60);
  const c2 = hslCss((hue + 40) % 360, 72, 42);
  return { c1, c2 };
}
function hslCss(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

// Same template as generate-store-icons.js — a 128 gradient tile + the emoji.
function iconSvg(emoji, { c1, c2 }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <circle cx="42" cy="30" r="58" fill="#ffffff" opacity="0.10"/>
  <rect x="6" y="6" width="116" height="116" rx="24" fill="none" stroke="#000000" stroke-opacity="0.18"/>
  <text x="64" y="72" font-size="66" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>
`;
}

async function main() {
  const res = await fetch(STORE_URL);
  if (!res.ok) throw new Error(`GET ${STORE_URL} → ${res.status}`);
  const body = await res.json();
  const items = Array.isArray(body) ? body : body.items;
  if (!Array.isArray(items) || !items.length) throw new Error('The store response has no items[]');

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const apps = catalog.apps || catalog;
  const known = new Set(apps.map((a) => a.slug));

  const toAdd = [];
  const seen = new Set();
  for (const it of items) {
    const slug = slugFromId(it.id);
    if (known.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const rel = String(it.url || '/');
    toAdd.push({
      slug,
      label: cleanLabel(it.title),
      pkg: `org.tukuk.${slug}`,
      url: APK_ORIGIN + (rel.startsWith('/') ? rel : '/' + rel),
      media: false,
      icon: `public/icons/apps/${slug}-512.png`,
      vc: 1,
      vn: '1.0.0',
      _emoji: (it.icon || '').trim() || (it.kind === 'game' ? '🎮' : '📱'),
    });
  }
  console.log(`store=${items.length} items · catalogue=${known.size} · new=${toAdd.length}`);
  if (DRY) { toAdd.forEach((a) => console.log('  +', a.slug, '←', a.url)); return; }

  // 1) SVG icon + PNG-512 + launcher icon for the new items.
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.mkdirSync(LAUNCH_DIR, { recursive: true });
  for (const a of toAdd) {
    const svgPath = path.join(ICONS_DIR, `${a.slug}.svg`);
    if (!fs.existsSync(svgPath)) fs.writeFileSync(svgPath, iconSvg(a._emoji, gradFor(a.slug)));
    const png512 = path.join(ICONS_DIR, `${a.slug}-512.png`);
    if (!fs.existsSync(png512)) {
      const buf = await sharp(svgPath, { density: 300 })
        .resize(512, 512, { fit: 'contain', background: '#0f1115' })
        .png().toBuffer();
      fs.writeFileSync(png512, buf);
      fs.writeFileSync(path.join(LAUNCH_DIR, `${a.slug}.png`), buf);
    }
  }

  // 2) Per-flavour mipmaps for EVERY item ( existing + new ) — idempotent.
  const all = known.size ? apps.concat(toAdd) : toAdd;
  let mip = 0;
  for (const a of all) {
    if (!a.slug || !/^[a-z][a-z0-9]{0,39}$/.test(a.slug)) continue;
    const src512 = path.join(ICONS_DIR, `${a.slug}-512.png`);
    const base = fs.existsSync(src512) ? src512 : DEFAULT_ICON;
    for (const [dir, px] of Object.entries(DENSITIES)) {
      const out = path.join(APPS_SRC, a.slug, 'res', `mipmap-${dir}`, 'ic_launcher.png');
      if (fs.existsSync(out)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await sharp(base).resize(px, px, { fit: 'contain', background: '#0f1115' }).png().toFile(out);
      mip++;
    }
  }

  // 3) Catalog: drop the internal _emoji, keep the original order + the additions.
  for (const a of toAdd) delete a._emoji;
  if (catalog.apps) catalog.apps = apps.concat(toAdd);
  else catalog.splice(catalog.length, 0, ...toAdd);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`sync-store-catalog: +${toAdd.length} entries · ${mip} mipmaps generated · the catalogue is now ${known.size + toAdd.length} items`);
}

main().catch((e) => { console.error('sync-store-catalog FAILED:', e.message); process.exit(1); });
