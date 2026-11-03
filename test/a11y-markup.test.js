'use strict';
// The accessibility pass of 29 Oct 2026, guarded so it does not rot.
//
// axe-core 4.14.0 over /, /about, /privacy, /wiki, /contact and /os found 241 nodes:
//   107 link-in-text-block      prose links that only a colour told you were links
//   100 label-content-name-mismatch  ".read-more" said "Read article", its name said "Read <title>"
//    14 region                  the OS shell and the wiki topbar sat outside every landmark
//    13 color-contrast          --accent #1f6feb on #f7f8fa = 4.36:1, under the 4.5:1 floor
//     6 button-name / 1 label   the /os dock icons (their text is hidden under 900px), the slider
//
// The audit itself needs Chrome and axe-core, so it is not part of this suite: run
//   node scripts/a11y-audit.js https://tukuk.org/ https://tukuk.org/os …
// What is checked here is the part that can be checked without a browser — the markup
// invariants and the palette arithmetic that the fixes rest on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const OS = read('public/os.html');
const THEME = read('public/theme.css');
const PLAY = read('public/play.html');

// ── contrast arithmetic (WCAG 2.x, sRGB relative luminance) ──
function luminance(hex) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** --token values of the first rule whose selector is exactly `selector`. */
function cssVars(selector) {
  const m = THEME.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, `theme.css has no ${selector} block any more`);
  const vars = new Map();
  for (const v of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars.set(v[1], v[2].trim());
  return vars;
}

const LIGHT = cssVars(':root[data-theme="light"]');
/** The `--accent*` tokens of every rule whose selector matches `source` (a raw regex, already escaped). */
const accentRules = (source) => [...THEME.matchAll(new RegExp(`(${source})\\s*\\{([^}]*)\\}`, 'g'))]
  .map((m) => ({
    accent: m[1].match(/data-accent="(\w+)"/)[1],
    vars: new Map([...m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((v) => [v[1], v[2].trim()])),
  }));

test('every light-theme accent still reads as text on every light surface', () => {
  // The audit's 13 contrast failures all came from one token: --accent is the colour of every
  // prose link, and #1f6feb on #f7f8fa measures 4.36:1. A palette edit is the easiest way to
  // reintroduce that, so the arithmetic lives in the suite.
  const surfaces = ['bg', 'panel', 'card'].map((k) => [k, LIGHT.get(k)]);
  for (const s of surfaces) assert.ok(/^#[0-9a-f]{6}$/i.test(s[1]), `--${s[0]} is not a hex colour: ${s[1]}`);
  const accents = accentRules(':root\\[data-theme="light"\\]\\[data-accent="\\w+"\\]');
  assert.deepEqual(accents.map((a) => a.accent).sort(), ['amber', 'blue', 'green', 'rose', 'violet']);
  for (const { accent, vars } of accents) {
    for (const [name, colour] of surfaces) {
      const r = ratio(vars.get('accent'), colour);
      assert.ok(r >= 4.5, `light --accent for ${accent} is ${vars.get('accent')} on --${name} ${colour} = ${r.toFixed(2)}:1, under 4.5:1`);
    }
  }
});

test('white text on an accent fill clears 4.5:1 in both themes', () => {
  // Buttons and chips put #fff on --accent-fill. #4c8dff under white is 3.2:1, which is why
  // the fills are a separate, darker token.
  for (const { accent, vars } of accentRules(':root(?:\\[data-theme="light"\\])?\\[data-accent="\\w+"\\]')) {
    const fill = vars.get('accent-fill');
    assert.ok(fill, `${accent} has no --accent-fill`);
    const r = ratio(fill, '#ffffff');
    assert.ok(r >= 4.5, `white text on ${accent} fill ${fill} = ${r.toFixed(2)}:1, under 4.5:1`);
  }
});

test('dark-theme accents read on the dark background', () => {
  const dark = cssVars(':root[data-theme="dark"]');
  for (const { accent, vars } of accentRules(':root\\[data-accent="\\w+"\\]')) {
    const r = ratio(vars.get('accent'), dark.get('bg'));
    assert.ok(r >= 4.5, `dark --accent for ${accent} is ${vars.get('accent')} on ${dark.get('bg')} = ${r.toFixed(2)}:1`);
  }
});

test('prose links are distinguishable without colour (WCAG 1.4.1)', () => {
  // 107 nodes: a paragraph link was --accent and nothing else. Underline is the one affordance
  // that survives colour blindness, a grayscale print and forced-colours mode.
  const rule = THEME.match(/([^{}]*\bp a\b[^{}]*)\{[^}]*text-decoration:\s*underline[^}]*\}/);
  assert.ok(rule, 'the underline rule for prose links is gone — link-in-text-block comes back');
  for (const sel of ['p a', 'li a', 'footer a']) {
    assert.ok(rule[1].includes(sel), `${sel} is not underlined`);
  }
  // One level up: a link that names a section heading (/zoo's continent names). It only failed in
  // the dark theme, where the accent and the body ink are too close to tell apart by colour.
  assert.match(THEME, /\.section-title a\s*\{[^}]*text-decoration:\s*underline/, 'section-title links are colour-only again');
});

