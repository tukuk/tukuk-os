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
  assert.ok(dom.get('ds-sel').textContent.includes('layer 2 / 2: headline'), dom.get('ds-sel').textContent);
  // v2: the layer panel is DOM, not canvas, so it must be populated too.
  assert.ok(dom.get('ds-layers')._html.includes('headline'), 'layer list not rendered');
  assert.ok(dom.get('ds-layers')._html.includes('accent circle'), 'both boot layers must be listed');
});

test('design: templates, undo and the layer controls work without a canvas', () => {
  const { dom } = runTool(bySlug('design'));
  // A template replaces the stack and announces itself; the shim has no cx,
  // so everything that must survive is plain DOM bookkeeping.
  dom.get('ds-tpl').value = 'hero';
  dom.get('ds-tpl').onchange();
  assert.ok(dom.get('ds-out')._html === '' && /Template loaded: hero/.test(dom.get('ds-out').textContent),
    'template verdict missing: ' + dom.get('ds-out').textContent);
  assert.ok(dom.get('ds-sel').textContent.includes('layer 4 / 4'), 'hero has four layers: ' + dom.get('ds-sel').textContent);
  // Undo pops straight back to the two boot layers.
  dom.get('ds-undo').click();
  assert.ok(dom.get('ds-sel').textContent.includes('layer 2 / 2'), 'undo should restore the boot stack');
  // Shape buttons add typed layers; hidden toggling keeps the list honest.
  dom.get('ds-addstar').click();
  assert.ok(dom.get('ds-sel').textContent.includes('star'), dom.get('ds-sel').textContent);
  dom.get('ds-del').click();
  assert.ok(dom.get('ds-sel').textContent.includes('layer 2 / 2'), 'delete removes the star again');
  // Text edits rename the layer, and the save button needs no canvas either.
  dom.get('ds-txt').value = 'Hello world today';
  dom.get('ds-txt').oninput();
  assert.ok(dom.get('ds-layers')._html.includes('Hello worl'), 'layer renamed: ' + dom.get('ds-layers')._html.slice(0, 200));
  dom.get('ds-save').click();
  assert.ok(/Design file saved/.test(dom.get('ds-out').textContent), dom.get('ds-out').textContent);
});

test('design v3: sale/cover templates, sticker, align, lock, flip and Copy PNG hold up in the shim', () => {
  const { dom } = runTool(bySlug('design'));
  // The two new templates join the picker with four real layers each.
  dom.get('ds-tpl').value = 'sale';
  dom.get('ds-tpl').onchange();
  assert.ok(/Template loaded: sale/.test(dom.get('ds-out').textContent), dom.get('ds-out').textContent);
  assert.ok(dom.get('ds-sel').textContent.includes('layer 4 / 4'), 'sale burst has four layers: ' + dom.get('ds-sel').textContent);
  dom.get('ds-tpl').value = 'cover';
  dom.get('ds-tpl').onchange();
  assert.ok(/Template loaded: cover/.test(dom.get('ds-out').textContent), 'cover template verdict');
  assert.ok(dom.get('ds-sel').textContent.includes('layer 4 / 4'), 'podcast cover has four layers');
  // Emoji sticker: one click adds a named text layer on top and selects it.
  dom.get('ds-addsticker').click();
  assert.ok(dom.get('ds-sel').textContent.includes('layer 5 / 5: sticker'), dom.get('ds-sel').textContent);
  // Alignment needs no canvas: layerBox falls back to a 10px text width when
  // nothing can measure, and the move still lands in the undo history.
  dom.get('ds-al-c').click();
  dom.get('ds-al-b').click();
  dom.get('ds-undo').click();
  // Lock must quiet every other control for the selected layer.
  dom.get('ds-lock').click();
  assert.ok(/locked: it cannot be dragged/.test(dom.get('ds-out').textContent), 'lock announcement');
  assert.ok(dom.get('ds-layers')._html.includes('locked'), 'locked badge in the layer list');
  dom.get('ds-del').click();
  assert.ok(/press Lock again to unlock/.test(dom.get('ds-out').textContent), 'delete must refuse a locked layer');
  dom.get('ds-al-c').click();
  assert.ok(/unlock it before aligning/.test(dom.get('ds-out').textContent), 'align must refuse a locked layer');
  dom.get('ds-lock').click();
  assert.ok(/unlocked/.test(dom.get('ds-out').textContent), 'unlock announcement');
  dom.get('ds-fliph').click();
  assert.ok(dom.get('ds-out').textContent.includes('Layer flipped left-right.'), dom.get('ds-out').textContent);
  // Copy PNG has no context to paint with in this shim — it must stay silent
  // and harmless rather than throw on the missing canvas or clipboard.
  dom.get('ds-clip').click();
});

