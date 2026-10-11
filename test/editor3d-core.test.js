'use strict';
// Ujian enjin matematik/geometry /3d — fungsi tulen diekstrak terus dari
// public/3d.html (sumber sebenar yang dihantar ke pelayar) lalu dijalankan
// dalam sandbox new Function. Tiada WebGL/DOM diperlukan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', '3d.html'), 'utf8');

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

// Konstanta satu-baris (`const clamp=...`) juga diekstrak dari sumber sebenar.
function extractConst(src, name) {
  const re = new RegExp('^const ' + name + '=.*$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('konstanta tidak ditemui: ' + name);
  return m[0];
}

const FNS = [
  'm4id', 'm4mul', 'm4T', 'm4S', 'm4Rx', 'm4Ry', 'm4Rz', 'm4persp', 'm4lookAt', 'm4inv',
  'tv4', 'tp', 'td', 'bbr', 'lerp3', 'evalKeys', 'decomp', 'shadowA', 'distToSeg', 'axisU', 'hex',
  'parseSTL', 'parseOBJ'
];
const code = [
  extractConst(html, 'clamp'),
  extractConst(html, 'DEG'),
  extractConst(html, 'lerp'),
  ...FNS.map((n) => extractFn(html, n))
].join('\n\n');

function makeEngine() {
  const factory = new Function(`
    'use strict';
    ${code}
    return { ${FNS.join(', ')} };
  `);
  return factory();
}

const e = makeEngine();
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const close = (arr, exp, eps = 1e-4) => { arr.forEach((v, i) => near(v, exp[i], eps)); };

// ── Algebra m4 ──
test('m4mul: identitas kiri/kanan mengekalkan matriks', () => {
  const M = e.m4mul(e.m4T(1, 2, 3), e.m4S(2, 3, 4));
  close(Array.from(e.m4mul(e.m4id(), M)), Array.from(M));
  close(Array.from(e.m4mul(M, e.m4id())), Array.from(M));
});

test('tp/m4T: transform titik setempat → dunia', () => {
  close(e.tp(e.m4T(1, 2, 3), [0, 0, 0]), [1, 2, 3]);
  close(e.tp(e.m4T(1, 2, 3), [5, -5, 10]), [6, -3, 13]);
});

test('m4Rx/m4Ry: putaran 90° paksi piawai (column-major)', () => {
  const H = Math.PI / 2;
  close(e.tp(e.m4Rx(H), [0, 1, 0]), [0, 0, 1], 1e-6);   // y → +z
  close(e.tp(e.m4Ry(H), [0, 0, 1]), [1, 0, 0], 1e-6);   // z → +x
});

test('td: arah (bukan titik) tanpa terjemahan/scale-sum', () => {
  close(e.td(e.m4S(2, 3, 4), [1, 1, 1]), [2, 3, 4]);
  close(e.td(e.m4T(9, 9, 9), [1, 0, 0]), [1, 0, 0]); // terjemahan tak guna pada arah
});

test('m4inv: M·M⁻¹ ≈ identitas (TRS dengan skala & putaran)', () => {
  const M = e.m4mul(e.m4T(1, 2, 3), e.m4mul(e.m4Ry(0.6), e.m4S(2, 3, 4)));
  const P = e.m4mul(M, e.m4inv(M));
  const I = Array.from(e.m4id());
  close(Array.from(P), I, 1e-4);
});

test('m4lookAt: titik asal dilihat dari z=+5 → z=-5 dalam ruang kamera', () => {
  const view = e.m4lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  close(e.tp(view, [0, 0, 0]), [0, 0, -5]);
  close(e.tp(view, [1, 2, 0]), [1, 2, -5]);
});

test('m4persp: titik pada satah dekat → z NDC ≈ -1, w ≈ 1', () => {
  const proj = e.m4persp(Math.PI / 2, 1, 1, 100);
  const c = e.tv4(proj, [0, 0, -1, 1]);
  near(c[3], 1);
  near(c[2] / c[3], -1);
});

// ── decomp (sign Euler — pernah jadi jebakan) ──
test('decomp: bulat-penuh TRS (Rz sahaja) balik kepada matriks asal', () => {
  const DEG = Math.PI / 180;
  const M = e.m4mul(e.m4T(1, 2, 3), e.m4mul(e.m4Rz(30 * DEG), e.m4S(2, 3, 4)));
  const d = e.decomp(M);
  close(d.loc, [1, 2, 3]);
  close(d.scl, [2, 3, 4]);
  close(d.rot, [0, 0, 30], 1e-3);
  const rebuilt = e.m4mul(e.m4T(...d.loc), e.m4mul(e.m4Rz(d.rot[2] * DEG), e.m4S(...d.scl)));
  close(Array.from(rebuilt), Array.from(M), 1e-3);
});

test('decomp: rotaksi paksi-X sahaja → x darjah, y/z sifar', () => {
  const DEG = Math.PI / 180;
  const d = e.decomp(e.m4mul(e.m4Rx(45 * DEG), e.m4S(1, 1, 1)));
  near(d.rot[0], 45, 1e-3);
  near(d.rot[1], 0);
  near(d.rot[2], 0);
});

// ── Keyframe ──
test('evalKeys: isipadu nilainya ikut bingkai (sort + kitaran tepi)', () => {
  const o = { keys: [
    { f: 10, loc: [10, 0, 0], rot: [0, 0, 0], scl: [2, 2, 2] },
    { f: 0, loc: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] } // sengaja tak tersusun
  ] };
  const mid = e.evalKeys(o, 5);
  close(mid.loc, [5, 0, 0]);
  close(mid.scl, [1.5, 1.5, 1.5]);
  close(e.evalKeys(o, -3).loc, [0, 0, 0]);   // clamp awal
  close(e.evalKeys(o, 99).loc, [10, 0, 0]);  // clamp akhir
  assert.equal(e.evalKeys({ keys: [] }, 1), null);
  assert.equal(e.evalKeys({}, 1), null);
});