// ── markup invariants ──
function byId(html, id) {
  const m = html.match(new RegExp('<(\\w+)([^>]*\\bid="' + id + '"[^>]*)>'));
  assert.ok(m, `no element with id="${id}"`);
  return { tag: m[1].toLowerCase(), attrs: m[2] };
}
const IMPLICIT_ROLE = { header: 'banner', aside: 'complementary', footer: 'contentinfo', main: 'main', nav: 'navigation' };

test('the OS shell is built from landmarks', () => {
  // 11 region nodes on /os: the status bar, the shade, the lock screen, the toast stack and the
  // hint line all sat outside any landmark, so a screen reader's region list was empty.
  for (const [id, role] of [['status', 'banner'], ['shade', 'complementary'], ['home', 'main'], ['dock', 'navigation']]) {
    const el = byId(OS, id);
    const explicit = (el.attrs.match(/role="(\w+)"/) || [])[1];
    assert.equal(explicit || IMPLICIT_ROLE[el.tag], role, `#${id} is <${el.tag}>, which is not the ${role} landmark`);
  }
  // The lock screen is a <section> with a name (implicit region) and the hint line is the
  // shell's contentinfo; the toast stack has no element that implies a landmark, so it names one.
  const lock = byId(OS, 'lock');
  assert.equal(lock.tag, 'section', 'the lock screen is no longer a named <section>');
  assert.match(lock.attrs, /\baria-label="[^"]+"/, 'the lock screen region has no accessible name');
  assert.match(byId(OS, 'toasts').attrs, /\brole="region"/, '#toasts is not a region');
  assert.match(byId(OS, 'toasts').attrs, /\baria-label="[^"]+"/, '#toasts is a region with no accessible name');
  assert.match(byId(OS, 'toasts').attrs, /\baria-live="polite"/, 'toasts are inserted silently again');
  assert.match(OS, /<footer class="hint">/, 'the hint line left the contentinfo landmark');
});

