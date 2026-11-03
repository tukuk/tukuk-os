// ═══ Tests: the toolbox scripts actually WORK, not just load ═══
// test/alat-pages.test.js proves the pages render; it cannot prove the inline
// client script does. That gap is exactly where the embarrassing bugs live —
// a `a + b || c` precedence slip that prints "undefined" into a table, an
// unterminated string that kills the whole script silently. A visitor on a
// dead form has no way to tell us; they just leave and never come back.
//
// So this file runs every registered tool's script in a tiny DOM shim (the
// same technique the page itself uses: getElementById + value + innerHTML),
// seeded with the tool's own default inputs, and asserts the answer the
// browser would show — the numbers are hand-checked against the maths, not
// snapshotted from the code, so the test fails when the CODE is wrong instead
// of blessing whatever it currently prints.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TOOLKIT } = require('../src/toolbox');

// Pull each control's initial value out of the tool's own form markup, so the
// script under test sees exactly what a real page load hands it.
function defaultsOf(form) {
  const values = {}, checked = {};
  let m;
  const inputRe = /<input\s[^>]*id="([\w-]+)"[^>]*>/g;
  while ((m = inputRe.exec(form))) {
    const v = /value="([^"]*)"/.exec(m[0]);
    values[m[1]] = v ? v[1] : '';
    checked[m[1]] = /\bchecked\b/.test(m[0]);
  }
  const taRe = /<textarea[^>]*id="([\w-]+)"[^>]*>([\s\S]*?)<\/textarea>/g;
  while ((m = taRe.exec(form))) values[m[1]] = m[2];
  const selRe = /<select[^>]*id="([\w-]+)"[^>]*>([\s\S]*?)<\/select>/g;
  while ((m = selRe.exec(form))) {
    // Parse each option tag as a whole: a loose regex once ate the "selected"
    // word with [^>]* and silently tested the first option instead.
    const opts = [...m[2].matchAll(/<option\b([^>]*)>/g)].map((o) => ({
      value: (/value="([^"]*)"/.exec(o[1]) || [])[1] || '',
      selected: /\bselected\b/.test(o[1]),
    }));
    const sel = opts.find((o) => o.selected) || opts[0];
    values[m[1]] = sel ? sel.value : '';
  }
  return { values, checked };
}

function makeDom(values, checked) {
  const els = {};
  function get(id) {
    if (!els[id]) {
      els[id] = {
        id, value: values[id] != null ? values[id] : '', checked: Boolean(checked[id]),
        style: {}, _html: '', textContent: '',
        onclick: null, oninput: null, onchange: null, onkeyup: null,
        addEventListener() {}, select() {}, focus() {},
        click() { if (this.onclick) this.onclick(); },
      };
      Object.defineProperty(els[id], 'innerHTML', {
        get() { return this._html; },
        set(v) { this._html = String(v); },
      });
    }
    return els[id];
  }
  return {
    els, get,
    getElementById: get,
    createElement: () => get('created-' + Object.keys(els).length),
    body: { appendChild() {}, removeChild() {} },
  };
}

// Run one tool's script the way the page does, and return the DOM afterwards.
function runTool(t, extraValues) {
  const { values, checked } = defaultsOf(t.form);
  Object.assign(values, extraValues || {});
  const dom = makeDom(values, checked);
  const timers = [];
  const fn = new Function('document', 'navigator', 'setInterval', 'clearInterval', t.script);
  fn(dom, { clipboard: undefined }, (f) => { timers.push(f); return timers.length; }, () => {});
  return { dom, timers };
}

// The universal embarrassment check: no rendered output may contain the
// fingerprints of a broken script. Checked on every element the script touched.
function assertCleanOutputs(dom, slug) {
  for (const el of Object.values(dom.els)) {
    for (const text of [el._html, el.textContent]) {
      if (!text) continue;
      assert.ok(!/\bundefined\b/.test(text), `${slug}: #${el.id} printed "undefined" — ${text.slice(0, 160)}`);
      assert.ok(!/\bNaN\b/.test(text), `${slug}: #${el.id} printed NaN — ${text.slice(0, 160)}`);
      assert.ok(!/\[object Object\]/.test(text), `${slug}: #${el.id} stringified an object at the visitor — ${text.slice(0, 160)}`);
    }
  }
}

