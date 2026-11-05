// ═══ Tests: the calculator/generator pages added to /alat (Oct 2026) ═══
// These pages are SSR strings with inline client logic, so the contract worth
// testing is the one a visitor (or a crawler) actually sees: 200, real HTML,
// the right title/JSON-LD, the interactive control IDs the script binds to,
// and — the classic SSR regression — no literal "undefined" leaking into markup.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const CATS = require('../src/tool-categories');
const toolbox = require('../src/toolbox');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const PAGES = [
  { path: '/alat/percentage', marker: 'Percentage Calculator', ids: ['p-mode', 'p-x', 'p-y', 'p-go', 'p-out'] },
  { path: '/alat/loan', marker: 'Loan &amp; Interest Calculator', ids: ['l-p', 'l-go', 'l-out', 'c-p', 'c-go', 'c-out'] },
  { path: '/alat/qr', marker: 'QR Code Generator', ids: ['q-text', 'q-ec', 'q-size', 'q-cv', 'q-dl', 'q-mode', 'q-ssid'] },
  { path: '/alat/ip', marker: 'What Is My IP?', ids: ['i-out', 'i-copy'] },
  { path: '/alat/epoch', marker: 'Unix Timestamp Converter', ids: ['e-now', 'e-in', 'e-unit', 'e-go', 'e-local', 'e-back', 'e-zones'] },
  { path: '/alat/random', marker: 'Random Number, Dice &amp; List Picker', ids: ['r-min', 'r-go', 'r-out', 'd-sides', 'd-go', 'l-items', 'l-go'] },
  { path: '/alat/pdf', marker: 'PDF Tools', ids: ['d-files', 'd-mode', 'd-range', 'd-rot', 'd-go', 'd-dl', 'd-out', 'd-list'] },
  { path: '/alat/json', marker: 'JSON Formatter &amp; Validator', ids: ['j-ind', 'j-fmt', 'j-min', 'j-val', 'j-sort', 'j-copy', 'j-in', 'j-status', 'j-out'] },
  { path: '/alat/hash', marker: 'Checksum &amp; Hash Generator', ids: ['h-text', 'h-file', 'h-clear', 'h-meta', 'h-tab'] },
  { path: '/alat/base64', marker: 'Base64 Encoder &amp; Decoder', ids: ['b-in', 'b-variant', 'b-enc', 'b-dec', 'b-copy', 'b-out', 'b-file', 'b-finfo', 'b-fileout'] },
  { path: '/alat/timezone', marker: 'Time Zone Meeting Planner', ids: ['z-date', 'z-base', 'z-add', 'z-do', 'z-chips', 'z-best', 'z-tab'] },
  { path: '/alat/uuid', marker: 'UUID Generator', ids: ['u-count', 'u-ver', 'u-up', 'u-go', 'u-out', 'u-copy', 'u-in', 'u-dec'] },
  { path: '/alat/cron', marker: 'Cron Expression Explainer', ids: ['c-in', 'c-go', 'c-pre', 'c-out', 'c-fields', 'c-next'] },
  { path: '/alat/regex', marker: 'Regex Tester', ids: ['rx-pat', 'rx-flags', 'rx-text', 'rx-out', 'rx-tab', 'rx-pres'] },
  { path: '/alat/csv', marker: 'CSV Viewer', ids: ['csv-del', 'csv-hdr', 'csv-in', 'csv-info', 'csv-tab', 'csv-json', 'csv-tj', 'csv-cj', 'csv-dl'] },
  { path: '/alat/diff', marker: 'Text Diff', ids: ['df-a', 'df-b', 'df-mode', 'df-go', 'df-stats', 'df-out'] },
  { path: '/alat/url', marker: 'URL Parser', ids: ['up-url', 'up-parse', 'up-tab', 'up-comp', 'up-enc', 'up-dec', 'up-out'] },
  { path: '/alat/char', marker: 'Unicode Reference', ids: ['ch-in', 'ch-tab', 'ch-ref'] },
  { path: '/alat/convert', marker: 'Image Converter', ids: ['iv-file', 'iv-drop', 'iv-info', 'iv-fmt', 'iv-w', 'iv-h', 'iv-lock', 'iv-q', 'iv-bg', 'iv-go', 'iv-out', 'iv-dl'] },
  { path: '/alat/image-to-pdf', marker: 'Images to PDF', ids: ['ip-files', 'ip-page', 'ip-orient', 'ip-margin', 'ip-go', 'ip-out', 'ip-dl', 'ip-list'] },
  // ── second wave (Nov 2026, src/toolbox.js) — the registry renders all six
  // integration points from one object per tool; these entries pin that the
  // pages actually answer before a visitor finds out they do not.
  { path: '/alat/base', marker: 'Base Converter', ids: ['bc-in', 'bc-rad', 'bc-custom', 'bc-go', 'bc-out'] },
  { path: '/alat/binary', marker: 'Text \u2194 Binary', ids: ['bt-in', 'bt-mode', 'bt-kind', 'bt-go', 'bt-out'] },
  { path: '/alat/prime', marker: 'Prime Checker', ids: ['pr-n', 'pr-go', 'pr-out'] },
  { path: '/alat/fraction', marker: 'Fraction Calculator', ids: ['fr-a', 'fr-op', 'fr-b', 'fr-go', 'fr-out'] },
  { path: '/alat/stats', marker: 'Statistics Calculator', ids: ['st-data', 'st-go', 'st-out'] },
  { path: '/alat/salary', marker: 'Salary Converter', ids: ['sa-amt', 'sa-per', 'sa-hrs', 'sa-wks', 'sa-go', 'sa-out'] },
  { path: '/alat/tip', marker: 'Tip &amp; Bill Split', ids: ['tp-bill', 'tp-pct', 'tp-split', 'tp-go', 'tp-out'] },
  { path: '/alat/discount', marker: 'Discount Calculator', ids: ['dc-price', 'dc-off', 'dc-extra', 'dc-go', 'dc-out'] },
  { path: '/alat/countdown', marker: 'Countdown', ids: ['cd-name', 'cd-date', 'cd-time', 'cd-go', 'cd-out'] },
  { path: '/alat/grade', marker: 'Grade Calculator', ids: ['gr-cur', 'gr-goal', 'gr-wt', 'gr-go', 'gr-out'] },
  { path: '/alat/entity', marker: 'HTML Entities', ids: ['en-in', 'en-all', 'en-enc', 'en-dec', 'en-copy', 'en-out'] },
  { path: '/alat/jwt', marker: 'JWT Decoder', ids: ['jw-tok', 'jw-go', 'jw-head', 'jw-claims'] },
  // ── third wave (Nov 2026 batch 2) ──
  { path: '/alat/roman', marker: 'Roman Numerals', ids: ['rm-mode', 'rm-in', 'rm-go', 'rm-out'] },
  { path: '/alat/number-to-words', marker: 'Number to Words', ids: ['nw-in', 'nw-mode', 'nw-go', 'nw-out'] },
  { path: '/alat/duration', marker: 'Duration Converter', ids: ['du-in', 'du-unit', 'du-go', 'du-out'] },
  { path: '/alat/validate', marker: 'Check Digit Validator', ids: ['va-kind', 'va-in', 'va-go', 'va-out'] },
  { path: '/alat/unitprice', marker: 'Unit Price Comparison', ids: ['up-unit', 'up-ap', 'up-aq', 'up-bp', 'up-bq', 'up-go', 'up-out'] },
  { path: '/alat/fuel', marker: 'Fuel Economy', ids: ['fu-km', 'fu-l', 'fu-p', 'fu-go', 'fu-out'] },
  { path: '/alat/sleep', marker: 'Sleep-Cycle Calculator', ids: ['sl-mode', 'sl-time', 'sl-go', 'sl-out'] },
  { path: '/alat/lorem', marker: 'Lorem Ipsum Generator', ids: ['lo-n', 'lo-classic', 'lo-go', 'lo-out'] },
  { path: '/alat/aspect', marker: 'Aspect Ratio Calculator', ids: ['as-w', 'as-h', 'as-fw', 'as-fh', 'as-go', 'as-out'] },
  { path: '/alat/cssunits', marker: 'CSS Unit Converter', ids: ['cu-v', 'cu-u', 'cu-r', 'cu-go', 'cu-out'] },
  { path: '/alat/dice', marker: 'Dice Probability', ids: ['di-n', 'di-s', 'di-t', 'di-go', 'di-out'] },
  { path: '/alat/download', marker: 'Download Time Calculator', ids: ['dn-size', 'dn-sz', 'dn-rate', 'dn-rt', 'dn-go', 'dn-out'] },
  // ── fourth wave (Nov 2026 batch 3 + design studio) ──
  { path: '/alat/comb', marker: 'Combination Calculator', ids: ['cb-n', 'cb-r', 'cb-go', 'cb-out'] },
  { path: '/alat/gcd', marker: 'GCD &amp; LCM', ids: ['gd-a', 'gd-b', 'gd-go', 'gd-out'] },
  { path: '/alat/triangle', marker: 'Triangle Solver', ids: ['tr-mode', 'tr-a', 'tr-b', 'tr-c', 'tr-ang', 'tr-go', 'tr-out'] },
  { path: '/alat/readability', marker: 'Readability Checker', ids: ['rb-in', 'rb-go', 'rb-out'] },
  { path: '/alat/tdee', marker: 'Calorie &amp; TDEE Calculator', ids: ['td-sex', 'td-age', 'td-h', 'td-w', 'td-act', 'td-go', 'td-out'] },
  { path: '/alat/inflate', marker: 'Inflation Calculator', ids: ['xf-amt', 'xf-rate', 'xf-yrs', 'xf-mode', 'xf-go', 'xf-out'] },
  { path: '/alat/cipher', marker: 'Caesar &amp; Vigenère Cipher', ids: ['cp-text', 'cp-kind', 'cp-key', 'cp-dir', 'cp-go', 'cp-out'] },
  { path: '/alat/paint', marker: 'Paint Coverage Calculator', ids: ['pt-l', 'pt-w', 'pt-h', 'pt-open', 'pt-cov', 'pt-cost', 'pt-go', 'pt-out'] },
  { path: '/alat/recipe', marker: 'Recipe Scaler', ids: ['rc-in', 'rc-from', 'rc-to', 'rc-go', 'rc-out'] },
  { path: '/alat/printsize', marker: 'Print Size Calculator', ids: ['py-w', 'py-h', 'py-dpi', 'py-go', 'py-out'] },
  { path: '/alat/electricity', marker: 'Electricity Cost Calculator', ids: ['el-w', 'el-hrs', 'el-days', 'el-tar', 'el-go', 'el-out'] },
  { path: '/alat/pace', marker: 'Running Pace Calculator', ids: ['pc-dist', 'pc-h', 'pc-m', 'pc-s', 'pc-go', 'pc-out'] },
  { path: '/alat/design', marker: 'Design Studio', ids: ['ds-size', 'ds-canvas', 'ds-tpl', 'ds-undo', 'ds-redo', 'ds-addtext', 'ds-addcircle', 'ds-addstar', 'ds-layers', 'ds-snap', 'ds-guides', 'ds-save', 'ds-open', 'ds-restore', 'ds-del', 'ds-fmt', 'ds-scale', 'ds-dl', 'ds-out', 'ds-emo', 'ds-addsticker', 'ds-lock', 'ds-fliph', 'ds-flipv', 'ds-al-c', 'ds-clip'] },
  // ── fifth wave (Nov 2026 batch 4) ──
  { path: '/alat/water', marker: 'Water Target', ids: ['wa-kg', 'wa-ex', 'wa-cl', 'wa-pg', 'wa-hrs', 'wa-go', 'wa-out'] },
  { path: '/alat/compound', marker: 'Compound Interest', ids: ['ci-p', 'ci-c', 'ci-r', 'ci-f', 'ci-t', 'ci-go', 'ci-out'] },
  { path: '/alat/tax', marker: 'Tax Add &amp; Remove', ids: ['tx-mode', 'tx-amt', 'tx-rate', 'tx-go', 'tx-out'] },
  { path: '/alat/breath', marker: 'Breathing Pacer', ids: ['bp-pat', 'bp-cy', 'bp-go', 'bp-rs', 'bp-ring', 'bp-out'] },
  { path: '/alat/morse', marker: 'Morse Translator', ids: ['mo-mode', 'mo-wpm', 'mo-in', 'mo-go', 'mo-play', 'mo-out'] },
  { path: '/alat/phonetic', marker: 'Phonetic Alphabet', ids: ['ph-mode', 'ph-in', 'ph-go', 'ph-out'] },
  { path: '/alat/week', marker: 'Week Number', ids: ['wk-mode', 'wk-date', 'wk-year', 'wk-n', 'wk-go', 'wk-out'] },
  { path: '/alat/markdown', marker: 'Markdown \u2192 HTML', ids: ['mk-in', 'mk-go', 'mk-copy', 'mk-prev', 'mk-out'] },
  { path: '/alat/case', marker: 'Case Converter', ids: ['cs-in', 'cs-go', 'cs-out'] },
  { path: '/alat/coords', marker: 'Coordinate Distance', ids: ['hv-a1', 'hv-o1', 'hv-a2', 'hv-o2', 'hv-go', 'hv-swap', 'hv-out'] },
  { path: '/alat/month-grid', marker: 'Calendar Grid', ids: ['ca-m', 'ca-y', 'ca-s', 'ca-go', 'ca-print', 'ca-out'] },
  { path: '/alat/typing', marker: 'Typing Speed Test', ids: ['ty-words', 'ty-type', 'ty-dur', 'ty-start', 'ty-out'] },
  // ── sixth wave (Nov 2026 batch 5) ──
  { path: '/alat/gpa', marker: 'GPA Calculator', ids: ['gp-in', 'gp-goal', 'gp-go', 'gp-out'] },
  { path: '/alat/shoe', marker: 'Shoe Size Converter', ids: ['sh-mode', 'sh-v', 'sh-go', 'sh-out'] },
  { path: '/alat/screen', marker: 'Screen & PPI', ids: ['sc-da', 'sc-ra', 'sc-db', 'sc-rb', 'sc-go', 'sc-out'] },
  { path: '/alat/metronome', marker: 'Metronome', ids: ['mt-bpm', 'mt-beats', 'mt-go', 'mt-tap', 'mt-out'] },
  { path: '/alat/stopwatch', marker: 'Stopwatch & Laps', ids: ['sw-time', 'sw-go', 'sw-lap', 'sw-rs', 'sw-out'] },
  { path: '/alat/blood-type', marker: 'Blood Type Punnett', ids: ['bd-p1', 'bd-p2', 'bd-out'] },
  { path: '/alat/dna', marker: 'DNA Translator', ids: ['dn-in', 'dn-go', 'dn-out'] },
  { path: '/alat/subnet', marker: 'Subnet Calculator', ids: ['su-in', 'su-go', 'su-out'] },
  { path: '/alat/heartrate', marker: 'HR Zones', ids: ['hz-age', 'hz-rest', 'hz-out'] },
  { path: '/alat/caffeine', marker: 'Caffeine Decay', ids: ['cf-mg', 'cf-at', 'cf-hl', 'cf-go', 'cf-out'] },
  { path: '/alat/moon', marker: 'Moon Phase', ids: ['mn-d', 'mn-go', 'mn-out'] },
  { path: '/alat/easter', marker: 'Easter Date', ids: ['ep-y', 'ep-go', 'ep-out'] },
  // ── seventh wave (Nov 2026 batch 6 — the hundredth tool) ──
  { path: '/alat/weekday', marker: 'Weekday Finder', ids: ['wd-d', 'wd-n', 'wd-hunt', 'wd-go', 'wd-out'] },
  { path: '/alat/time-diff', marker: 'Days Between', ids: ['tf-a', 'tf-b', 'tf-conv', 'tf-go', 'tf-out'] },
  { path: '/alat/unit-prefix', marker: 'KB vs KiB', ids: ['up-u', 'up-v', 'up-mbps', 'up-go', 'up-out'] },
  { path: '/alat/pwstrength', marker: 'Password Entropy', ids: ['ps-in', 'ps-go', 'ps-out'] },
  { path: '/alat/repeating', marker: 'Repeating Decimal', ids: ['rp-a', 'rp-b', 'rp-go', 'rp-out'] },
  { path: '/alat/kbd', marker: 'Keyboard Test', ids: ['kb-rs', 'kb-grid', 'kb-out'] },
  { path: '/alat/pomodoro', marker: 'Pomodoro Timer', ids: ['pm-clock', 'pm-work', 'pm-short', 'pm-long', 'pm-cycle', 'pm-go', 'pm-rs', 'pm-out'] },
  { path: '/alat/reading-time', marker: 'Reading Time', ids: ['rt-in', 'rt-wpm', 'rt-out'] },
  { path: '/alat/ean13', marker: 'EAN-13 Barcode', ids: ['ea-in', 'ea-go', 'ea-rnd', 'ea-cv', 'ea-out'] },
  { path: '/alat/slug', marker: 'Slug Generator', ids: ['sl-in', 'sl-sep', 'sl-max', 'sl-copy', 'sl-out'] },
  // ── eighth wave (Nov 2026 — learning tools batch) ──
  { path: '/alat/flashcards', marker: 'Flashcards', ids: ['fc-in', 'fc-go', 'fc-reveal', 'fc-next', 'fc-shuffle', 'fc-know', 'fc-later', 'fc-out'] },
  { path: '/alat/quiz-maker', marker: 'Quiz Maker', ids: ['qz-in', 'qz-go', 'qz-a0', 'qz-a1', 'qz-a2', 'qz-a3', 'qz-next', 'qz-fb', 'qz-out'] },
  { path: '/alat/times-tables', marker: 'Times Tables Trainer', ids: ['tt-tab', 'tt-len', 'tt-q', 'tt-ans', 'tt-go', 'tt-new', 'tt-out'] },
  { path: '/alat/clock-reading', marker: 'Clock Reading', ids: ['cr-lv', 'cr-face', 'cr-ans', 'cr-go', 'cr-new', 'cr-out'] },
  { path: '/alat/periodic-table', marker: 'Periodic Table Explorer', ids: ['el-q', 'el-rand', 'el-all', 'el-out'] },
  { path: '/alat/flags-quiz', marker: 'Flags Quiz', ids: ['fl-mode', 'fl-go', 'fl-a0', 'fl-a1', 'fl-a2', 'fl-a3', 'fl-out'] },
  { path: '/alat/word-scramble', marker: 'Word Scramble', ids: ['ws-cat', 'ws-ans', 'ws-go', 'ws-hint', 'ws-new', 'ws-out'] },
  { path: '/alat/worksheet', marker: 'Worksheet Generator', ids: ['wh-op', 'wh-lv', 'wh-n', 'wh-go', 'wh-key', 'wh-print', 'wh-out'] },
  { path: '/alat/spelling', marker: 'Spelling Practice', ids: ['sp-lv', 'sp-line', 'sp-in', 'sp-check', 'sp-say', 'sp-hint', 'sp-new', 'sp-out'] },
  { path: '/alat/solar-system', marker: 'Solar System Explorer', ids: ['so-p', 'so-out'] },
  { path: '/alat/study-planner', marker: 'Study Planner', ids: ['pl-exam', 'pl-hrs', 'pl-go', 'pl-out'] },
  { path: '/alat/word-guess', marker: 'Word Guess', ids: ['wg-cat', 'wg-a', 'wg-z', 'wg-new', 'wg-out'] },
  // ── ninth wave (Nov 2026 — study aids batch) ──
  { path: '/alat/citation-maker', marker: 'Citation Maker', ids: ['ct-type', 'ct-style', 'ct-authors', 'ct-year', 'ct-title', 'ct-pub', 'ct-url', 'ct-go', 'ct-out'] },
  { path: '/alat/summarizer', marker: 'Text Summarizer', ids: ['sm-in', 'sm-len', 'sm-go', 'sm-out'] },
  { path: '/alat/typing-test', marker: 'Typing Speed Test', ids: ['ty-text', 'ty-in', 'ty-new', 'ty-out'] },
  { path: '/alat/essay-planner', marker: 'Essay Planner', ids: ['es-topic', 'es-type', 'es-points', 'es-go', 'es-out'] },
  { path: '/alat/cloze-test', marker: 'Cloze Test Maker', ids: ['cl-in', 'cl-mode', 'cl-n', 'cl-go', 'cl-key', 'cl-out'] },
  { path: '/alat/cornell-notes', marker: 'Cornell Notes Page', ids: ['cn-topic', 'cn-src', 'cn-lines', 'cn-go', 'cn-print', 'cn-out'] },
  { path: '/alat/memory-kit', marker: 'Memory Kit', ids: ['mk-list', 'mk-num', 'mk-go', 'mk-out'] },
  { path: '/alat/reading-pace', marker: 'Reading Pace Calculator', ids: ['rg-tot', 'rg-done', 'rg-days', 'rg-go', 'rg-out'] },
  { path: '/alat/assignment-planner', marker: 'Assignment Prioritiser', ids: ['as-in', 'as-go', 'as-out'] },
  { path: '/alat/mind-map', marker: 'Mind Map Builder', ids: ['mm-topic', 'mm-branches', 'mm-go', 'mm-out'] },
  { path: '/alat/weekly-plan', marker: 'Weekly Study Grid', ids: ['tw-in', 'tw-days', 'tw-go', 'tw-out'] },
  { path: '/alat/study-log', marker: 'Study Log', ids: ['sl-in', 'sl-go', 'sl-out'] }
];