test('the /os dock and its slider have accessible names', () => {
  // #dock .cell span{display:none} below 900px, so on a phone these six buttons were icon-only:
  // six "button" announcements with no name, and one unlabelled range input.
  const dock = OS.match(/<nav id="dock">([\s\S]*?)<\/nav>/);
  assert.ok(dock, 'the dock is gone');
  const buttons = [...dock[1].matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 6, `the dock has ${buttons.length} buttons`);
  for (const [, attrs, inner] of buttons) {
    const label = (attrs.match(/aria-label="([^"]+)"/) || [])[1];
    assert.ok(label, `a dock button has no aria-label: ${attrs.trim()}`);
    // WCAG 2.5.3: the visible text has to be part of the name, or voice control cannot say it.
    // The icon is a glyph in its own span, not a word.
    const visible = inner.replace(/<span class="ic">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim();
    if (visible) assert.ok(label.toLowerCase().includes(visible.toLowerCase()), `dock label "${label}" does not contain its visible text "${visible}"`);
  }
  assert.match(byId(OS, 'dimRange').attrs, /aria-label="[^"]+"/, 'the brightness slider has no accessible name');
});

test('the blog header is a banner and the home hero is inside a landmark', () => {
  // Both were reported as "region": the site header was a <div class="site-top">, and on the
  // home page the hero <section> was rendered before <main> opened.
  assert.ok(SERVER.includes('<header class="site-top">'), 'siteHeader no longer renders a <header>');
  assert.ok(!SERVER.includes('<div class="site-top">'), 'siteHeader still renders a <div class="site-top">');
  assert.match(SERVER, /<div class="wrap">\s*<main>\s*\$\{asHome/, 'the page body no longer opens <main> before the hero');
});

test('every "read more" link announces the article it opens', () => {
  // 100 label-content-name-mismatch nodes: the link read "Read article" on screen while its
  // accessible name was "Read <title>", so the two never agreed.
  const link = SERVER.match(/<a class="read-more"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(link, 'the read-more link is gone');
  const visible = link[2].replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.ok(visible, 'the read-more link has no visible text');
  assert.ok(link[1].includes(visible), `aria-label "${link[1]}" does not contain the visible text "${visible}"`);
  assert.match(link[2], /aria-hidden="true"/, 'the arrow is part of the name again');
});

test('no page hero is a second banner', () => {
  // The second wave of the audit (12 pages) all reported the same pair: landmark-no-duplicate-banner
  // and landmark-unique on .site-top. siteHeader() is the banner; every page that then rendered
  // its own <header><h1> outside <main> created a second one. A <header> inside <main> is not a
  // banner, so the rule is simply that the hero opens after <main>.
  // Every page that renders siteHeader() and then a hero must open <main> first: a <header> inside
  // <main> is not a banner, so the hero stops competing with the site header for that role.
  const opens = [...SERVER.matchAll(/\$\{siteHeader\(/g)];
  assert.ok(opens.length >= 15, `only ${opens.length} siteHeader call sites found`);
  for (const m of opens) {
    const tail = SERVER.slice(m.index, m.index + 1200);
    const mainAt = tail.search(/<main[\s>]/);
    const headerAt = tail.indexOf('<header');
    if (headerAt === -1) continue;
    assert.ok(mainAt !== -1 && mainAt < headerAt, `a page hero <header> precedes <main> after siteHeader at offset ${m.index}`);
  }
  assert.match(SERVER, /<div class="wrap">\s*<main><header><h1>\$\{o\.heroHtml/, 'the doc templates no longer open <main> before the hero');
});

test('the player carries its own palette and one main landmark', () => {
  // theme.css redefines --muted and --accent-glow under a higher-specificity :root[data-theme],
  // which left the "not found" text at 3.27:1 and its link at 1.13:1 on the player's fixed dark
  // background. The player therefore uses --pl-* names that no site theme can reach.
  assert.ok(!/var\(--muted\)/.test(PLAY), 'public/play.html reads the site --muted again');
  assert.ok(!/var\(--accent-glow\)/.test(PLAY), 'public/play.html reads the site --accent-glow again');
  assert.match(PLAY, /var\(--pl-muted\)/, 'the player lost its own muted colour');
  // region ×1 on #oops: the error panel was the only visible content and sat outside every
  // landmark, because the player is a full-viewport flex column with no <main> at all.
  assert.equal((PLAY.match(/<main[\s>]/g) || []).length, 1, 'the player must hold exactly one <main>');
  assert.match(PLAY, /<main class="player">[\s\S]*id="oops"[\s\S]*<\/main>/, '#oops is outside the player landmark again');
});

test('every literal chip and badge pair clears 4.5:1', () => {
  // 78 colour-contrast nodes in the second wave were all of two shapes: a status pill whose white
  // text sat on #e67e22 (2.85:1) / #2980b9 (4.31:1) / #2f9e63 (3.39:1), and /learn's CSS
  // hard-coding the dark palette's #9aa3b2 into a page that renders on #f7f8fa (2.39:1).
  const pairs = [...SERVER.matchAll(/background:(#[0-9a-f]{6});color:(#[0-9a-f]{6})/gi)];
  assert.ok(pairs.length >= 8, `only ${pairs.length} literal colour pairs found — the sweep stopped reading them`);
  for (const [, bg, fg] of pairs) {
    const r = ratio(bg, fg);
    assert.ok(r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}:1, under 4.5:1`);
  }
  // The AQI chips inherit --ink from .aqi-chip; only the deep maroon level needs white.
  const ink = '#0f1115';
  const chips = [...SERVER.matchAll(/\.aqi-chip\.(\w+)\{background:(#[0-9a-f]{3,6})(?:;color:(#[0-9a-f]{3,6}))?/gi)];
  assert.equal(chips.length, 6, `expected six AQI levels, found ${chips.length}`);
  for (const [, name, bg, fg] of chips) {
    const r = ratio(bg, fg || ink);
    assert.ok(r >= 4.5, `AQI chip ${name}: ${fg || ink} on ${bg} = ${r.toFixed(2)}:1`);
  }
  // /learn painted its prose with the dark theme's muted colour instead of the token.
  assert.ok(SERVER.includes('.stage-blurb{color:var(--muted'), '/learn hard-codes a palette colour again');
  assert.ok(SERVER.includes('.stage-list .ex{display:block;font-size:.88rem;color:var(--muted'), '/learn hard-codes a palette colour again');
  // The magnitude chips put white on the ladder, so it is checked colour by colour.
  const ladder = SERVER.match(/const bg = m >= 6 \? '(#[0-9a-f]{6})' : m >= 5 \? '(#[0-9a-f]{6})' : m >= 4 \? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})'/i);
  assert.ok(ladder, 'the magnitude severity ladder is gone');
  for (const hex of ladder.slice(1)) {
    const r = ratio(hex, '#ffffff');
    assert.ok(r >= 4.5, `white on magnitude ${hex} = ${r.toFixed(2)}:1`);
  }
});

test('the hidden attribute still hides things', () => {
  // /play/<id> showed the "not found" panel underneath a working game: .oops{display:grid}
  // outranks the UA rule for [hidden]. The page needs its own guard.
  assert.match(PLAY, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, 'public/play.html lost its [hidden] override');
});

// ── third wave: the templates beyond the hubs ──
// axe over ~90 real pages found six classes of defect left: an ad unit outside <main>, two 404
// bodies and /games with no <main> at all, h1 → h3 skips where a grid of cards followed the hero,
// an empty <th>, a colour-only link in the wiki credit line, and text faded with opacity onto the
// periodic table's category colours.

test('every card grid whose cards open with an h3 sits under an h2', () => {
  // heading-order on /art, /life, /academy/<track>, /study, /air-quality, /countries/<region>,
  // /maps, /books/<shelf>, /recipes/<shelf> and /technology: the hero is an h1, the cards are h3,
  // and nothing in between. A section heading is the fix that keeps the outline honest.
  const grids = [...SERVER.matchAll(/<div class="(world|akad)-grid">\$\{/g)];
  assert.ok(grids.length >= 5, `only ${grids.length} card grids found — the sweep stopped reading them`);
  for (const m of grids) {
    const before = SERVER.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /<h2[ >]/, `the ${m[1]}-grid at offset ${m.index} has no <h2> above it`);
  }
  // The tech feeds list tkRow()s, which open with an h3, the same way.
  assert.ok(SERVER.includes('<h2 class="section-title">Right now, ranked by the community</h2>'), '/technology lost its heading above the story list');
  assert.ok(SERVER.includes('<h2 class="section-title">The stories in this feed</h2>'), '/technology/<feed> lost its heading above the story list');
});

test('the sports accents follow the theme instead of failing on white', () => {
  // #22c55e measured 2.28:1 and #f59e0b 2.14:1 on the white light-theme card. No single colour
  // clears both surfaces: 4.5:1 on white needs a relative luminance at or below .183, the #171a21
  // panel needs at or above .200. So each accent is a pair of theme-scoped tokens.
  // (FBALL went with the /football section, Nov 2026 — cricket is the last themed grid left.)
  for (const [block, name, dark, light] of [['CK', 'ck-ink', '#f59e0b', '#b45309']]) {
    const css = SERVER.match(new RegExp('const ' + block + '_CSS = `([\\s\\S]*?)`;'));
    assert.ok(css, `${block}_CSS is gone`);
    assert.ok(SERVER.includes(`:root{--${name}:${dark}}`), `--${name} lost its dark-theme value`);
    assert.ok(SERVER.includes(`:root[data-theme="light"]{--${name}:${light}}`), `--${name} lost its light-theme value`);
    assert.ok(!/color:#(22c55e|f59e0b)/.test(css[1]), `${block}_CSS hard-codes an accent colour again`);
    for (const [surface, bg, hex] of [['light card', '#ffffff', light], ['light page', '#f7f8fa', light], ['dark panel', '#171a21', dark]]) {
      const r = ratio(hex, bg);
      assert.ok(r >= 4.5, `${hex} on the ${surface} ${bg} = ${r.toFixed(2)}:1, under 4.5:1`);
    }
  }
});

test('the last bare page bodies carry a main landmark', () => {
  // landmark-one-main plus three region nodes on each: /play/<id> and /games/<key> replied with a
  // <body> of loose <h1>/<p>, and /games put its hero, chips and grid outside <main> as well.
  assert.equal((SERVER.match(/<body><main><h1>404<\/h1>/g) || []).length, 2, 'a 404 body is outside every landmark again');
  assert.match(SERVER, /<div class="gwrap"><main><section class="ghero">/, '/games left its cards outside <main>');
  // One ad unit sat after </main> on /learn, which is what made it a region rather than content.
  assert.match(SERVER, /\$\{adUnitGuarded\(config\.adsense\.slotBottom, 'bottom'\)\}\s*<\/main>/, 'a bottom ad unit is outside <main> again');
});

test('the books table labels its cover column for screen readers', () => {
  // empty-table-header on /books/<shelf>: the cover column's <th></th> was announced as nothing.
  assert.ok(SERVER.includes('<th><span class="bk-sr">Cover</span></th>'), 'the cover column header is empty again');
  assert.match(SERVER, /\.bk-sr\{[^}]*position:absolute/, 'the visually-hidden label lost its clipping');
});

test('white text sits on the fill token, never on the link token', () => {
  // --accent is the colour text is *read* in; in the dark theme it is #4c8dff, which is 3.2:1
  // under white. Every filled control (submit buttons, step counters, selected tabs) has to read
  // --accent-fill — axe found the /contact and /traffic buttons only because they were on screen.
  for (const [name, css] of [['src/server.js', SERVER], ['public/static-pages.css', read('public/static-pages.css')]]) {
    const bad = [...css.matchAll(/background:var\(--accent,[^)]*\)[^}]*color:#fff/gi)];
    assert.equal(bad.length, 0, `${name}: ${bad.length} filled controls read --accent instead of --accent-fill`);
  }
});

test('the wiki credit link, and the periodic tiles, keep their contrast', () => {
  // link-in-text-block on .wiki-from, and 54 color-contrast nodes where .num/.nm/.b-meta were
  // faded with opacity onto the category colour — 3.57:1 and 4.1:1 measured, 4.5 wanted.
  assert.match(SERVER, /\.wiki-from a\{text-decoration:underline\}/, 'the wiki credit link is colour-only again');
  assert.ok(!/\.el-tile \.(num|nm)\{[^}]*opacity/.test(SERVER), 'a periodic-table label is faded with opacity again');
  assert.ok(!/\.el-hero \.el-big \.b-meta\{[^}]*opacity/.test(SERVER), 'the element hero meta line is faded again');
});