for (const t of TOOLKIT) {
  test(`${t.slug}: script executes with the page's own defaults and answers cleanly`, () => {
    const { dom } = runTool(t, t.slug === 'jwt' ? { 'jw-tok': SAMPLE_JWT } : null);
    assertCleanOutputs(dom, t.slug);
    // Something must actually have been computed on load — every tool renders
    // its answer immediately from defaults (jwt waits for a paste, so it is
    // driven explicitly below).
    if (t.slug !== 'jwt') {
      const touched = Object.values(dom.els).some((el) => el._html.length > 0 || el.textContent.length > 0);
      assert.ok(touched, `${t.slug}: script ran but never wrote an answer`);
    }
  });
}

// ── hand-checked expectations: the maths the page claims, proven per tool ──
const SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0' +
  '.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30';

test('base: 2026 converts to exact binary and hex', () => {
  const { dom } = runTool(bySlug('base'));
  const out = dom.get('bc-out')._html;
  // 2026 = 1024+512+256+128+64+32+8+2 — hand-checked, not snapshotted
  assert.ok(out.includes('11111101010'), 'binary of 2026');
  assert.ok(out.includes('3752'), 'octal of 2026');
  assert.ok(out.includes('7EA'), 'hex of 2026');
});

test('binary: "Hello, world!" starts with 01001000 (H)', () => {
  const { dom } = runTool(bySlug('binary'));
  assert.ok(dom.get('bt-out')._html.includes('01001000'));
});

test('prime: 2026 is composite and factors as 2 × 1013', () => {
  const { dom } = runTool(bySlug('prime'));
  const out = dom.get('pr-out')._html;
  assert.ok(out.includes('COMPOSITE'));
  assert.ok(/2\^?1?\s*×\s*1013|2 × 1013/.test(out), 'expected 2 × 1013 in: ' + out);
});

test('prime: a real prime gets the PRIME badge', () => {
  const { dom } = runTool(bySlug('prime'), { 'pr-n': '999999999989' }); // known prime
  assert.ok(dom.get('pr-out')._html.includes('PRIME'));
});

test('fraction: 1/3 + 1/6 answers 1 / 2 exactly', () => {
  const { dom } = runTool(bySlug('fraction'));
  const out = dom.get('fr-out')._html;
  assert.ok(out.includes('1/2') || out.includes('1 / 2'), 'expected 1/2, got: ' + out);
  assert.ok(out.includes('Working'), 'steps must be shown');
});

test('stats: the default column reports mean 23.4', () => {
  const { dom } = runTool(bySlug('stats'));
  assert.ok(dom.get('st-out')._html.includes('23.4'));
});

test('salary: $25/hour at 40 h × 50 wk is $50,000 a year', () => {
  const { dom } = runTool(bySlug('salary'));
  assert.ok(dom.get('sa-out')._html.includes('$50,000'));
});

test('tip: 86.40 + 10% split 4 ways is 23.76 each', () => {
  const { dom } = runTool(bySlug('tip'));
  const out = dom.get('tp-out')._html;
  assert.ok(out.includes('$23.76'), out);
  assert.ok(out.includes('$95.04'), 'total must show too');
});

test('discount: 30% then 20% is 44% off, not 50% — and it says so', () => {
  const { dom } = runTool(bySlug('discount'));
  const out = dom.get('dc-out')._html;
  assert.ok(out.includes('$67.20'), 'final price of 120');
  assert.ok(out.includes('44%'), 'the equivalent single discount');
  assert.ok(out.includes('50%') && out.includes('wrong'), 'the additive illusion is exposed');
});

test('countdown: starts ticking against tomorrow without a chosen date', () => {
  const { dom, timers } = runTool(bySlug('countdown'));
  assert.ok(dom.get('cd-out')._html.length > 0, 'no countdown rendered');
  assert.ok(timers.length >= 1, 'the per-second timer must be armed');
});

