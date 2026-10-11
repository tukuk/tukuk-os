'use strict';
// Ujian enjin garis masa /movie. Fungsi math diekstrak terus dari
// public/movie.html (sumber yang benar-benar dihantar ke pelayar) lalu
// dijalankan dalam sandbox dengan DOM di-stub — jadi perlakuan
// cross-dissolve/trim teruji tanpa perlu pelayar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'movie.html'), 'utf8');

// Ambil satu `function NAMA(...) { ... }` lengkap dengan pengiraan kurung.
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

const names = ['clipLen', 'findAt', 'coveringClips', 'edgeAlpha', 'sampleKF', 'buildTimeline'];
const code = names.map((n) => extractFn(html, n)).join('\n');

// $() mengembalikan objek lempung (penetapan .max/.textContent dibuang);
// drawRuler/renderTrack/renderTitleLane/updateTransport = no-op.
function makeEngine() {
  const $stub = () => ({ clientWidth: 1200, textContent: '', max: '', hidden: false, style: {}, value: '' });
  const nofn = () => {};
  const factory = new Function('$', 'drawRuler', 'renderTrack', 'renderTitleLane', 'updateTransport', 'PPS_BASE', 'fmt', 'cvs', `
    let clips = [], starts = [], total = 0, PPS = PPS_BASE;
    ${code}
    return {
      setClips: (v) => { clips = v; },
      buildTimeline: () => buildTimeline(),
      clipLen, findAt, coveringClips, edgeAlpha, sampleKF,
      peek: () => ({ starts: starts.slice(), total, PPS }),
    };
  `);
  return factory($stub, nofn, nofn, nofn, nofn, 48, (s) => String(s), { width: 1280, height: 720 });
}

const vid = (over = {}) => Object.assign(
  { id: 'c', kind: 'video', name: 'v', in: 0, out: 5, dur: 0, srcDur: 5, speed: 1, trans: 0, transType: 'dissolve' },
  over
);

test('clipLen: gambar ikut dur; video ikut (out-in)/speed', () => {
  const e = makeEngine();
  assert.equal(e.clipLen({ kind: 'image', dur: 4 }), 4);
  assert.equal(e.clipLen({ kind: 'image' }), 3); // fallback default
  assert.equal(e.clipLen(vid({ in: 1, out: 4, speed: 1 })), 3);
  assert.equal(e.clipLen(vid({ in: 0, out: 6, speed: 2 })), 3); // 6/2
});

test('edgeAlpha: fade linear masuk/keluar ke hitam', () => {
  const e = makeEngine();
  const c = vid({ fade: 2, out: 5, srcDur: 5 }); // len 5
  assert.ok(Math.abs(e.edgeAlpha(c, 1) - 0.5) < 1e-9); // dIn 1/2
  assert.ok(Math.abs(e.edgeAlpha(c, 2.5) - 1) < 1e-9); // tengah → penuh
  assert.ok(Math.abs(e.edgeAlpha(c, 4) - 0.5) < 1e-9); // dOut (5-4)/2
});

test('sampleKF: interpolasi linear & clamp di hujung', () => {
  const e = makeEngine();
  assert.equal(e.sampleKF([], 1), null);
  const kfs = [{ t: 0, x: 10, y: 10, s: 1, a: 1 }, { t: 2, x: 20, y: 30, s: 2, a: 0 }];
  const mid = e.sampleKF(kfs, 1);
  assert.equal(mid.x, 15);
  assert.equal(mid.y, 20);
  assert.equal(mid.s, 1.5);
  assert.equal(mid.a, 0.5);
  assert.equal(e.sampleKF(kfs, -1).x, 10); // clamp awal
  assert.equal(e.sampleKF(kfs, 99).x, 20); // clamp akhir
});

test('buildTimeline: tindanan cross-dissolve singkat jumlah durasi', () => {
  const e = makeEngine();
  e.setClips([vid({ trans: 0 }), vid()]); // dua klip 5s, tanpa transisi
  e.buildTimeline();
  assert.deepEqual(e.peek().starts, [0, 5]);
  assert.equal(e.peek().total, 10);

  e.setClips([vid({ trans: 1 }), vid()]); // transisi 1s pada klip pertama
  e.buildTimeline();
  assert.deepEqual(e.peek().starts, [0, 4]); // 5 - 1 overlap
  assert.equal(e.peek().total, 9); // disahkan di pelayar: 0:10 → 0:09
});

test('buildTimeline: overlap terhad ≤ 60% panjang klip', () => {
  const e = makeEngine();
  e.setClips([vid({ trans: 1.5, out: 1, srcDur: 1 }), vid({ out: 1, srcDur: 1 })]); // klip 1s
  e.buildTimeline();
  // ov = min(1.5, 1*0.6, 1*0.6) = 0.6 → starts[1] = 1 - 0.6 = 0.4
  assert.ok(Math.abs(e.peek().starts[1] - 0.4) < 1e-9);
});

test('coveringClips: dua klip meliputi semasa tindanan, satu di luar', () => {
  const e = makeEngine();
  e.setClips([vid({ trans: 1 }), vid()]);
  e.buildTimeline(); // starts [0,4], total 9
  assert.equal(e.coveringClips(2).length, 1); // hanya klip 0
  assert.equal(e.coveringClips(4.5).length, 2); // tindanan [4,5)
  assert.equal(e.coveringClips(6).length, 1); // hanya klip 1
});

test('findAt: clamp di sempadan akhir ke klip terakhir', () => {
  const e = makeEngine();
  e.setClips([vid({ trans: 1 }), vid()]);
  e.buildTimeline();
  const atEnd = e.findAt(9);
  assert.equal(atEnd.index, 1);
  assert.equal(e.findAt(-5).index, 0);
});
