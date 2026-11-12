#!/usr/bin/env node
// =============================================================================
// gen-og-images.js — build a branded 1200x630 Open Graph card per evergreen
// blog article in content/blog/*.md, rasterised with sharp to public/og/<slug>.png.
//
//   node scripts/gen-og-images.js            # (re)generate every card
//   node scripts/gen-og-images.js --only slug
//
// Why cards (not photos): the posts are text explainers with no hero image, and
// inventing a "relevant" stock photo per topic would be misleading. A deterministic
// brand card is honest, distinct per article, and gives social/AdSense a real 1200x630
// og:image instead of one generic site graphic. The post renderer falls back to
// /og.png for any slug that has no card here (e.g. auto-generated NASA/recipe posts).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
const OUT_DIR = path.join(ROOT, 'public', 'og');

const BRAND = 'TUKUK-OS';
const ACCENT = '#5b9dff';
const W = 1200, H = 630, PAD = 72;

// The markdown header is the same SLUG/TITLE/TAGS contract syncPostsFromContent parses.
function parseHeader(md, fallbackSlug) {
  const grab = (key) => {
    const m = md.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    return m ? m[1].trim() : '';
  };
  const tags = grab('TAGS').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    slug: grab('SLUG') || fallbackSlug,
    title: grab('TITLE') || fallbackSlug,
    tag: tags[0] || 'Guide',
  };
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

// Greedy word wrap to a max character count; returns the lines (never > maxLines).
function wrap(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) {
      cur = (cur + ' ' + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[^\w].*$/, '') + '…';
    return kept;
  }
  return lines;
}

// Pick the largest font size (from a fixed ladder) whose wrapped title fits in
// the allotted lines within the card width. Rough glyph advance ≈ 0.56 × fontSize
// for a bold sans, which is all we need to keep text inside the safe box.
function fitTitle(title) {
  const maxLines = 3;
  const availW = W - PAD * 2;
  for (const size of [76, 64, 54, 46, 40]) {
    const maxChars = Math.floor(availW / (size * 0.56));
    const lines = wrap(title, maxChars, maxLines);
    const widest = lines.reduce((a, b) => Math.max(a, b.length), 0);
    if (lines.length <= maxLines && widest <= maxChars) return { size, lines };
  }
  return { size: 40, lines: wrap(title, 30, maxLines) };
}

function buildOgSvg({ title, tag }) {
  const { size, lines } = fitTitle(title);
  const lineH = Math.round(size * 1.16);
  const blockTop = H / 2 - (lines.length - 1) * lineH / 2 + Math.round(size * 0.28);
  const tspans = lines.map((ln, i) =>
    `<text x="${PAD}" y="${blockTop + i * lineH}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#f5f8ff">${escapeXml(ln)}</text>`
  ).join('');
  // Tag pill (top-right).
  const pillText = (tag || 'Guide').toUpperCase();
  const pillW = Math.max(120, pillText.length * 15 + 44);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1731"/>
      <stop offset="1" stop-color="#142850"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="12" height="${H}" fill="${ACCENT}"/>
  <text x="${PAD}" y="118" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="4" fill="${ACCENT}">${escapeXml(BRAND)}</text>
  <g transform="translate(${W - PAD - pillW}, 82)">
    <rect width="${pillW}" height="52" rx="26" fill="rgba(91,157,255,0.16)" stroke="${ACCENT}" stroke-width="2"/>
    <text x="${pillW / 2}" y="34" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2" fill="#cfe0ff">${escapeXml(pillText)}</text>
  </g>
  ${tspans}
  <text x="${PAD}" y="${H - 64}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="400" fill="#8aa0c8">tukuk.org</text>
</svg>`;
}

async function generateAll(onlySlug) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  let made = 0, skipped = 0;
  for (const f of files) {
    const md = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
    const meta = parseHeader(md, path.basename(f, '.md'));
    if (onlySlug && meta.slug !== onlySlug) { skipped++; continue; }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(meta.slug)) continue; // filename-safe only
    const svg = buildOgSvg(meta);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT_DIR, meta.slug + '.png'));
    made++;
  }
  console.log(`gen-og-images: ${made} card(s) written to public/og/ (${skipped} not-in-scope skipped)`);
}

if (require.main === module) {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  generateAll(only).catch((e) => { console.error('gen-og-images FAILED:', e.message); process.exit(1); });
}

module.exports = { buildOgSvg, parseHeader, fitTitle, generateAll };