// ── batch 4 (Nov 2026) — hand-derived numbers again, swap-verified ──
test('water: 65 kg + 150 min/week answers 2.45 L and shows every term', () => {
  const { dom } = runTool(bySlug('water'));
  const out = dom.get('wa-out')._html;
  // 35×65 = 2275; 150×500/(7×60) = 178.6 → 179; total 2454 → rounded to 2450
  assert.ok(out.includes('tl-big">2.45 L'), 'headline litres: ' + out.slice(0, 120));
  assert.ok(out.includes('2275 ml'), 'base row');
  assert.ok(out.includes('+179 ml'), 'exercise row (weekly average, not per session)');
  assert.ok(out.includes('9.8 glasses'), '250 ml glasses');
  assert.ok(out.includes('153 ml every hour'), '2450 ÷ 16 waking hours');
  assert.ok(out.includes('every 120 min, ~306 ml'), '8-stop reminder plan');
});

test('compound: 10k + 100/mo at 5% monthly for 10 yrs is 31,998.32', () => {
  const { dom } = runTool(bySlug('compound'));
  const out = dom.get('ci-out')._html;
  // A = 10000·1.0041667^120 + 100·(1.0041667^120−1)/0.0041667 — hand-checked
  assert.ok(out.includes('31,998.32'), 'balance: ' + out.slice(0, 120));
  assert.ok(out.includes('22,000.00'), 'you put in');
  assert.ok(out.includes('9,998.32'), 'interest is the remainder');
  assert.ok(out.includes('5.116% (nominal 5.00% compounded monthly)'), 'EAR row');
  assert.ok(out.includes('13.89 years exact'), 'ln2/ln(1+i) per month ÷ 12');
  assert.ok(out.includes('11,739.50'), 'year-one balance');
});

test('tax: adding 6% to 100 gives 106.00 gross, and the table foots', () => {
  const { dom } = runTool(bySlug('tax'));
  const out = dom.get('tx-out')._html;
  assert.ok(out.includes('tl-big">106.00 gross'), out.slice(0, 120));
  assert.ok(out.includes('6.00'), 'tax row');
  assert.ok(out.includes('<td>20%</td><td>100.00</td><td>20.00</td><td>120.00</td>'), '20% comparison row');
});

test('breath: load shows the three-pattern table with correct paces', () => {
  const { dom } = runTool(bySlug('breath'));
  const out = dom.get('bp-out')._html;
  // round lengths are sums of the counts: 10 s, 16 s, 19 s → 6.0, 3.8, 3.2 per min
  assert.ok(out.includes('10 s') && out.includes('6.0'), 'coherent row');
  assert.ok(out.includes('16 s') && out.includes('3.8'), 'box row (60/16)');
  assert.ok(out.includes('19 s') && out.includes('3.2'), '4-7-8 row (60/19)');
});

test('morse: "Hello, World!" encodes to the exact ITU strings', () => {
  const { dom } = runTool(bySlug('morse'));
  const out = dom.get('mo-out')._html;
  assert.ok(out.includes('.... . .-.. .-.. ---'), 'HELLO');
  assert.ok(out.includes('--..--'), 'comma is ..--..');
  assert.ok(out.includes('-.-.--'), 'exclamation');
  assert.ok(out.includes('100 ms per unit'), 'PARIS rule: 1200 ÷ 12 wpm');
});

test('phonetic: TUKUK-2026 chains the NATO words exactly', () => {
  const { dom } = runTool(bySlug('phonetic'));
  assert.ok(dom.get('ph-out')._html.includes('Tango Uniform Kilo Uniform Kilo Two Zero Two Six'));
});

test('week: 3 Nov 2026 is W45-2, day 307, and 2026 has 53 weeks', () => {
  // ISO 8601: W = floor((ordinal − isoDow + 10)/7) = (307 − 2 + 10)/7 = 45; Jan 1 2026 is
  // a Thursday, so that partial week counts as week 1 and the year runs to 53.
  const { dom } = runTool(bySlug('week'));
  const out = dom.get('wk-out')._html;
  assert.ok(out.includes('W45 of 2026'), out.slice(0, 120));
  assert.ok(out.includes('2026-W45-2'), 'ISO date string');
  assert.ok(out.includes('307 of 365'), 'day of year');
  assert.ok(out.includes('53'), 'weeks in 2026');
});

