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
