'use strict';
// Ujian enjin /editor (imej) — math tulen diekstrak verbatim dari
// public/editor.html (sumber sebenar yang dihantar ke pelayar) dan berjalan
// dalam sandbox new Function. Global dirujuk melalui parameter suntikan.
// Nota: studio.html ialah DOM-glue tulen (tiada math tulen) — sengaja tiada ujian.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.html'), 'utf8');

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

const FNS = ['filterString', 'getFontFamily', 'cloneStroke', 'curveT', '_gray', '_boxBlurU8', '_boxBlurF32', '_solve8', '_computeH', '_inv3'];
const code = FNS.map((n) => extractFn(html, n)).join('\n\n');

function makeEngine(F, curveP = { x: 0.5, y: 0.5 }) {
  const factory = new Function('F', 'curveP', `
    'use strict';
    ${code}
    return { ${FNS.join(', ')} };
  `);
  return factory(F, curveP);
}

const DEF_F = { bright: 100, contrast: 100, saturate: 100, sepia: 0, gray: 0, hue: 0, blur: 0, invert: 0 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// ── filterString ──
test('filterString: 7 komponen CSS ikut tertib; blur berskala tinggi punca', () => {
  const e = makeEngine({ ...DEF_F });
  assert.equal(e.filterString(800),
    'brightness(100%) contrast(100%) saturate(100%) sepia(0%) grayscale(0%) hue-rotate(0deg) invert(0%)');
  assert.ok(!e.filterString(800).includes('blur'));
  const eb = makeEngine({ ...DEF_F, blur: 25 });
  assert.ok(eb.filterString(800).includes('blur(200.0px)')); // 25/100*800
});

// ── getFontFamily / cloneStroke ──
test('getFontFamily: lima galur + jatuh ke sans untuk tak diketahui', () => {
  const e = makeEngine({ ...DEF_F });
  assert.ok(e.getFontFamily('serif').includes('Georgia'));
  assert.ok(e.getFontFamily('mono').includes('Courier'));
  assert.ok(e.getFontFamily('impact').includes('Impact'));
  assert.ok(e.getFontFamily('script').includes('Caveat'));
  assert.equal(e.getFontFamily('tiada'), e.getFontFamily('sans'));
});

test('cloneStroke: salin dangkal + array filter disalin dalam', () => {
  const e = makeEngine({ ...DEF_F });
  const s = { pts: [1, 2], f: ['a', 'b'] };
  const c = e.cloneStroke(s);
  assert.notEqual(c.f, s.f);
  assert.deepEqual(c.f, s.f);
});

// ── curveT ──
test('curveT: kendali (0.5,0.5) → identiti; sentiasa dalam [0,1]', () => {
  const e = makeEngine({ ...DEF_F }, { x: 0.5, y: 0.5 });
  for (const x of [0, 0.25, 0.5, 0.75, 1]) near(e.curveT(x), x, 1e-9);
  const bright = makeEngine({ ...DEF_F }, { x: 0.25, y: 0.75 });
  assert.ok(bright.curveT(0.5) > 0.5); // lengkungan naik
  for (let i = 0; i <= 20; i++) { const v = bright.curveT(i / 20); assert.ok(v >= 0 && v <= 1); }
  near(bright.curveT(0), 0, 1e-9);
  near(bright.curveT(1), 1, 1e-9);
});

// ── Penghurai sistem 8×8 + homografi (perspective warp) ──
test('_solve8: 8X = I → X = I; sistem singular → null', () => {
  const e = makeEngine({ ...DEF_F });
  const I8 = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (i === j ? 1 : 0)));
  const sol = e._solve8(I8, [1, 2, 3, 4, 5, 6, 7, 8]);
  sol.forEach((v, i) => near(v, i + 1, 1e-6));
  assert.equal(e._solve8(Array.from({ length: 8 }, () => Array(8).fill(0)), [1, 0, 0, 0, 0, 0, 0, 0]), null);
});

test('_computeH: padanan identiti → H ≈ [1,0,0,0,1,0,0,0,1]', () => {
  const e = makeEngine({ ...DEF_F });
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const H = e._computeH(pts, pts.map((p) => ({ ...p })));
  assert.ok(H);
  H.forEach((v, i) => near(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-6));
});

test('_computeH: pemetaan bukan-trivial → H sah (9 terbitan, h9=1)', () => {
  const e = makeEngine({ ...DEF_F });
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const dst = [{ x: 1, y: 0 }, { x: 11, y: 1 }, { x: 9, y: 11 }, { x: -1, y: 9 }];
  const H = e._computeH(src, dst);
  assert.ok(H && H.length === 9);
  near(H[8], 1);
});

test('_inv3: M·M⁻¹ = I; singular → null; bulat-penuh', () => {
  const e = makeEngine({ ...DEF_F });
  const M = [[2, 0, 1], [0, 3, 0], [1, 0, 2]];
  const Mi = e._inv3(M);
  const P = M.map((row, i) => row.map((_, j) => M[i].reduce((s, v, k) => s + v * Mi[k][j], 0)));
  P.forEach((row, i) => row.forEach((v, j) => near(v, i === j ? 1 : 0, 1e-9)));
  const round = e._inv3(Mi);
  round.forEach((row, i) => row.forEach((v, j) => near(v, M[i][j], 1e-9)));
  assert.equal(e._inv3([[1, 2, 3], [2, 4, 6], [1, 1, 1]]), null); // baris 2 = 2× baris 1
});

// ── Kernel blur (kekerasan pixel) ──
test('_gray: luma ITU-R putih→255', () => {
  const e = makeEngine({ ...DEF_F });
  near(e._gray(255, 255, 255), 255);
  assert.equal(e._gray(0, 0, 0), 0);
});

test('_boxBlurU8: kawasan malar kekal (stride RGBA), alpha tulis 255', () => {
  const e = makeEngine({ ...DEF_F });
  const W = 5, H = 5, src = new Uint8ClampedArray(W * H * 4).fill(100);
  const out = e._boxBlurU8(src, W, H, 1, 1);
  const mid = (2 * W + 2) * 4;                     // pixel tengah, RGBA stride
  near(out[mid], 100, 1e-6);                       // purata malar → kekal
  near(out[0], 100, 1e-6);                         // sempadan clamp-edge dinormalkan betul
  assert.equal(out[mid + 3], 255);                 // alpha ditulis semula
});

test('_boxBlurF32: satu impuls → nilai tersebar ~1/(2r+1)²', () => {
  const e = makeEngine({ ...DEF_F });
  const W = 5, H = 5, src = new Float32Array(25); src[2 * W + 2] = 49;
  const out = e._boxBlurF32(src, W, H, 1, 1);
  assert.ok(out[2 * W + 2] > 0 && out[2 * W + 2] < 49);
  assert.ok(out[2 * W + 1] > 0); // jiran menerima sebaran
});