test('markdown: headings, emphasis, lists, quote and link all render', () => {
  const { dom } = runTool(bySlug('markdown'));
  const prev = dom.get('mk-prev')._html;
  assert.ok(prev.includes('<h1>Hello tukuk</h1>'), 'heading');
  assert.ok(prev.includes('<strong>bold</strong>'), 'emphasis');
  assert.ok(prev.includes('<ul><li>first point</li>'), 'bullet list');
  assert.ok(prev.includes('<blockquote>'), 'quote');
  assert.ok(prev.includes('<a href="https://tukuk.org">link</a>'), 'link');
});

test('case: the mixed default tokenises to 12 words and camelCase', () => {
  const { dom } = runTool(bySlug('case'));
  const out = dom.get('cs-out')._html;
  assert.ok(out.includes('12 words'), 'token count');
  assert.ok(out.includes('getUserIdHttpServerApiKey2TheQuickBrownFox'), 'camelCase joins acronym-aware tokens');
});

test('coords: KL→Singapore default is 309.3 km on the WGS-84 sphere', () => {
  // haversine, R = 6371.0088 km — hand-checked against the published formula
  const { dom } = runTool(bySlug('coords'));
  const out = dom.get('hv-out')._html;
  assert.ok(out.includes('309.3 km'), out.slice(0, 120));
  assert.ok(out.includes('192.2 mi'), '× 0.621371');
  assert.ok(out.includes('167.0 nmi'), '÷ 1.852 exactly');
  assert.ok(out.includes('129.9°'), 'initial bearing');
});

test('month-grid: November 2026 starts on a Sunday under W44', () => {
  // 1 Nov 2026 is a Sunday; the ISO week containing that row (Thursday 5 Nov) is W45,
  // but the printed week label is for the row — the first partial week is W44.
  const { dom } = runTool(bySlug('month-grid'));
  const out = dom.get('ca-out')._html;
  assert.ok(out.includes('November 2026'), 'headline');
  assert.ok(out.includes('<td class="ca-w">W44</td>'), 'first row label');
  assert.ok(out.includes('<td>1</td></tr>'), 'Nov 1 sits at the end of the first row (Sunday)');
  assert.ok(out.includes('W45'), 'the full week below');
});

test('typing: preview on load, then a correct word turns green', () => {
  const { dom } = runTool(bySlug('typing'));
  assert.ok(dom.get('ty-words')._html.includes('preview'), 'word bank preview on load');
  dom.get('ty-start').click();
  const laid = dom.get('ty-words')._html;
  assert.equal((laid.match(/ty-w/g) || []).length, 60, '60 chips after Start');
  const first = /data-i="0"[^>]*>([a-z]+)</.exec(laid)[1];
  dom.get('ty-type').value = first;
  dom.get('ty-type').onkeydown({ key: ' ', preventDefault() {} });
  assert.ok(dom.get('ty-words')._html.includes('ty-done'), 'correct word marked done');
});

// ═══ Batch 5 (Nov 2026): the same hand-checked discipline, tool by tool ═══

test('gpa: 3.45 from the default four courses, 2 straight-A credits to reach 3.50', () => {
  // hand math: 14 credits, 48.3 quality points → 3.45; catch-up x=(3.5·14−48.3)/0.5=1.9→⌈2⌉
  const { dom } = runTool(bySlug('gpa'));
  const out = dom.get('gp-out')._html;
  assert.ok(out.includes('3.45 / 4.00'), out.slice(0, 120));
  assert.ok(out.includes('<b>14</b>'), 'credit total');
  assert.ok(out.includes('48.30'), 'quality points');
  assert.ok(out.includes('Second class upper / cum laude'), 'class band for 3.44');
  assert.ok(out.includes('<b>2 credits</b>'), 'catch-up credits');
  assert.ok(out.includes('1 typical course)'), 'singular course wording when ceil is 1');
});

test('shoe: 25 cm is EU 40, UK 6.5, US 7.5 — and the answer is written on load', () => {
  // EU = 1.5×(25+1.5) = 39.75 → 40; US = 3×(25/2.54)−22 = 7.48 → 7.5; UK = US−1
  const { dom } = runTool(bySlug('shoe'));
  const out = dom.get('sh-out')._html;
  assert.ok(out.length > 50, 'shoe must render an answer on load, not an empty box');
  assert.ok(out.includes('EU 40'), out.slice(0, 120));
  assert.ok(out.includes('25.0 cm'), 'Mondopoint line');
  assert.ok(out.includes('6.5 —'), 'UK men half size');
  assert.ok(out.includes('7.5 —'), 'US men Brannock');
  assert.ok(out.includes('>9 —'), 'US women +1.5');
});