for (const page of PAGES) {
  test(`GET ${page.path} renders a complete page`, async () => {
    const res = await fetch(base + page.path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.ok(html.includes(page.marker), 'hero title must be present');
    for (const id of page.ids) {
      assert.ok(html.includes(`id="${id}"`), `missing control #${id}`);
    }
    assert.ok(html.includes('"@type":"WebApplication"'), 'WebApplication JSON-LD expected');
    assert.ok(html.includes('href="/alat"'), 'must link back to the tools hub');
    assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined in rendered markup');
  });
}

// The hub is no longer a wall of a thousand chips, and a tool page no longer advertises
// every tool ever written: the hub indexes twelve shelves plus the classics, everything
// else is reached through the paginated /alat/all, and the sitemap is split the same way.
// These three tests are the contract that keeps that structure honest — nothing here
// asserts a page count, only that the links a crawler needs are actually present.
test('the hub links every shelf, and walking /alat/all reaches every tool', async () => {
  const hub = await (await fetch(base + '/alat')).text();
  for (const c of CATS.CATEGORIES) {
    assert.ok(hub.includes(`href="/alat/c/${c.id}"`), `the hub does not link the ${c.id} shelf`);
  }
  assert.ok(hub.includes('href="/alat/all"'), 'the hub must link the complete list');
  // Walk the list page by page. The walk has to terminate on its own (a missing last page
  // would quietly orphan the tail of the registry) and inside a sane number of hops.
  const seen = new Set();
  let page = 0;
  for (; page < 40; page += 1) {
    const html = await (await fetch(`${base}/alat/all?page=${page + 1}`)).text();
    for (const m of html.matchAll(/href="(\/alat\/[a-z0-9-]+)"/g)) seen.add(m[1]);
    if (!html.includes('rel="next"')) break;
  }
  assert.ok(page < 40, 'the /alat/all walk never ended — pagination is looping');
  for (const p of PAGES) assert.ok(seen.has(p.path), `/alat/all never lists ${p.path}`);
  const regFound = toolbox.TOOLKIT.filter((t) => seen.has(`/alat/${t.slug}`)).length;
  assert.equal(regFound, toolbox.TOOLKIT.length, 'every registry tool must be listed exactly once in the walk');
});

test('a tool page ships a bounded chip row instead of the whole registry', async () => {
  // One curated hand-written page and one registry page: they get the nav from different
  // call sites, so both shapes have to stay small.
  for (const path of ['/alat/percentage', '/alat/distance-lagos-abuja']) {
    const html = await (await fetch(base + path)).text();
    const nav = html.match(/<nav aria-label="Everyday Tools[\s\S]*?<\/nav>/);
    assert.ok(nav, `${path}: the tools nav is missing`);
    const chips = (nav[0].match(/class="tl-chip/g) || []).length;
    assert.ok(chips > 1 && chips <= 20, `${path}: ${chips} nav chips — the row is meant to be bounded`);
    assert.ok(nav[0].includes('href="/alat"'), `${path}: the nav must lead back to the hub`);
    assert.ok(nav[0].includes('href="/alat/c/'), `${path}: the nav must link shelves, not just the hub`);
  }
});

test('the cluster sitemap lists every tool and the master sitemap lists the shelves', async () => {
  const alat = await (await fetch(base + '/sitemap-alat.xml')).text();
  // The <loc> host is the canonical tukuk.org in both files, so paths alone are enough.
  const listed = new Set([...alat.matchAll(/<loc>https:\/\/tukuk\.org(\/[^<]*)<\/loc>/g)].map((m) => m[1]));
  for (const page of PAGES) {
    assert.ok(listed.has(page.path), `sitemap-alat.xml misses ${page.path}`);
  }
  for (const t of toolbox.TOOLKIT) {
    assert.ok(listed.has(`/alat/${t.slug}`), `sitemap-alat.xml misses the registry tool ${t.slug}`);
  }
  const master = await (await fetch(base + '/sitemap.xml')).text();
  assert.ok(master.includes('/alat</loc>'), 'the master sitemap must carry the hub');
  assert.ok(master.includes('/alat/all</loc>'), 'the master sitemap must carry the complete list');
  for (const c of CATS.CATEGORIES) {
    assert.ok(master.includes(`/alat/c/${c.id}</loc>`), `the master sitemap misses the ${c.id} shelf`);
  }
  const alatLinks = (master.match(/<loc>[^<]*\/alat[^<]*<\/loc>/g) || []).length;
  assert.ok(alatLinks <= 20, `the master sitemap carries ${alatLinks} /alat URLs — the thousand-tool list belongs in sitemap-alat.xml`);
});

// A tool is only as good as the code it loads. The PDF page is the first one in the
// cluster that depends on a vendored binary-sized library, so its presence is part of
// the page's contract — a missing lib turns a working page into a silent dead form.
test('vendored PDF and ZIP libraries are served from our own host', async () => {
  for (const [path, minBytes] of [['/libs/pdf-lib.min.js', 400000], ['/libs/fflate.min.js', 20000]]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, `${path} must be served`);
    const body = await res.arrayBuffer();
    assert.ok(body.byteLength >= minBytes, `${path} looks truncated (${body.byteLength} bytes)`);
  }
});

// The report-only policy is the site's own measuring stick: every host a page embeds
// has to be allowed by the directive that governs it, or each view produces a violation
// report that says nothing new (production was emitting ~330 per 6 hours from exactly this
// drift). Checked per directive, not against the header as one string: unpkg serves the
// globe textures (img-src), it does not serve a script or a stylesheet, and a string search
// cannot tell those apart.
test('report-only CSP covers the third parties the pages embed', async () => {
  const res = await fetch(base + '/alat/percentage');
  const reportOnly = res.headers.get('content-security-policy-report-only') || '';
  const directives = new Map();
  for (const part of reportOnly.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  const allows = (directive, host) => (directives.get(directive) || []).some((s) =>
    s === host || s === 'https:' || (s.startsWith('https://*.') && host.endsWith(s.slice(9))));
  for (const [host, directive] of [
    ['https://googleads.g.doubleclick.net', 'frame-src'],
    ['https://www.google.com', 'frame-src'],
    ['https://www.clarity.ms', 'script-src'],
    ['https://static.cloudflareinsights.com', 'script-src'],
    ['https://unpkg.com', 'img-src'] // the three-globe earth textures
  ]) {
    assert.ok(allows(directive, host), `${host} is not allowed by ${directive} in the report-only CSP`);
  }
  // The enforced policy stays structural (no script-src) — that part is deliberate.
  const enforced = res.headers.get('content-security-policy') || '';
  assert.match(enforced, /object-src 'none'/);
  assert.ok(!enforced.includes('script-src'), 'script-src must not be enforced on interactive pages');
});

// The shared polish layer (Nov 2026): every tool page draws its chrome from
// TOOLS_CSS and gets its copy strip, Enter-to-run and result pulse from one
// injected script. Both live in the shell, so a regression here silently
// strips all hundred tools at once — this test is the tripwire.
test('tool pages ship the shared polish layer and enhancer', async () => {
  const html = await (await fetch(base + '/alat/percentage')).text();
  assert.ok(html.includes('.tl-copy{'), 'polish CSS must style the copy strip');
  assert.ok(html.includes('@keyframes tlpop'), 'result pulse keyframes must be present');
  assert.ok(html.includes('prefers-reduced-motion'), 'the pulse must respect reduced motion');
  assert.ok(html.includes('copy result'), 'enhancer script must add the copy strip');
  assert.ok(html.includes('Enter'), 'enhancer must wire Enter-to-run');
  // The hub itself is not a tool page — the enhancer is scoped to /alat/x only.
  const hub = await (await fetch(base + '/alat')).text();
  assert.ok(!hub.includes('copy result'), 'hub page should not ship the tool enhancer');
  // The hub is a card grid with a live filter, not a wall of prose (Nov 2026).
  assert.ok(hub.includes('class="tl-grid" id="tg-grid"'), 'hub must render the tool card grid');
  assert.ok(hub.includes('id="tg-q"'), 'hub must ship the toolbox search box');
  assert.ok(hub.includes('class="tl-card"'), 'hub cards must use the tl-card class');
});

// ── English-only URLs ──
// The site is written in English, so a tool's URL is English too. The older Malay slugs are
// still in search results and old bookmarks, so each must redirect permanently to its
// canonical page rather than 404 or leave the same tool reachable under two addresses.
const LEGACY_SLUGS = [
  ['/alat/tarikh', '/alat/date'],
  ['/alat/warna', '/alat/color'],
  ['/alat/kata-laluan', '/alat/password'],
  ['/alat/teks', '/alat/text'],
  ['/alat/gambar', '/alat/image'],
  ['/alat/kamus', '/alat/dictionary'],
  ['/kamus', '/alat/dictionary'],
  ['/alat/peratus', '/alat/percentage'],
  ['/alat/pinjaman', '/alat/loan'],
  ['/alat/rawak', '/alat/random'],
  ['/alat/zona', '/alat/timezone']
];

test('every legacy Malay tool URL redirects permanently to its English page', async () => {
  for (const [from, to] of LEGACY_SLUGS) {
    const res = await fetch(base + from, { redirect: 'manual' });
    assert.equal(res.status, 301, `${from} must answer 301`);
    assert.equal(res.headers.get('location'), to, `${from} must point at ${to}`);
  }
});

test('no page still links to a Malay tool URL', async () => {
  for (const path of ['/alat', ...PAGES.map((p) => p.path)]) {
    const html = await (await fetch(base + path)).text();
    for (const [legacy] of LEGACY_SLUGS) {
      assert.ok(!html.includes(`href="${legacy}"`), `${path} still links ${legacy}`);
    }
  }
});