test('grade: 78 → 85 with a 30% final is impossible and the page admits it', () => {
  const { dom } = runTool(bySlug('grade'));
  const out = dom.get('gr-out')._html;
  assert.ok(out.includes('not reachable'), 'must refuse, not print a >100% fantasy');
  assert.ok(out.includes('84.6'), 'best achievable = 78×0.7 + 100×0.3 = 84.6');
});

test('entity: the default sample encodes < and " and stays displayable', () => {
  const { dom } = runTool(bySlug('entity'));
  const shown = dom.get('en-out').textContent;
  assert.ok(shown.includes('&lt;'), shown);
  assert.ok(shown.includes('&quot;'), shown);
});

test('jwt: decodes header and claims locally, keeps the warning honest', () => {
  const { dom } = runTool(bySlug('jwt'), { 'jw-tok': SAMPLE_JWT });
  dom.get('jw-go').click();
  assert.ok(dom.get('jw-head').textContent.includes('HS256'), 'algorithm must surface');
  const claims = dom.get('jw-claims')._html;
  assert.ok(claims.includes('John Doe'), 'payload claim decoded');
  assert.ok(claims.includes('issued at'), 'registered claim named');
});

// ── batch 2 (Nov 2026) — same standard: hand-derived maths, not snapshots ──
test('roman: 2026 is MMXXVI, and IIII is flagged not swallowed', () => {
  const { dom } = runTool(bySlug('roman'));
  assert.ok(dom.get('rm-out')._html.includes('MMXXVI'), '2026 = MMXXVI');
  const back = runTool(bySlug('roman'), { 'rm-mode': 'r2i', 'rm-in': 'IIII' });
  assert.ok(back.dom.get('rm-out')._html.includes('not canonical'), 'IIII must be called non-canonical');
});

test('number-to-words: 1,234,567.89 spells short-scale and says point eight nine', () => {
  const { dom } = runTool(bySlug('number-to-words'));
  const out = dom.get('nw-out')._html;
  assert.ok(out.includes('one million two hundred thirty-four thousand five hundred sixty-seven'), out);
  assert.ok(out.includes('point eight nine'), 'decimal digits read out');
});

test('number-to-words: 2^53+1 spells exactly — the float trap this page exists for', () => {
  const { dom } = runTool(bySlug('number-to-words'), { 'nw-in': '9007199254740993' });
  const out = dom.get('nw-out')._html;
  assert.ok(out.includes('nine quadrillion'), out);
  assert.ok(out.includes('nine hundred ninety-three'), 'last digit must NOT round to \u2026two (float)');
});

test('number-to-words: cheque mode names dollars and cents', () => {
  const { dom } = runTool(bySlug('number-to-words'), { 'nw-mode': 'cheque' });
  assert.ok(dom.get('nw-out')._html.includes('dollars and 89 cents'));
});

test('duration: 202600 s is 2d 8h 16m 40s down to the seconds', () => {
  const { dom } = runTool(bySlug('duration'));
  assert.ok(dom.get('du-out')._html.includes('2d 8h 16m 40s'), dom.get('du-out')._html.slice(0, 120));
});

test('validate: 4242\u2026 passes Luhn and prints the working (sum 80)', () => {
  const { dom } = runTool(bySlug('validate'));
  const out = dom.get('va-out')._html;
  assert.ok(out.includes('tl-ok'), 'default card number must be VALID');
  assert.ok(out.includes('sum = 80'), '8 fours doubled to 8 + 8 twos = 80');
});

test('validate: the classic IBAN, ISBN-13 and ISBN-10 examples all pass', () => {
  const iban = runTool(bySlug('validate'), { 'va-kind': 'iban', 'va-in': 'DE89 370400440532013000' });
  assert.ok(iban.dom.get('va-out')._html.includes('mod 97 = 1'), 'textbook IBAN must verify');
  const i13 = runTool(bySlug('validate'), { 'va-kind': 'isbn13', 'va-in': '9780306406157' });
  assert.ok(i13.dom.get('va-out')._html.includes('tl-ok'), 'known-good ISBN-13');
  const i10 = runTool(bySlug('validate'), { 'va-kind': 'isbn10', 'va-in': '048665088X' });
  assert.ok(i10.dom.get('va-out')._html.includes('tl-ok'), 'Dover reprint ISBN-10 with X check');
});