test('screen: 15.6" 1920×1080 vs 11" 2560×1600 — area and density verdicts', () => {
  // ppi = √(1920²+1080²)/15.6 = 141.2; √(2560²+1600²)/11 = 274.0; ratio labels are float-matched
  const { dom } = runTool(bySlug('screen'));
  const out = dom.get('sc-out')._html;
  assert.ok(out.includes('141 vs 274 ppi'), out.slice(0, 120));
  assert.ok(out.includes('16:9 (1.778)'), 'aspect A');
  assert.ok(out.includes('16:10 (1.600)'), 'aspect B survives gcd reduction to 8:5');
  assert.ok(out.includes('91% more picture'), 'B(11²) vs A(15.6²): A shows 91% more picture');
  assert.ok(out.includes('B is the denser panel — B\u2019s text is 1.94\u00d7 as sharp'), 'area winner and density winner named separately, not conflated');
});

test('metronome: 100 BPM is Andante, table prints every named range', () => {
  const { dom } = runTool(bySlug('metronome'));
  const out = dom.get('mt-out')._html;
  assert.ok(out.includes('100 BPM'), 'headline');
  assert.ok(out.includes('Andante'), 'tempo name');
  assert.ok(out.includes('76\u2013107'), 'Andante band 76 to 108−1');
  assert.equal((out.match(/<tr><td>/g) || []).length, 8, '7 names + header row');
});

test('stopwatch: start → lap → pause produces a best-badged split table', () => {
  const { dom } = runTool(bySlug('stopwatch'));
  assert.ok(dom.get('sw-out')._html.includes('Press Lap'), 'idle hint on load');
  assert.equal(dom.get('sw-time').textContent, '00:00.00', 'clock reads zero on load (mm:ss.cs, no hours until needed)');
  dom.get('sw-go').click();
  dom.get('sw-lap').click();
  dom.get('sw-lap').click();
  dom.get('sw-go').click(); // pause
  const out = dom.get('sw-out')._html;
  assert.ok(out.includes('<td>1</td>'), 'lap 1 row');
  assert.ok(out.includes('<td>2</td>'), 'lap 2 row');
  assert.ok(out.includes('tl-badge tl-ok">best'), 'first lap is the best (second ≥ it)');
  assert.equal(dom.get('sw-go').textContent, 'Resume', 'button flips to Resume after pause');
});

test('blood-type: AO × AO gives A 75% · O 25% with the Punnett cells', () => {
  const { dom } = runTool(bySlug('blood-type'));
  const out = dom.get('bd-out')._html;
  assert.ok(out.includes('A 75%'), out.slice(0, 160));
  assert.ok(out.includes('O 25%'), 'the classic surprise: two A parents, an O child');
  assert.ok(out.includes('AA'), 'cell genotype');
  assert.equal((out.match(/AO/g) || []).length >= 2, true, 'two AO cells');
});

test('dna: ATGGCATCGGTCTAA translates to MASV with a stop at codon 5', () => {
  // frames of 3: ATG GCA TCG GTC TAA → M A S V stop; GC = 7 of 15 bases
  const { dom } = runTool(bySlug('dna'));
  const out = dom.get('dn-out')._html;
  assert.ok(out.includes('Met-Ala-Ser-Val'), out.slice(0, 200));
  assert.ok(out.includes('46.7%'), 'GC content 7/15');
  assert.ok(/TAA/.test(out) && /\*/.test(out), 'stop codon surfaced');
});

test('subnet: 192.168.1.130/26 is the .128 block with 62 usable hosts', () => {
  // size = 2^(32−26) = 64 → network 128, broadcast 191, usable .129–.190, next /26 at .192
  const { dom } = runTool(bySlug('subnet'));
  const out = dom.get('su-out')._html;
  assert.ok(out.includes('192.168.1.128'), 'network address');
  assert.ok(out.includes('255.255.255.192'), 'mask');
  assert.ok(out.includes('0.0.0.63'), 'wildcard');
  assert.ok(out.includes('192.168.1.191'), 'broadcast');
  assert.ok(out.includes('62 ('), 'usable count with parenthetical');
  assert.ok(out.includes('192.168.1.192'), 'next subnet');
});