// ── Pick/gizmo math ──
test('distToSeg: jarak titik ke segmen (dalam & hujung clamp)', () => {
  near(e.distToSeg(0, 0, 1, 0, 1, 10), 1);        // sisi
  near(e.distToSeg(5, 20, 0, 0, 0, 10), Math.hypot(5, 10)); // melepasi hujung → clamp t=1
  near(e.distToSeg(3, 4, 3, 4, 9, 9), 0);         // pada hujung
  near(e.distToSeg(1, 1, 2, 2, 2, 2), Math.SQRT2); // segmen panjang-0
});

test('axisU: sinar selari paksi → jatuh ke dd (elak bahagi-0)', () => {
  const dd = e.axisU([0, 5, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0]);
  near(dd, 5);
  const ok = e.axisU([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]);
  near(ok, 0);
});

test('shadowA: suram ikut ketinggian, clamp [0.06, 0.38]', () => {
  assert.equal(e.shadowA(0), 0.38);
  assert.equal(e.shadowA(20), 0.06);
  assert.equal(e.shadowA(-5), 0.38);
});

// ── hex warna ──
test('hex: #rgb kembang & #rrggbb → [0..1]', () => {
  close(e.hex('#fff'), [1, 1, 1]);
  close(e.hex('#ff0000'), [1, 0, 0]);
  close(e.hex('#7fd1ff'), [0x7f / 255, 0xd1 / 255, 1]);
});

test('bbr: radius bounding sphere daripada posisi', () => {
  assert.equal(e.bbr([0, 0, 0, 3, 4, 0]), 5);
  assert.equal(e.bbr([]), 0);
});

// ── Parser STL ──
test('parseSTL: ASCII satu segi tiga', () => {
  const txt = 'solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid s\n';
  const g = e.parseSTL(new TextEncoder().encode(txt));
  assert.equal(g.ix.length, 3);
  assert.equal(g.p.length, 9);
  close(g.n.slice(0, 3), [0, 0, 1]);
});

test('parseSTL: binary header+1 tri (50 bait) dihurai betul', () => {
  const buf = new ArrayBuffer(84 + 50);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  const put = (off, vals) => vals.forEach((v, i) => dv.setFloat32(off + i * 4, v, true));
  put(84, [0, 0, 1]);                       // normal
  put(96, [0, 0, 0]); put(108, [1, 0, 0]); put(120, [0, 1, 0]);
  const g = e.parseSTL(new Uint8Array(buf));
  assert.equal(g.ix.length, 3);
  close(g.p.slice(0, 9), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  close(g.n.slice(0, 3), [0, 0, 1]);
});

// ── Parser OBJ ──
test('parseOBJ: kuad → 2 segi tiga, normal unit hasil cross', () => {
  const txt = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  const g = e.parseOBJ(txt);
  assert.equal(g.ix.length, 6);           // 2 tri
  assert.equal(g.p.length, 18);
  for (let i = 0; i < g.n.length; i += 3) close(g.n.slice(i, i + 3), [0, 0, 1]);
});

test('parseOBJ: indeks negatif (kira dari akhir) diterima', () => {
  const txt = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n';
  const g = e.parseOBJ(txt);
  assert.equal(g.ix.length, 3);
  close(g.p.slice(0, 3), [0, 0, 0]);
});
