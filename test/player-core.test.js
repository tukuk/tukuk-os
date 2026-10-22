'use strict';
// Tests for the site-wide music/radio system. Two components:
//  - public/index.html  → the full player bar (owns the state; writes 'tk-player-state')
//  - public/player.js   → the global mini-player (takes over on other pages)
// Convention: playback is CONTINUOUS (Auto‑next is ON by default) and only stops on a user
// action; both players must honour the same `auto` preference.
// The pure functions (normAudioSrc/savePlayerState) are extracted verbatim from index.html and
// then run inside a `new Function` sandbox with stubs. The rest are text guard-rails for the
// behaviour contract that cannot be unit-tested without a real DOM/audio engine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'player.js'), 'utf8');

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('unbalanced brackets: ' + name);
}

const normAudioSrc = extractFn(html, 'normAudioSrc');
const savePlayerState = extractFn(html, 'savePlayerState');

// ── normAudioSrc: http(s) only; an http stream is same-origin proxied on an https page ──
test('normAudioSrc: rejects non-http, proxies http→/radio/stream on an https page', () => {
  const load = (proto) => new Function('window', `${normAudioSrc}\nreturn normAudioSrc;`)({ location: { protocol: proto } });
  const https = load('https:'); const http = load('http:');
  assert.equal(https('https://a.com/x.m4a'), 'https://a.com/x.m4a', 'https stays (plays directly)');
  assert.equal(https('http://a.com/x.m4a'), '/radio/stream?url=' + encodeURIComponent('http://a.com/x.m4a'), 'http→same-origin proxy on an https page (avoids mixed-content)');
  assert.equal(http('http://a.com/x.m4a'), 'http://a.com/x.m4a', 'http is left alone on an http page (no mixed-content)');
  assert.equal(https('/radio/stream?url=http%3A%2F%2Fa'), '/radio/stream?url=http%3A%2F%2Fa', 'already proxied → idempotent');
  assert.equal(https(''), '', 'empty is rejected');
  assert.equal(https('ftp://a/x'), '', 'a non-http scheme is rejected');
  assert.equal(https('  https://a/y  '), 'https://a/y', 'whitespace trim');
});

// ── savePlayerState: stores the state + the auto preference (Auto‑next) ──
function runSave(inputs) {
  const wrote = {};
  const localStorage = { setItem: (k, v) => { wrote[k] = v; }, getItem: () => null, removeItem: () => {} };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const body = `
    const { mediaAudio, audioBarTitle, audioAutoEl, currentQueueArr, PLAYER_STATE_KEY, playedSec } = inputs;
    let currentSrc = inputs.currentSrc, currentLive = inputs.currentLive;
    ${normAudioSrc}
    ${savePlayerState}
    savePlayerState(true);
    return __wrote();
  `;
  const f = new Function('inputs', 'localStorage', 'document', '__wrote', body);
  return JSON.parse(f(inputs, localStorage, document, () => wrote[inputs.PLAYER_STATE_KEY]).slice(0));
}

test('savePlayerState: writes src/queue/playing + auto mirrors the checkbox', () => {
  const inputs = {
    currentSrc: 'https://a/1.m4a', currentLive: false,
    audioBarTitle: { textContent: 'Song X' },
    mediaAudio: { currentTime: 12.5 },
    playedSec: 30,
    audioAutoEl: { checked: true },
    PLAYER_STATE_KEY: 'tk-player-state',
    currentQueueArr: () => [{ src: 'https://a/1.m4a', title: 'Song X' }, { src: 'https://a/2.m4a', title: 'Song Y' }],
  };
  const st = runSave(inputs);
  assert.equal(st.src, 'https://a/1.m4a');
  assert.equal(st.playing, true);
  assert.equal(st.pos, 12.5, 'pos is stored for a non-live track');
  assert.equal(st.played, 43, 'played = round(looped + currentTime)');
  assert.equal(st.qi, 0, 'qi is the current track index');
  assert.equal(st.auto, true, 'auto=ON is persisted');
  assert.equal(st.queue.length, 2);
  // Auto‑next turned off → auto false (the mini-player must follow).
  const off = runSave(Object.assign({}, inputs, { audioAutoEl: { checked: false } }));
  assert.equal(off.auto, false, 'auto=OFF is persisted so it stays consistent across players');
});

test('savePlayerState: with no currentSrc → nothing is written', () => {
  const wrote = {};
  const localStorage = { setItem: (k, v) => { wrote[k] = v; }, getItem: () => null };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const f = new Function('localStorage', 'document', `${normAudioSrc}\n${savePlayerState}\nvar currentSrc='',currentLive=false;savePlayerState(true);`);
  f(localStorage, document);
  assert.deepEqual(wrote, {}, 'nothing is written without a source');
});

// ── Guard-rails for the behaviour contract (untestable as units without DOM/audio) ──
test('index.html: Auto‑next is ON by default + persisted + restored + the advance gate', () => {
  assert.ok(/id="audioAuto"\s+checked/.test(html), 'the checkbox is checked by default (continuous)');
  assert.ok(/auto:\s*audioAutoEl \? audioAutoEl\.checked : true/.test(html), 'savePlayerState persists auto');
  assert.ok(/audioAutoEl\.checked = st\.auto !== false/.test(html), 'restore brings auto back (default true)');
  assert.ok(/audioAutoEl && audioAutoEl\.checked\) advanceQueue\(\)/.test(html), "ended: advance ONLY when auto is ON (otherwise it stops)");
});

test('player.js: autoNext from st.auto, persisted, the ended + reconnect gates, tab sync', () => {
  assert.ok(/var autoNext = st\.auto !== false/.test(js), 'player.js reads autoNext from the state (default true)');
  assert.ok(/auto:\s*autoNext/.test(js), 'player.js persists auto inside save()');
  assert.ok(/if \(!autoNext\) \{ softStop\(\); return; \}/.test(js), 'ended: auto OFF → softStop (not a track skip)');
  assert.ok(/\(live \|\| !autoNext\) \? softStop\(\) : next\(\)/.test(js), 'repeated reconnect failures: auto OFF → softStop, not a random skip');
  assert.ok(/autoNext = !!ns\.auto/.test(js), 'storage event: follows the auto toggle from another tab');
});

test('player.js: the index has its own bar → the mini-player backs off (#mediaAudio)', () => {
  assert.ok(/getElementById\('mediaAudio'\)\) return/.test(js), 'boot() exits when #mediaAudio exists (no double audio)');
  assert.ok(/\/admin/.test(js), 'inactive on /admin');
});