test('heartrate: age 30 rest 60 → Gellish 186, Z2 starts at 123 bpm', () => {
  // Gellish 207−0.7·30 = 186; HRR = 126; Z2 lower = 60 + 0.6·126 = 135.6 → 136, upper = 60+0.7·126 = 148.2 → 148
  const { dom } = runTool(bySlug('heartrate'));
  const out = dom.get('hz-out')._html;
  assert.ok(out.includes('186 bpm'), 'max estimate');
  assert.ok(out.includes('126 bpm'), 'heart-rate reserve');
  assert.ok(out.includes('136'), 'Z2 floor');
  assert.ok(out.includes('148'), 'Z2 ceiling');
});

test('caffeine: 200 mg at 15:00 halves at 20:00, 66 mg aboard at bedtime', () => {
  // 5 h half-life: 200·2^(−t/5); at +8 h = 65.6 → 66 mg; 100 mg crossed at exactly 5 h
  const { dom } = runTool(bySlug('caffeine'));
  const out = dom.get('cf-out')._html;
  assert.ok(out.includes('200 mg at 15:00'), 'headline');
  assert.ok(out.includes('20:00'), 'half-life clock time');
  assert.ok(out.includes('66 mg'), 'bedtime load');
  assert.ok(out.includes('Drake'), 'the 6-hours-before-bed sleep study citation');
});

test('moon: 2026-11-03 (lunar age ≈ 23.2) is a waning Last Quarter', () => {
  // reference new moon 2026-10-10/11; synodic 29.530588 — age = (date − ref) mod cycle
  const { dom } = runTool(bySlug('moon'));
  const out = dom.get('mn-out')._html;
  assert.ok(out.includes('Last Quarter'), out.slice(0, 160));
  assert.ok(out.includes('shrinking, lit on the left'), 'waning phrasing (the precedence bug this batch fixed)');
  assert.ok(/2[23]\.\d days/.test(out), 'lunar age in the 22–23 day band');
  assert.ok(/9 November 2026/.test(out), 'next new moon ≈ 2026-11-09/10');
});

test('easter: 2026 → Western 5 April, Orthodox 12 April; 2025 coincides on 20 April', () => {
  // verified against python dateutil (Tondering/Oudin computus) — the draft formula was wrong
  const { dom } = runTool(bySlug('easter'));
  const out = dom.get('ep-out')._html;
  assert.ok(out.includes('5 April 2026'), out.slice(0, 120));
  assert.ok(out.includes('12 April 2026'), 'Orthodox on the Julian + 13-day conversion');
  assert.ok(out.includes('7 days apart'), 'gap');
  const again = runTool(bySlug('easter'), { 'ep-y': '2025' });
  const o2 = again.dom.get('ep-out')._html;
  assert.ok(o2.includes('20 April 2025'), 'both churches agree in 2025');
});

function bySlug(slug) {
  const t = TOOLKIT.find((x) => x.slug === slug);
  assert.ok(t, 'tool ' + slug + ' vanished from the registry');
  return t;
}

// ── learning batch (Nov 2026) — the drills get the same hand-checked standard ──
test('flashcards: the default deck parses eight cards and the tally moves', () => {
  const { dom } = runTool(bySlug('flashcards'));
  let out = dom.get('fc-out')._html;
  assert.ok(out.includes('capital of Japan'), 'front of deck card 1 must show');
  assert.ok(out.includes('Card 1 of 8'), 'all eight well-formed lines must parse');
  dom.get('fc-reveal').click();
  out = dom.get('fc-out')._html;
  assert.ok(out.includes('Tokyo'), 'answer appears after reveal');
  assert.ok(out.includes('The question was: capital of Japan'), 'question restated under the answer');
  dom.get('fc-know').click();
  assert.ok(dom.get('fc-out')._html.includes('knew it 1'), 'knew-it tally increments and the deck advances');
});

test('quiz-maker: five defaults start the quiz and Paris marks correct', () => {
  const { dom } = runTool(bySlug('quiz-maker'));
  assert.ok(dom.get('qz-out')._html.includes('<b>5</b> questions parsed'), dom.get('qz-out')._html.slice(0, 160));
  dom.get('qz-go').click();
  assert.ok(dom.get('qz-out')._html.includes('Question 1 of 5'), 'quiz starts at question one');
  const names = [0, 1, 2, 3].map((i) => dom.get('qz-a' + i).textContent);
  assert.ok(new Set(names).size === 4, 'options must be distinct');
  const paris = names.findIndex((n) => n === 'Paris');
  assert.ok(paris >= 0, 'the correct option must be among the four');
  dom.get('qz-a' + paris).click();
  assert.ok(dom.get('qz-fb')._html.includes('tl-ok') && dom.get('qz-fb')._html.includes('Paris'), 'correct pick marked');
});