test('validate: a broken check digit is rejected with the expected digit named', () => {
  const bad = runTool(bySlug('validate'), { 'va-kind': 'isbn13', 'va-in': '9780306406158' });
  const out = bad.dom.get('va-out')._html;
  assert.ok(out.includes('tl-no'), 'must be INVALID');
  assert.ok(out.includes('should be 7'), 'and say what the check digit is');
});

test('unitprice: 4.99/500\u202fg vs 8.50/1\u202fkg \u2014 B wins by 14.8%', () => {
  const { dom } = runTool(bySlug('unitprice'));
  const out = dom.get('up-out')._html;
  // A = 0.00998/g, B = 0.0085/g; gap (0.00998-0.0085)/0.00998 = 14.829\u2026 hand-checked
  assert.ok(out.includes('B by 14.8%'), out.slice(0, 140));
  assert.ok(out.includes('0.00998'), 'per-gram rate shown to real precision');
});

test('fuel: 480 km on 30 L is 6.25 L/100 km, 16 km/L, 37.6 US MPG', () => {
  const { dom } = runTool(bySlug('fuel'));
  const out = dom.get('fu-out')._html;
  assert.ok(out.includes('6.25 L/100'), out.slice(0, 100));
  assert.ok(out.includes('16 km/L'));
  assert.ok(out.includes('37.6 MPG'), 'km/L \u00d7 1.609344 / 3.785411784 = 37.598');
  assert.ok(out.includes('$11.56'), 'cost per 100 km at 1.85/L');
});

test('sleep: alarm at 06:30 offers 21:15, 22:45 and 00:15 bedtimes', () => {
  const { dom } = runTool(bySlug('sleep'));
  const out = dom.get('sl-out')._html;
  // 6\u00d790+15=555 min before 390 = 21:15; 5\u00d790+15=465 \u2192 22:45; 4\u00d790+15=375 \u2192 00:15
  for (const t of ['21:15', '22:45', '00:15']) assert.ok(out.includes(t), 'missing ' + t);
});

test('lorem: the classic opener is intact when requested', () => {
  const { dom } = runTool(bySlug('lorem'));
  assert.ok(dom.get('lo-out')._html.includes('Lorem ipsum dolor sit amet, consectetur adipiscing elit'));
});

test('aspect: 1920\u00d71080 reduces to 16:9 and fits 800\u00d7450 inside 800\u00d7600', () => {
  const { dom } = runTool(bySlug('aspect'));
  const out = dom.get('as-out')._html;
  assert.ok(out.includes('16:9'), out.slice(0, 100));
  assert.ok(out.includes('800\u00d7450'), 'fit row');
  assert.ok(out.includes('2.07 MP'), '1920\u00d71080/1e6 = 2.0736');
});

test('cssunits: 24 px at root 16 is 1.5 rem and 18 pt', () => {
  const { dom } = runTool(bySlug('cssunits'));
  const out = dom.get('cu-out')._html;
  assert.ok(out.includes('1.5 rem'), out.slice(0, 200));
  assert.ok(out.includes('18 pt'), 'px \u00d7 72/96');
});

test('dice: 2d6 hits 7 exactly 16.67% and clears it 58.33% of the time', () => {
  const { dom } = runTool(bySlug('dice'));
  const out = dom.get('di-out')._html;
  // 6/36 and 21/36 \u2014 hand-counted from the 36 outcomes, not simulated
  assert.ok(out.includes('16.67%'), out.slice(0, 200));
  assert.ok(out.includes('58.33%'), 'P(\u22657) = 21/36');
  assert.ok(out.includes('(= 6^2)'), 'total outcomes row shows 36 = 6^2');
});

test('download: 4.7 GB at 100 Mbps is 6 m 16 s at line rate', () => {
  const { dom } = runTool(bySlug('download'));
  const out = dom.get('dn-out')._html;
  // 4.7e9 \u00d7 8 bits / 1e8 bit/s = 376 s exactly; the tool joins with \u202f thin spaces
  assert.ok(out.includes('6\u202fm 16\u202fs'), out.slice(0, 160));
});

