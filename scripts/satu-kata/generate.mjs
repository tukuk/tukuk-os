#!/usr/bin/env node
/**
 * satu-kata — jana SATU app + SATU game daripada SATU kata.
 *
 *   node scripts/satu-kata/generate.mjs [kata] [--unity] [--dry]
 *
 * Falsafah: "semudah membuat aplikasi React & Flutter" — tapi TANPA build step.
 * Keluaran ialah fail HTML tunggal (Preact+htm untuk app, Phaser untuk game)
 * yang boleh di-deploy terus ke Cloudflare Pages. ~0 minit CI, VPS tak dibebani.
 *
 * Template disimpan sebagai fail HTML sebenar di scripts/satu-kata/templates/
 * supaya backtick/`${'${}'}` JS tidak perlu di-escape. Token diganti:
 *   {{CFG}}  → JSON {word,slug,emoji,tagline,genre,palette}
 *   {{WORD}} → kata (untuk <title>/<meta>)
 *
 * input kata:   argv[2] > env SATU_KATA_WORD > kata seterusnya dalam words.txt
 *                yang belum ada dalam manifest (kitaran harian cron).
 * output:        generated/public/<slug>/app/index.html
 *                generated/public/<slug>/game/index.html
 *                generated/public/<slug>/unity/GameMain.cs   (hanya --unity)
 *                generated/manifest.json · generated/public/index.html (hub)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TPL = path.join(HERE, 'templates');
const OUT_ROOT = path.join(ROOT, 'generated');
const PUB_ROOT = path.join(OUT_ROOT, 'public');
const MANIFEST = path.join(OUT_ROOT, 'manifest.json');
const WORDS = path.join(HERE, 'words.txt');

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const slugify = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'kata';

const PALETTES = [
  { name: 'solar', bg: '#0f172a', fg: '#e2e8ff', accent: '#f59e0b', soft: '#1e293b' },
  { name: 'minta', bg: '#0b132b', fg: '#dbeafe', accent: '#38bdf8', soft: '#1c2541' },
  { name: 'hijau', bg: '#04130f', fg: '#d1fae5', accent: '#34d399', soft: '#0b3b2e' },
  { name: 'mawar', bg: '#1a0b14', fg: '#ffe4e6', accent: '#fb7185', soft: '#3b0a24' },
  { name: 'ungu', bg: '#12081f', fg: '#ede9fe', accent: '#a78bfa', soft: '#2a1650' },
  { name: 'karat', bg: '#1c1917', fg: '#fef3c7', accent: '#f97316', soft: '#292524' }
];
const GENRES = ['catch', 'tap', 'memory', 'runner'];

function themeFor(slug) {
  const h = hash(slug);
  const palette = PALETTES[parseInt(h.slice(0, 2), 16) % PALETTES.length];
  const genre = GENRES[parseInt(h.slice(2, 4), 16) % GENRES.length];
  return { palette, genre };
}

function loadWords() {
  if (!fs.existsSync(WORDS)) return [];
  return fs.readFileSync(WORDS, 'utf8').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [word, emoji, tagline] = l.split('|').map((x) => (x || '').trim());
      return { word, emoji: emoji || '✨', tagline: tagline || '' };
    });
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return { entries: [] }; }
}

function pickWord(words, manifest, explicit) {
  if (explicit) {
    const found = words.find((w) => slugify(w.word) === slugify(explicit));
    return found || { word: explicit, emoji: '✨', tagline: '' };
  }
  const used = new Set(manifest.entries.map((e) => e.slug));
  const next = words.find((w) => !used.has(slugify(w.word)));
  if (next) return next;
  return words[Math.floor(Math.random() * words.length)];
}

const readTpl = (f) => fs.readFileSync(path.join(TPL, f), 'utf8');
const fill = (tpl, cfg) => tpl.replaceAll('{{CFG}}', JSON.stringify(cfg)).replaceAll('{{WORD}}', cfg.word);

// hub dibina terus daripada manifest (tiada token rumit)
function hubHtml(manifest) {
  const cards = manifest.entries.slice().reverse().map((e) => {
    const p = themeFor(e.slug).palette;
    return `<a class="c" style="--accent:${p.accent};--soft:${p.soft}" href="${e.slug}/app/">`
      + `<div class="em">${e.emoji}</div><div class="w">${e.word}</div>`
      + `<div class="m">app + game · ${e.genre || ''}</div></a>`;
  }).join('\n');
  return readTpl('hub.html')
    .replaceAll('{{COUNT}}', String(manifest.entries.length))
    .replace('{{CARDS}}', cards || '<em>Belum ada hasil — jalankan generate.mjs.</em>');
}

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const explicit = argv.find((a) => !a.startsWith('--')) || process.env.SATU_KATA_WORD || '';
  const dry = flags.has('--dry');
  const withUnity = flags.has('--unity');

  const words = loadWords();
  const manifest = loadManifest();
  const chosen = pickWord(words, manifest, explicit);
  const slug = slugify(chosen.word);
  const t = themeFor(slug);

  const cfg = { word: chosen.word, slug, emoji: chosen.emoji, tagline: chosen.tagline, genre: t.genre, palette: t.palette };
  const entry = { ...cfg, theme: t.palette.name, game: true, createdAt: new Date().toISOString() };
  delete entry.palette; entry.palette = t.palette.name; // manifest ringan: simpan nama palette

  const app = fill(readTpl('app.html'), cfg);
  const game = fill(readTpl('game.html'), cfg);

  const dirs = {
    app: path.join(PUB_ROOT, slug, 'app'),
    game: path.join(PUB_ROOT, slug, 'game'),
    unity: path.join(PUB_ROOT, slug, 'unity')
  };

  if (dry) {
    console.log(`[satu-kata] DRY — kata="${chosen.word}" slug=${slug} genre=${t.genre} palette=${t.palette.name} unity=${withUnity}`);
    console.log(`  app  → ${path.relative(ROOT, path.join(dirs.app, 'index.html'))} (${app.length} b)`);
    console.log(`  game → ${path.relative(ROOT, path.join(dirs.game, 'index.html'))} (${game.length} b)`);
    return;
  }

  fs.mkdirSync(dirs.app, { recursive: true });
  fs.mkdirSync(dirs.game, { recursive: true });
  fs.writeFileSync(path.join(dirs.app, 'index.html'), app);
  fs.writeFileSync(path.join(dirs.game, 'index.html'), game);

  if (withUnity) {
    fs.mkdirSync(dirs.unity, { recursive: true });
    fs.writeFileSync(path.join(dirs.unity, 'GameMain.cs'), readTpl('unity-GameMain.cs.tpl').replaceAll('{{WORD}}', chosen.word));
    fs.writeFileSync(path.join(dirs.unity, 'README-UNITY.md'),
      `# ${chosen.word} — Unity scaffold (opt-in)\n\nImport \`GameMain.cs\` ke projek Unity **manual** (editor berlesen). `
      + `Jalur auto-harian ialah web (Phaser), BUKAN Unity — sebab Unity perlukan build berat + lesen yang tak sesuai untuk CI percuma tanpa membebankan server.\n`);
  }

  const idx = manifest.entries.findIndex((e) => e.slug === slug);
  if (idx >= 0) manifest.entries[idx] = entry; else manifest.entries.push(entry);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  fs.mkdirSync(PUB_ROOT, { recursive: true });
  fs.writeFileSync(path.join(PUB_ROOT, 'index.html'), hubHtml(manifest));

  console.log(`[satu-kata] OK "${chosen.word}" → ${slug}`);
  console.log(`  app : ${path.relative(ROOT, path.join(dirs.app, 'index.html'))}`);
  console.log(`  game: ${path.relative(ROOT, path.join(dirs.game, 'index.html'))}`);
  if (withUnity) console.log(`  unity: ${path.relative(ROOT, path.join(dirs.unity, 'GameMain.cs'))}`);
  console.log(`  hub : ${path.relative(ROOT, path.join(PUB_ROOT, 'index.html'))} (${manifest.entries.length} hasil)`);
}

main();