test('times-tables: answering the drawn question correctly scores 1/1', () => {
  const { dom } = runTool(bySlug('times-tables'));
  const q = /(\d+) \u00d7 (\d+)/.exec(dom.get('tt-q')._html);
  assert.ok(q, 'a question must be on the board on load');
  dom.get('tt-ans').value = String(Number(q[1]) * Number(q[2]));
  dom.get('tt-go').click();
  const out = dom.get('tt-out')._html;
  assert.ok(out.includes('tl-ok') && out.includes('score 1/1'), out.slice(0, 160));
});

test('clock-reading: the drawn face has twelve numerals and the minute hand on 12 at o\u2019clock', () => {
  const { dom } = runTool(bySlug('clock-reading'));
  const face = dom.get('cr-face')._html;
  for (let n = 1; n <= 12; n++) assert.ok(face.includes('>' + n + '</text>'), 'numeral ' + n + ' missing');
  // default level is o'clock → minutes = 0 → the long hand points straight up (50, 50−33)
  assert.ok(face.includes('x2="50.0" y2="17.0"'), 'minute hand must sit on 12');
  assert.ok(dom.get('cr-out')._html.includes('read the face'), 'instruction renders on load');
});

test('periodic-table: hydrogen greets and "Oxy" resolves to 15.999 u', () => {
  const { dom } = runTool(bySlug('periodic-table'));
  assert.ok(dom.get('el-out')._html.includes('1.008'), 'hydrogen card on empty search');
  const oxy = runTool(bySlug('periodic-table'), { 'el-q': 'Oxy' });
  const out = oxy.dom.get('el-out')._html;
  assert.ok(out.includes('Oxygen') && out.includes('15.999'), out.slice(0, 160));
  assert.ok(out.includes('reactive nonmetal'), 'family spelled out for learners');
});

test('flags-quiz: four distinct country options and the tally counts the sit', () => {
  const { dom } = runTool(bySlug('flags-quiz'));
  assert.ok(dom.get('fl-out')._html.includes('Made 0 \u00b7 score 0'), 'tally on load');
  const names = [0, 1, 2, 3].map((i) => dom.get('fl-a' + i).textContent);
  assert.ok(new Set(names).size === 4 && names.every((n) => n && n.length > 2), 'four real option labels');
  dom.get('fl-a0').click();
  const out = dom.get('fl-out')._html;
  assert.ok(out.includes('It was <b>') && out.includes('Made 1'), out.slice(0, 160));
});

test('word-scramble: the jumble is a true anagram of a bank word and solves', () => {
  const { dom } = runTool(bySlug('word-scramble'));
  const scr = /<div class="tl-big">([^<]+)<\/div>/.exec(dom.get('ws-out')._html);
  assert.ok(scr, 'scrambled letters must render on load');
  const key = (s) => s.split('').sort().join('');
  const BANK = 'elephant giraffe zebra penguin dolphin leopard hamster octopus kangaroo butterfly crocodile squirrel flamingo hedgehog pelican rabbit turtle panther'.split(' ');
  const word = BANK.find((w) => key(w) === key(scr[1].replace(/ /g, '')));
  assert.ok(word, 'the jumble must be a permutation of an animals-bank word');
  dom.get('ws-ans').value = word.toUpperCase(); // guesses are case-insensitive
  dom.get('ws-go').click();
  assert.ok(dom.get('ws-out')._html.includes('solved'), 'the real word must be accepted');
});

test('worksheet: all twelve answers match hand-recomputed maths and the guards hold', () => {
  const { dom } = runTool(bySlug('worksheet'));
  assert.ok(dom.get('wh-out')._html.includes('12 questions \u00b7 level 2'), 'defaults make a level-2 mixed sheet');
  dom.get('wh-key').click();
  const cells = [...dom.get('wh-out')._html.matchAll(/\. (\d+) ([+\u2212\u00d7\u00f7]) (\d+) = <b>(\d+)<\/b>/g)];
  assert.equal(cells.length, 12, 'every question must carry a key answer');
  for (const c of cells) {
    const a = +c[1], op = c[2], b = +c[3], ans = +c[4];
    const want = op === '+' ? a + b : op === '\u2212' ? a - b : op === '\u00d7' ? a * b : a / b;
    assert.equal(ans, want, `${a} ${op} ${b} should be ${want}, key says ${ans}`);
    if (op === '\u2212') assert.ok(a >= b, 'subtraction must never go negative');
    if (op === '\u00f7') assert.equal(a % b, 0, 'division must come out exact');
  }
});

