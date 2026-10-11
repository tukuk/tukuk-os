'use strict';
// Ujian enjin /editor-video — fungsi math/parsing diekstrak terus dari
// public/editor-video.html (sumber sebenar yang dihantar ke pelayar) lalu
// dijalankan dalam sandbox new Function (tiada pelayar diperlukan).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor-video.html'), 'utf8');

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('fungsi tidak ditemui: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('kurung tak seimbang: ' + name);
}

const names = ['fmt', 'filterStr', 'computeOut', '_gray', '_sobel'];
const code = names.map((n) => extractFn(html, n)).join('\n');

// Global yang dirujuk fungsi disuntik sebagai parameter sandbox.
function makeEngine(rot = 0, aspect = null, MAX_OUT = 1280, F = {}) {
  const factory = new Function('rot', 'aspect', 'MAX_OUT', 'F', `
    'use strict';
    ${code}
    return { fmt, filterStr, computeOut, _gray, _sobel };
  `);
  return factory(rot, aspect, MAX_OUT, F);
}

const DEFAULT_F = { bright: 100, contrast: 100, saturate: 100, sepia: 0, gray: 0, hue: 0, blur: 0 };

// ── fmt ──
test('fmt: detik → m:ss dengan clamp negatif', () => {
  const e = makeEngine();
  assert.equal(e.fmt(0), '0:00');
  assert.equal(e.fmt(65), '1:05');
  assert.equal(e.fmt(59.9), '0:59');   // floor via |0
  assert.equal(e.fmt(-3), '0:00');
  assert.equal(e.fmt(3600), '60:00');
});

// ── _gray ──
test('_gray: luma ITU-R (putih→255, merah→29.9)', () => {
  const e = makeEngine();
  assert.ok(Math.abs(e._gray(255, 255, 255) - 255) < 1e-6);
  assert.equal(e._gray(0, 0, 0), 0);
  assert.ok(Math.abs(e._gray(100, 0, 0) - 29.9) < 1e-6);
});

// ── _sobel ──
test('_sobel: rata → 0, tepi menegak → magnitud tinggi, sempadan kekal 0', () => {
  const e = makeEngine();
  const flat = new Float32Array(9).fill(100);
  assert.equal(e._sobel(flat, 3, 3)[4], 0);
  const edge = new Float32Array([0, 0, 255, 0, 0, 255, 0, 0, 255]);
  const out = e._sobel(edge, 3, 3);
  assert.ok(out[4] > 1000);           // Gx=1020, Gy=510 → ~1140
  assert.equal(out[0], 0);            // sempadan tidak disentuh
});

// ── computeOut ──
test('computeOut: 1080p → 1280×720 (had MAX_OUT, nisbah kekal)', () => {
  const e = makeEngine(0, null, 1280);
  const [ow, oh] = e.computeOut(1920, 1080);
  assert.equal(ow, 1280);
  assert.equal(oh, 720);
});
test('computeOut: rotasi 90° tukar dimensi (potret)', () => {
  const e = makeEngine(90, null, 1280);
  const [ow, oh] = e.computeOut(1920, 1080);
  assert.equal(ow, 720);
  assert.equal(oh, 1280);
});
test('computeOut: aspectOverride 1 → segi sama; input kecil tidak dibesar luar 2', () => {
  const e = makeEngine(0, 1, 1280);
  assert.deepEqual(e.computeOut(1920, 1080), [1280, 1280]);
  const e2 = makeEngine(0, null, 1280);
  const [ow, oh] = e2.computeOut(1, 1); // sangat kecil → clamp minimum 2
  assert.ok(ow >= 2 && oh >= 2);
});

// ── filterStr ──
test('filterStr: CSS filter ikut F; blur hanya bila > 0 (skala tinggi)', () => {
  const e = makeEngine(0, null, 1280, { ...DEFAULT_F });
  assert.equal(e.filterStr(720), 'brightness(100%) contrast(100%) saturate(100%) sepia(0%) grayscale(0%) hue-rotate(0deg)');
  const eb = makeEngine(0, null, 1280, { ...DEFAULT_F, blur: 50 });
  assert.ok(eb.filterStr(720).includes('blur(360.0px)')); // 50/100*720
  assert.ok(!e.filterStr(720).includes('blur'));
});
