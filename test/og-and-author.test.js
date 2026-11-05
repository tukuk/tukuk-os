'use strict';
/*
 * OG-card + author-entity regression guard (added 2026-10-26).
 *
 * Locks in three things so they cannot silently regress:
 *   1. scripts/gen-og-images.js renders a valid, XML-escaped, ≤3-line brand card.
 *   2. The blog post renderer points og:image at the per-article card when the
 *      file exists (public/og/<slug>.png) and falls back to /og.png otherwise,
 *      and declares the author as a Person whose url is the /about page.
 *   3. /about actually carries that Person entity (E-E-A-T: author.url must land
 *      on a page that names the author).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { buildOgSvg, fitTitle } = require('../scripts/gen-og-images.js');
const serverSrc = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');
const aboutHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'about.html'), 'utf8');

test('gen-og-images builds a 1200x630 card and XML-escapes the title', () => {
  const svg = buildOgSvg({ title: 'Rocks & <Gas> "Ash"', tag: 'Volcanoes' });
  assert.ok(svg.includes('width="1200"') && svg.includes('height="630"'), 'card is 1200x630');
  assert.ok(svg.includes('TUKUK-OS'), 'brand is present');
  assert.ok(svg.includes('&amp;') && svg.includes('&lt;Gas&gt;') && svg.includes('&quot;'), 'title is XML-escaped');
  assert.ok(!/Rocks & <Gas>/.test(svg), 'raw unescaped title must not leak into the SVG');
});

test('long titles wrap to at most three lines (never overflow the card)', () => {
  const { lines } = fitTitle('How Earthquakes Are Measured: Magnitude Versus Intensity And Why It Matters');
  assert.ok(lines.length <= 3, 'title must fit in three lines');
});

test('a committed OG card exists for an evergreen article and is exactly 1200x630', async () => {
  const file = path.join(__dirname, '..', 'public', 'og', 'how-gps-knows-where-you-are.png');
  assert.ok(fs.existsSync(file), 'public/og/how-gps-knows-where-you-are.png must be committed');
  const m = await sharp(file).metadata();
  assert.strictEqual(m.width, 1200);
  assert.strictEqual(m.height, 630);
  assert.strictEqual(m.format, 'png');
});

test('the post renderer uses the per-article card with an /og.png fallback', () => {
  assert.ok(serverSrc.includes("path.join(PUBLIC_DIR, 'og', post.slug + '.png')"), 'renderer checks for a per-slug card');
  assert.ok(serverSrc.includes('https://tukuk.org/og/'), 'renderer points og:image at /og/<slug>.png');
  assert.ok(serverSrc.includes("'https://tukuk.org/og.png'"), 'renderer keeps the generic fallback');
});

test('blog posts declare the author as a Person linked to /about', () => {
  assert.ok(serverSrc.includes('"@type": "BlogPosting"'), 'BlogPosting block exists');
  assert.ok(/"author":\s*\{[^}]*"@type":\s*"Person"[^}]*"url":\s*"https:\/\/tukuk\.org\/about"/s.test(serverSrc), 'author Person.url is the /about page');
  assert.ok(serverSrc.includes('rel="author"'), 'the visible author name links with rel=author');
});

test('/about declares the Person entity that posts point at', () => {
  assert.ok(aboutHtml.includes('"@type": "Person"'), '/about carries a Person JSON-LD node');
  assert.ok(aboutHtml.includes('Fevian Donald'), '/about names the author');
  assert.ok(aboutHtml.includes('https://tukuk.org/about#author'), '/about gives the author a stable @id');
});

test('every article in content/blog has a committed OG card (no image-less pages)', () => {
  const dir = path.join(__dirname, '..', 'content', 'blog');
  const missing = [];
  for (const f of fs.readdirSync(dir)) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = raw.match(/^SLUG:\s*(.*)$/m);
    const slug = m ? m[1].trim() : f.replace(/\.md$/, '');
    if (!fs.existsSync(path.join(__dirname, '..', 'public', 'og', slug + '.png'))) missing.push(slug);
  }
  assert.deepStrictEqual(missing, [], 'run scripts/gen-og-images.js and commit the cards: ' + missing.join(', '));
});

test('blog and wiki article pages both show the card as an in-body hero image', () => {
  // Blog: the <article> opens with the figure when a per-slug card exists.
  assert.ok(serverSrc.includes('— article card" width="1200" height="630"'), 'an article hero figure is rendered');
  // Wiki: wikiHead takes the per-article image instead of the hard-coded generic one.
  assert.ok(serverSrc.includes('function wikiHead(title, selfUrl, desc, jsonLd, robots, ogImg)'), 'wikiHead accepts a per-article og:image');
  assert.ok(/const og = ogImg \|\| 'https:\/\/tukuk\.org\/og\.png'/.test(serverSrc), 'wiki falls back to the generic graphic');
});