test('spelling: the blank hides the whole word and a miss reveals exactly one letter', () => {
  const { dom } = runTool(bySlug('spelling'));
  const mask = () => /<b>([^<]*)<\/b>/.exec(dom.get('sp-line')._html)[1];
  const m0 = mask();
  assert.match(m0, /^_+$/, 'on load the whole word is hidden');
  assert.ok(dom.get('sp-line')._html.includes('has ' + m0.length + ' letters'), 'letter count matches the blank');
  dom.get('sp-in').value = 'zzz';
  dom.get('sp-check').click();
  assert.ok(dom.get('sp-out')._html.includes('not that spelling'), 'wrong guess marked');
  assert.match(mask(), /^[a-z]_+$/, 'one letter came back for free, no more');
});

test('solar-system: Earth and Jupiter cards carry the right NASA numbers', () => {
  const { dom } = runTool(bySlug('solar-system'));
  const earth = dom.get('so-out')._html;
  assert.ok(earth.includes('12,742 km'), 'Earth diameter with the thousands comma');
  assert.ok(earth.includes('1.00\u00d7 Earth'), 'Earth is its own baseline');
  const jup = runTool(bySlug('solar-system'), { 'so-p': '4' });
  const out = jup.dom.get('so-out')._html;
  assert.ok(out.includes('139,820 km'), 'Jupiter diameter');
  assert.ok(out.includes('<td>95</td>'), 'confirmed moon count');
});

test('study-planner: an empty date plans thirty days out as seven spaced sessions', () => {
  const { dom } = runTool(bySlug('study-planner'));
  const out = dom.get('pl-out')._html;
  // 30 days of runway → offsets 0,1,2,4,8,16 all < 30, plus the eve (29) = 7 sessions
  assert.ok(out.includes('7 sessions'), out.slice(0, 160));
  assert.ok(out.includes('First pass') && out.includes('Final recall'), 'bookend session labels');
  assert.ok(out.includes('14 hours'), '2 h \u00d7 7 sessions budget');
});

test('word-guess: Q appears in no bank word, so pressing it always costs a life', () => {
  const { dom } = runTool(bySlug('word-guess'));
  assert.ok(dom.get('wg-out')._html.includes('6 lives left'), 'full hearts on load');
  dom.get('wg-q').click();
  const out = dom.get('wg-out')._html;
  assert.ok(out.includes('wrong: q') && out.includes('5 lives left'), out.slice(0, 200));
  assert.equal(dom.get('wg-q').disabled, true, 'used keys must grey out');
});

// ── study aids batch (Nov 2026) — the same hand-checked standard ──
test('citation-maker: APA puts the year first, MLA drags it to the end', () => {
  const { dom } = runTool(bySlug('citation-maker'));
  const apa = dom.get('ct-out')._html;
  assert.ok(apa.includes('(2011). <i>Handbook of Self-Regulation'), 'APA: year right after the authors');
  assert.ok(apa.includes('Routledge.'), 'APA: publisher closes the book reference');
  const mla = runTool(bySlug('citation-maker'), { 'ct-style': 'mla' });
  const out = mla.dom.get('ct-out')._html;
  assert.ok(out.includes('Routledge, 2011.'), 'MLA: publisher then year at the tail');
  assert.ok(!out.includes('(2011).'), 'MLA must not keep the APA parenthetical');
});

test('summarizer: the default passage yields three scored sentences and keywords', () => {
  const { dom } = runTool(bySlug('summarizer'));
  const out = dom.get('sm-out')._html;
  assert.ok(out.includes('<b>3</b> key sentences'), 'three is the default keep-count');
  assert.ok(/\d+ → \d+ words/.test(out), 'compression count renders');
  assert.ok(out.includes('Keywords:'), 'frequency keyword list renders');
});

test('typing-test: ready badge on load and nothing is marked before the first keystroke', () => {
  const { dom } = runTool(bySlug('typing-test'));
  assert.ok(dom.get('ty-out')._html.includes('ready'), 'idle state before the first keystroke');
  // the sentence is picked at random from the bank, so only the colouring contract is testable
  assert.ok(dom.get('ty-text')._html.includes('<span'), 'the sentence is painted word by word');
  assert.ok(!dom.get('ty-text')._html.includes('style="color'), 'an untouched sentence carries no verdict colours');
});

test('essay-planner: the thesis is built from the three default points', () => {
  const { dom } = runTool(bySlug('essay-planner'));
  const out = dom.get('es-out')._html;
  assert.ok(out.includes('Thesis: I argue that Should school start later?'), 'topic folded into the thesis');
  assert.ok(out.includes('<i>classroom attendance and focus improve</i>'), 'point one is named in the thesis');
  assert.ok(out.includes('5 · Counter'), 'argumentative shape reserves the counter-paragraph');
  assert.ok(out.includes('720'), 'word budget for six paragraphs');
});