// ── batch 3 (Nov 2026): math, life, and the design studio ──
test('comb: C(52,5) is exactly 2,598,960 and P(52,5) is 311,875,200', () => {
  const { dom } = runTool(bySlug('comb'));
  const out = dom.get('cb-out')._html;
  // A poker hand: 52·51·50·49·48 / 5! — hand-checked, and P = C × 5! = C × 120
  assert.ok(out.includes('2,598,960'), out.slice(0, 160));
  assert.ok(out.includes('311,875,200'), 'permutations must show too');
  assert.ok(out.includes('× 120'), 'the C↔P gap must be explained as 5!');
});

test('gcd: Euclid on 1071 and 462 ends at 21, lcm 23,562', () => {
  const { dom } = runTool(bySlug('gcd'));
  const out = dom.get('gd-out')._html;
  assert.ok(out.includes('gcd = 21'), out.slice(0, 200));
  assert.ok(out.includes('1,071 = 2 × 462 + 147'), 'step 1 must be printed in full');
  assert.ok(out.includes('23,562'), 'lcm = 1071×462÷21');
  assert.ok(out.includes('51/22'), 'the reduce-to-lowest-terms bonus');
});

test('triangle: 3-4-5 is right scalene — 90.00°, area 6.000', () => {
  const { dom } = runTool(bySlug('triangle'));
  const out = dom.get('tr-out')._html;
  assert.ok(out.includes('90.00°'), out.slice(0, 200));
  assert.ok(out.includes('36.87°') && out.includes('53.13°'), 'the two acute angles');
  assert.ok(out.includes('6.000'), 'Heron area = ½×3×4 exactly');
  assert.ok(out.includes('right scalene'), 'classification');
});

test('readability: six monosyllabic words score 116.1 Flesch', () => {
  const { dom } = runTool(bySlug('readability'));
  const out = dom.get('rb-out')._html;
  // 206.835 − 1.015×6 − 84.6×1 = 116.14 — the cat sentence is the easy extreme
  assert.ok(out.includes('116.1'), out.slice(0, 200));
  assert.ok(out.includes("children's books"), 'band label');
  assert.ok(out.includes('-1.4'), 'Flesch–Kincaid grade below first year');
});

test('tdee: 30 y male 175 cm 70 kg sedentary → BMR 1,649, TDEE 1,979', () => {
  const { dom } = runTool(bySlug('tdee'));
  const out = dom.get('td-out')._html;
  // Mifflin-St Jeor: 10×70 + 6.25×175 − 5×30 + 5 = 1,648.75; ×1.2 = 1,978.5
  assert.ok(out.includes('1,649'), out.slice(0, 200));
  assert.ok(out.includes('1,979'), 'maintenance line');
  assert.ok(out.includes('1,479') && out.includes('2,479'), 'the ±500 kcal rows');
});

test('inflate: 1,000 at 3% over 10 years is 1,343.92', () => {
  const { dom } = runTool(bySlug('inflate'));
  const out = dom.get('xf-out')._html;
  assert.ok(out.includes('1,343.92'), out.slice(0, 200)); // 1000×1.03^10
  assert.ok(out.includes('1.3439'), 'compound factor');
  assert.ok(out.includes('23.4') && out.includes('24.0'), 'exact doubling vs rule of 72');
});

test('cipher: Caesar shift 3 turns "Attack at dawn" into "Dwwdfn dw gdzq"', () => {
  const { dom } = runTool(bySlug('cipher'));
  const out = dom.get('cp-out')._html;
  assert.ok(out.includes('Dwwdfn dw gdzq'), out.slice(0, 200));
  assert.ok(out.includes('shift 3 mod 26'), 'the maths must be shown');
  assert.ok(out.includes('12 of 14'), 'letter count vs passed-through characters');
});

test('paint: 5×4×2.4 room with 6 m² of openings needs 4.1 L at 10 m²/L', () => {
  const { dom } = runTool(bySlug('paint'));
  const out = dom.get('pt-out')._html;
  // 2×(5+4)×2.4 = 43.2 gross; −6 = 37.2; ÷10 = 3.72; +10% waste rounded up = 4.1
  assert.ok(out.includes('43.2 m²'), out.slice(0, 200));
  assert.ok(out.includes('37.2 m²'), 'net area after openings');
  assert.ok(out.includes('4.1 L'), 'buy quantity');
  assert.ok(out.includes('8.2 L'), 'two-coat warning');
});

