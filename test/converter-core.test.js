'use strict';
// Ujian Penukar Media (/converter). Pembantu MURNI (buildArgs/outName/fmtBytes)
// diekstrak verbatim dari public/converter.html — sumber sebenar yang dihantar ke
// pelayar — lalu dijalankan dalam sandbox `new Function`. Wayar pelayan (route
// /converter) + pemuat ffmpeg diperiksa sebagai teks. Tiada pelayar/ffmpeg dimuatkan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'converter.html'), 'utf8');
const srv = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

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

const code = ['outName', 'fmtBytes', 'buildArgs'].map((n) => extractFn(html, n)).join('\n\n');
const E = new Function(`${code}\nreturn { outName, fmtBytes, buildArgs };`)();

// ── outName ──
test('outName: buang sambungan, tambah .mp3/.mp4; kekalkan titik dalam nama', () => {
  assert.equal(E.outName('lagu.mp4', 'mp3'), 'lagu.mp3');
  assert.equal(E.outName('klip.mov', 'mp4'), 'klip.mp4');
  assert.equal(E.outName('rek.a.b.bcd', 'mp3'), 'rek.a.b.mp3', 'hanya sambungan terakhir dibuang');
  assert.equal(E.outName('tiada_ext', 'mp4'), 'tiada_ext.mp4');
  assert.equal(E.outName('', 'mp3'), 'output.mp3', 'kosong → fallback');
});

// ── fmtBytes ──
test('fmtBytes: B/KB/MB/GB, satu perpuluhan', () => {
  assert.equal(E.fmtBytes(0), '0 B');
  assert.equal(E.fmtBytes(512), '512 B');
  assert.equal(E.fmtBytes(2048), '2 KB');
  assert.equal(E.fmtBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(E.fmtBytes(3 * 1024 * 1024 * 1024), '3 GB');
  assert.equal(E.fmtBytes('bukan angka'), '0 B');
});

// ── buildArgs: MP3 ──
test('buildArgs mp3: buang video (-vn), libmp3lame + kadar bit + resample', () => {
  const a = E.buildArgs('mp3', { bitrate: 320 }, 'in.mov', 'out.mp3');
  assert.equal(a[0], '-i');
  assert.ok(a.includes('-vn'), 'video dibuang untuk audio-murni');
  assert.ok(a.includes('libmp3lame'), 'penyahkod MP3');
  assert.ok(a.includes('320k'), 'kadar bit dipatuhi');
  assert.equal(a[a.length - 1], 'out.mp3');
  // Lalai 192k apabila tiada pilihan.
  assert.ok(E.buildArgs('mp3', {}, 'i', 'o.mp3').includes('192k'));
});

// ── buildArgs: MP4 ──
test('buildArgs mp4: libx264 + preset/crf + aac + faststart; -vf hanya bila skala', () => {
  const base = E.buildArgs('mp4', { preset: 'medium', crf: 20 }, 'in.webm', 'out.mp4');
  assert.ok(base.includes('libx264'), 'penyahkod H.264');
  assert.ok(base.includes('medium') && base.includes('20'), 'preset + crf');
  assert.ok(base.includes('aac') && base.includes('yuv420p'), 'audio aac + pix_fmt untuk pemutar umum');
  assert.ok(base.includes('+faststart'), 'streaming-friendly');
  assert.ok(!base.includes('-vf'), 'tiada penapis bila kekal asal');
  assert.equal(base[base.length - 1], 'out.mp4');

  const scaled = E.buildArgs('mp4', { scale: 1280 }, 'in.mkv', 'out.mp4');
  const vi = scaled.indexOf('-vf');
  assert.ok(vi > 0, 'penapis skala ditambah');
  assert.equal(scaled[vi + 1], 'scale=1280:-2', 'tinggi auto (-2) kekalkan nisbah');
});

// ── Wayar pelayan: route + pemacu ffmpeg wujud ──
test('Route /converter didaftarkan sebagai halaman statik', () => {
  const line = srv.split('\n').find((l) => l.includes('const STATIC_PAGES'));
  assert.ok(line && line.includes("'converter'"), 'converter dalam senarai STATIC_PAGES');
});

test('converter.html: pemacu ffmpeg.wasm + argpenyahkod + lazy-load + UI', () => {
  assert.ok(html.includes('@ffmpeg/ffmpeg') && html.includes('@ffmpeg/core'), 'rujuk pustaka ffmpeg.wasm');
  assert.ok(html.includes('libmp3lame') && html.includes('libx264'), 'penyahkod mp3 & mp4 ada');
  assert.ok(html.includes('function ensureEngine'), 'pemuat enjin lazy wujud');
  assert.ok(html.includes('ffmpeg-core.wasm'), 'intipati wasm dimuat (single-thread)');
  // Regresi: worker kelas ffmpeg MESTI dijadikan blob same-origin (classWorkerURL) — jika
  // tidak, Chrome tolak new Worker silang-asal → penukaran gagal pada runtime.
  assert.ok(html.includes('classWorkerURL') && html.includes('814.ffmpeg.js'), "classWorkerURL blob (elak 'Failed to construct Worker')");
  // Regresi punca 'failed to import ffmpeg-core.js': core/wasm = build ESM MENTAH (bukan blob,
  // bukan UMD). importScripts ditolak dlm worker-blob → fallback `import(esm).default` yang lulus.
  assert.ok(/coreBase:\s*'https:\/\/unpkg\.com\/@ffmpeg\/core@[\d.]+\/dist\/esm'/.test(html), 'coreBase = /dist/esm (dynamic-import jalan)');
  assert.ok(/coreURL:\s*CDN\.coreBase \+ '\/ffmpeg-core\.js'/.test(html), 'coreURL = https mentah (bukan blob)');
  assert.ok(/wasmURL:\s*CDN\.coreBase \+ '\/ffmpeg-core\.wasm'/.test(html), 'wasmURL = https mentah (bukan blob)');
  assert.ok(!/coreURL:\s*await toBlobURL/.test(html), 'coreURL TIDAK diblob-kan (punca ESM-import fallback)');
  // Regresi UI: [hidden] mesti menang ke atas .opt{display:flex} (pilihan MP4 tak bocor ke MP3).
  assert.ok(html.includes('[hidden] { display:none !important; }'), 'aturan [hidden] display:none !important');
  // Regresi CDN: fail UMD @ffmpeg/util sebenar = index.js; util.js → 404 (punca ENGINE_FAIL).
  assert.ok(!html.includes('@ffmpeg/util') || html.includes('/@ffmpeg/util@') && !html.includes('util@0.12.1/dist/umd/util.js'), 'tiada laluan util.js 404');
  assert.ok(html.includes('@ffmpeg/util@0.12.1/dist/umd/index.js'), 'laluan util = index.js');
  assert.ok(html.includes("data-mode=\"mp3\"") && html.includes("data-mode=\"mp4\""), 'dua mod (MP3/MP4)');
  assert.ok(html.includes('id="drop"') && html.includes('id="dlBtn"'), 'seret-lepas + butang muat turun');
  // Satu <script> inline; pastikan parse sah apabila pelayar API distub.
  new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')).replace(/'use strict';/, ''));
});