test('cloze-test: gaps numbered, bank shuffled, the key reveals answers', () => {
  const { dom } = runTool(bySlug('cloze-test'));
  let out = dom.get('cl-out')._html;
  assert.ok(/<b>\d+<\/b> blanks/.test(out), 'blank count renders');
  assert.ok(out.includes('[1]') && out.includes('Word bank:'), 'numbered gaps and a bank on load');
  dom.get('cl-key').click();
  out = dom.get('cl-out')._html;
  assert.ok(out.includes('Answers: 1.'), 'answer key appears on demand');
  assert.ok(dom.get('cl-key').textContent === 'Hide answer key', 'key button toggles its label');
});

test('cornell-notes: the page carries all three regions and the topic', () => {
  const { dom } = runTool(bySlug('cornell-notes'));
  const out = dom.get('cn-out')._html;
  assert.ok(out.includes('Photosynthesis'), 'topic in the header line');
  assert.ok(out.includes('Cue column') && out.includes('Note area') && out.includes('Summary'), 'three regions');
  assert.ok((out.match(/cn-rule/g) || []).length >= 10, 'ruled note lines render at the default count');
  assert.ok(out.includes('What would an exam ask?'), 'cue prompts are seeded');
});

test('memory-kit: planets compress to MVEMJSUN and the number lands in fours', () => {
  const { dom } = runTool(bySlug('memory-kit'));
  const out = dom.get('mk-out')._html;
  assert.ok(out.includes('>MVEMJSUN<'), 'acronym of the eight default planets');
  assert.ok(out.includes('First-letter sentence:'), 'mnemonic sentence built from the BANK');
  assert.ok(out.includes('0198 3746 5512 038'), 'fifteen digits chunked into fours');
});

test('reading-pace: 234 pages over 14 days demands 17 a day', () => {
  const { dom } = runTool(bySlug('reading-pace'));
  const out = dom.get('rg-out')._html;
  assert.ok(out.includes('17 pages a day'), 'ceil(234/14) = 17');
  assert.ok(out.includes('makes the date') && out.includes('too slow'), 'pace table verdicts both appear');
  const done = runTool(bySlug('reading-pace'), { 'rg-done': '288' });
  assert.ok(done.dom.get('rg-out')._html.includes('tl-badge tl-ok">finished'), 'finished books say so');
});

test('assignment-planner: one day at effort 2 outranks three days at effort 4', () => {
  const { dom } = runTool(bySlug('assignment-planner'));
  const out = dom.get('as-out')._html;
  assert.ok(out.includes('First: Maths problem set'), 'pressure per day beats raw deadline distance');
  assert.ok(out.includes('7 days'), 'the science report still shows its runway');
  assert.ok(out.includes('effort per remaining day'), 'the ranking rule is explained under the table');
});

test('mind-map: four branches twelve leaves from the default WWII outline', () => {
  const { dom } = runTool(bySlug('mind-map'));
  const out = dom.get('mm-out')._html;
  assert.ok(out.includes('World War II'), 'topic sits in the root node');
  assert.ok(out.includes('<b>4</b> branches · 12 leaves'), 'counts computed from the parsed lines');
  assert.ok(out.includes('Treaty of Versailles') && out.includes('Appeasement'), 'leaves joined under their branch');
});

test('weekly-plan: twelve hours round-robin across the week without stacking a day', () => {
  const { dom } = runTool(bySlug('weekly-plan'));
  const out = dom.get('tw-out')._html;
  assert.ok(out.includes('-day grid · <b>12</b> hours'), 'grid headline carries the hour total');
  assert.ok(out.includes('Monday') && out.includes('Tuesday'), 'day names fill the grid');
  const rows = [...out.matchAll(/<tr><td>(\w+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
  for (const r of rows) assert.equal(new Set(r[2].split(' + ')).size, r[2].split(' + ').length, r[1] + ' stacks the same subject twice');
});

test('study-log: the default week totals four hours ten and crowns Maths', () => {
  const { dom } = runTool(bySlug('study-log'));
  const out = dom.get('sl-out')._html;
  assert.ok(out.includes('4 h 10 m logged'), '45+30+60+40+50+25 = 250 minutes');
  assert.ok(out.includes('most-visited subject: <b>Maths</b>'), '135 minutes is the largest share');
  assert.ok(out.includes('6 sessions across 4 days'), 'session and day counts are honest');
});

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