test('recipe: scaling 8→12 gives 3 cups flour, ¾ tsp salt, 4 ½ eggs', () => {
  const { dom } = runTool(bySlug('recipe'));
  const out = dom.get('rc-out')._html;
  assert.ok(out.includes('3 cups flour'), out.slice(0, 200));
  assert.ok(out.includes('¾ tsp salt'), '0.5×1.5 must land on the ¾ glyph');
  assert.ok(out.includes('4 ½ eggs'), '3×1.5 as a mixed number');
  assert.ok(out.includes('was 0.5 tsp salt'), 'the original line stays visible');
});

test('printsize: 3000×2000 px at 300 dpi prints 10 × 6.7 in', () => {
  const { dom } = runTool(bySlug('printsize'));
  const out = dom.get('py-out')._html;
  assert.ok(out.includes('10 × 6.7 in'), out.slice(0, 200));
  assert.ok(out.includes('25.4 × 16.9 cm'), 'centimetre conversion (×2.54)');
  assert.ok(out.includes('6 megapixels'), 'resolution line');
});

test('electricity: 100 W × 8 h × 30 days at 0.50 is 24 kWh and 12', () => {
  const { dom } = runTool(bySlug('electricity'));
  const out = dom.get('el-out')._html;
  assert.ok(/tl-big">12\b/.test(out), 'cost must be the headline — got: ' + out.slice(0, 160));
  assert.ok(out.includes('24 kWh'), 'energy over the period');
  assert.ok(out.includes('0.8 kWh · 0.4'), 'per-day row');
  assert.ok(out.includes('292 kWh · 146'), 'all-year projection (8 h × 365 d)');
});

test('pace: 5 km in 25:00 is 5:00/km, 12.0 km/h, half at 1:45:29', () => {
  const { dom } = runTool(bySlug('pace'));
  const out = dom.get('pc-out')._html;
  assert.ok(/tl-big">5:00\b/.test(out), 'pace headline');
  assert.ok(out.includes('12.0 km/h'), 'speed');
  assert.ok(out.includes('8:03'), 'per-mile equivalent (×1.609344)');
  assert.ok(out.includes('1:45:29'), 'half marathon at even pace — 21.0975 km × 5 min');
  assert.ok(out.includes('52:07'), 'Riegel 10K prediction (50:00 × 2^1.06)');
});

test('design: the studio boots with a real selection, not an empty page', () => {
  const { dom } = runTool(bySlug('design'));
  // The canvas has no 2D context in this shim, so the proof of life is the
  // selection readout: two default layers are added and the headline wins.
  assert.ok(dom.get('ds-sel').textContent.includes('layer 2: headline'), dom.get('ds-sel').textContent);
});

function bySlug(slug) {
  const t = TOOLKIT.find((x) => x.slug === slug);
  assert.ok(t, 'tool ' + slug + ' vanished from the registry');
  return t;
}

// The registry itself is the contract the second wave depends on: duplicate
// slugs would silently shadow a route, a missing script would render a dead
// form, and a tool with no hub/nav presence is invisible to readers.
test('registry invariants hold for every entry', () => {
  const slugs = TOOLKIT.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in TOOLKIT');
  for (const t of TOOLKIT) {
    for (const f of ['slug', 'ic', 'name', 'title', 'desc', 'hero', 'sub', 'navBlurb', 'hubBlurb', 'lead', 'form', 'script'])
      assert.ok(typeof t[f] === 'string' && t[f].length > 0, `${t.slug}: missing ${f}`);
    assert.match(t.slug, /^[a-z0-9-]+$/, `${t.slug}: slug must be URL-clean`);
    assert.ok(!/<\/script>/i.test(t.script), `${t.slug}: script contains a close tag that would truncate the page`);
    assert.ok(!t.script.includes('${'), `${t.slug}: script leaks a template placeholder`);
    const ids = [...t.form.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
    for (const m of t.script.matchAll(/\$\('([\w-]+)'\)/g))
      assert.ok(ids.includes(m[1]), `${t.slug}: script binds #${m[1]} but the form never defines it`);
  }
});
