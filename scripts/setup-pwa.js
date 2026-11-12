#!/usr/bin/env node
/**
 * setup-pwa.js — the "Install" layer (PWA) for every app in apk/catalog.json.
 * tukuk.org = an app store: every app can be installed (Add to Home Screen) as well as
 * downloaded as an APK. Chrome/Android need two things for the install prompt:
 *   (1) a linked manifest, (2) a registered service worker covering the start_url.
 *
 * Steps (idempotent — safe to re-run, already-complete apps such as chat are skipped):
 *   a. Rasterize public/icons/apps/<slug>.svg → PNG 192 & 512 (when missing).
 *   b. Write public/manifest-<slug>.json (start_url /apps/<slug>, scope /apps/).
 *   c. Inject into public/apps/<slug>.html: <link rel="manifest"> + register /sw.js.
 *
 * Usage: node scripts/setup-pwa.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'apk', 'catalog.json'), 'utf8')).apps;
const ICONS = path.join(ROOT, 'public', 'icons', 'apps');
const APPS = path.join(ROOT, 'public', 'apps');

const shortOf = (slug, label) => {
  const s = label.replace(/^Tukuk\s+/i, '').replace(/\s+Beta$/i, '').trim();
  return (s || slug).slice(0, 12);
};

(async () => {
  let icons = 0, man = 0, inj = 0;
  for (const a of CAT) {
    // (a) PNG icons 192/512
    const svg = path.join(ICONS, `${a.slug}.svg`);
    const p192 = path.join(ICONS, `${a.slug}-192.png`);
    const p512 = path.join(ICONS, `${a.slug}-512.png`);
    if (fs.existsSync(svg)) {
      for (const [out, sz] of [[p192, 192], [p512, 512]]) {
        if (!fs.existsSync(out)) {
          await sharp(svg, { density: 300 }).resize(sz, sz, { fit: 'contain', background: '#0f1115' }).png().toFile(out);
          icons++;
        }
      }
    }
    // (b) manifest JSON
    const manPath = path.join(ROOT, 'public', `manifest-${a.slug}.json`);
    if (fs.existsSync(manPath)) { /* keep an existing hand-curated manifest (e.g. chat) */ }
    else {
    const manifest = {
      id: `/apps/${a.slug}`,
      name: a.label,
      short_name: shortOf(a.slug, a.label),
      description: `${a.label} — a Tukuk app that runs in your browser.`,
      start_url: `/apps/${a.slug}`,
      scope: '/apps/',
      display: 'standalone',
      background_color: '#0f1115',
      theme_color: '#1f6feb',
      icons: [
        { src: `/icons/apps/${a.slug}-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `/icons/apps/${a.slug}-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `/icons/apps/${a.slug}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n');
    man++;
    }

    // (c) inject the manifest link + SW registration into the app page (when missing)
    const page = path.join(APPS, `${a.slug}.html`);
    if (!fs.existsSync(page)) continue;
    let html = fs.readFileSync(page, 'utf8');
    const linkTag = `<link rel="manifest" href="/manifest-${a.slug}.json">`;
    if (!/rel="manifest"/.test(html)) {
      if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `  ${linkTag}\n</head>`);
      else html = `${linkTag}\n${html}`;
    }
    if (!/serviceWorker\.register/.test(html)) {
      const reg = `\n<script>if('serviceWorker' in navigator)addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{});});</script>\n`;
      if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${reg}</body>`);
      else html += reg;
    }
    fs.writeFileSync(page, html);
    inj++;
  }
  console.log(`setup-pwa: ${icons} PNG generated, ${man} manifests written, ${inj} pages injected with manifest+SW`);
})().catch(e => { console.error('setup-pwa FAILED:', e.message); process.exit(1); });
