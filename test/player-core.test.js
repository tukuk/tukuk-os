'use strict';
// Ujian sistem muzik/radio seluruh-laman. Dua komponen:
//  - public/index.html  → bar pemain penuh (pemilik keadaan; menulis 'tk-player-state')
//  - public/player.js   → mini-pemain global (mengambil-alih di halaman lain)
// Konvensi: playback BERTERUSAN (Auto‑next lalai HIDUP) & berhenti hanya atas tindakan
// pengguna; kedua-dua pemain mesti menghormati preferensi `auto` yang sama.
// Fungsi murni (normAudioSrc/savePlayerState) diekstrak verbatim dari index.html lalu
// dijalankan dalam sandbox `new Function` dengan stub. Baki ialah pengawal-regresi teks
// (kontrak kelakuan) yang tidak boleh diuji tanpa DOM/autio sebenar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'player.js'), 'utf8');

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

const normAudioSrc = extractFn(html, 'normAudioSrc');
const savePlayerState = extractFn(html, 'savePlayerState');

// ── normAudioSrc: hanya http(s), naik taraf http→https pada halaman https ──
test('normAudioSrc: tolak non-http, naik taraf http→https bila halaman https', () => {
  const load = (proto) => new Function('window', `${normAudioSrc}\nreturn normAudioSrc;`)({ location: { protocol: proto } });
  const https = load('https:'); const http = load('http:');
  assert.equal(https('https://a.com/x.m4a'), 'https://a.com/x.m4a', 'https kekal');
  assert.equal(https('http://a.com/x.m4a'), 'https://a.com/x.m4a', 'http→https di halaman https (elak mixed-content)');
  assert.equal(http('http://a.com/x.m4a'), 'http://a.com/x.m4a', 'http dibiarkan di halaman http');
  assert.equal(https(''), '', 'kosong ditolak');
  assert.equal(https('ftp://a/x'), '', 'skema bukan-http ditolak');
  assert.equal(https('  https://a/y  '), 'https://a/y', 'whitespace trim');
});

// ── savePlayerState: simpan keadaan + preferensi auto (Auto‑next) ──
function runSave(inputs) {
  const wrote = {};
  const localStorage = { setItem: (k, v) => { wrote[k] = v; }, getItem: () => null, removeItem: () => {} };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const body = `
    const { mediaAudio, audioBarTitle, audioAutoEl, currentQueueArr, PLAYER_STATE_KEY } = inputs;
    let currentSrc = inputs.currentSrc, currentLive = inputs.currentLive;
    ${normAudioSrc}
    ${savePlayerState}
    savePlayerState(true);
    return __wrote();
  `;
  const f = new Function('inputs', 'localStorage', 'document', '__wrote', body);
  return JSON.parse(f(inputs, localStorage, document, () => wrote[inputs.PLAYER_STATE_KEY]).slice(0));
}

test('savePlayerState: tulis src/queue/playing + auto mencerminkan checkbox', () => {
  const inputs = {
    currentSrc: 'https://a/1.m4a', currentLive: false,
    audioBarTitle: { textContent: 'Lagu X' },
    mediaAudio: { currentTime: 12.5 },
    audioAutoEl: { checked: true },
    PLAYER_STATE_KEY: 'tk-player-state',
    currentQueueArr: () => [{ src: 'https://a/1.m4a', title: 'Lagu X' }, { src: 'https://a/2.m4a', title: 'Lagu Y' }],
  };
  const st = runSave(inputs);
  assert.equal(st.src, 'https://a/1.m4a');
  assert.equal(st.playing, true);
  assert.equal(st.pos, 12.5, 'pos disimpan untuk trek bukan-live');
  assert.equal(st.qi, 0, 'qi ialah indeks trek semasa');
  assert.equal(st.auto, true, 'auto=ON dipersist');
  assert.equal(st.queue.length, 2);
  // Auto‑next dimatikan → auto false (mini-pemain mesti ikut).
  const off = runSave(Object.assign({}, inputs, { audioAutoEl: { checked: false } }));
  assert.equal(off.auto, false, 'auto=OFF dipersist supaya konsisten rentas-pemain');
});

test('savePlayerState: tanpa currentSrc → tidak tulis apa-apa', () => {
  const wrote = {};
  const localStorage = { setItem: (k, v) => { wrote[k] = v; }, getItem: () => null };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const f = new Function('localStorage', 'document', `${normAudioSrc}\n${savePlayerState}\nvar currentSrc='',currentLive=false;savePlayerState(true);`);
  f(localStorage, document);
  assert.deepEqual(wrote, {}, 'tiada tulis bila tiada sumber');
});

// ── Pengawal-regresi kontrak kelakuan (tak boleh unit-uji tanpa DOM/audio) ──
test('index.html: Auto‑next lalai HIDUP + persist + pulih + gerbang advance', () => {
  assert.ok(/id="audioAuto"\s+checked/.test(html), 'checkbox default checked (berterusan)');
  assert.ok(/auto:\s*audioAutoEl \? audioAutoEl\.checked : true/.test(html), 'savePlayerState persist auto');
  assert.ok(/audioAutoEl\.checked = st\.auto !== false/.test(html), 'restore pulih auto (lalai true)');
  assert.ok(/audioAutoEl && audioAutoEl\.checked\) advanceQueue\(\)/.test(html), "ended: advance HANYA bila auto ON (lalu berhenti)");
});

test('player.js: autoNext dari st.auto, persist, gerbang ended + reconnect, sync tab', () => {
  assert.ok(/var autoNext = st\.auto !== false/.test(js), 'player.js baca autoNext dari state (lalai true)');
  assert.ok(/auto:\s*autoNext/.test(js), 'player.js persist auto dalam save()');
  assert.ok(/if \(!autoNext\) \{ softStop\(\); return; \}/.test(js), 'ended: auto OFF → softStop (bukan lompat trek)');
  assert.ok(/\(live \|\| !autoNext\) \? softStop\(\) : next\(\)/.test(js), 'reconnect gagal berulang: auto OFF → softStop, bukan skip rambang');
  assert.ok(/autoNext = !!ns\.auto/.test(js), 'storage event: ikut togol auto dari tab lain');
});

test('player.js: index punya bar sendiri → mini-pemain menyerah (#mediaAudio)', () => {
  assert.ok(/getElementById\('mediaAudio'\)\) return/.test(js), 'boot() keluar bila #mediaAudio wujud (tiada dwi-audio)');
  assert.ok(/\/admin/.test(js), 'tidak aktif di /admin');
});
