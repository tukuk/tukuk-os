'use strict';
// Ujian gerbang SMS (src/sms.js) — logik murni + satu loopback HTTP penuh:
// pasangan -> hantar -> peranti poll outbox -> lapor status -> tolak inbox.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sms = require('../src/sms');

const BS = String.fromCharCode(8);   // backspace (kawalan, patut dibuang)
const NUL = String.fromCharCode(0);  // nul (kawalan, patut dibuang)

test('normalizeNumber: kekalkan + dan digit, buang simbol', () => {
  assert.equal(sms.normalizeNumber(' +60 12-345 6789 '), '+60123456789');
  assert.equal(sms.normalizeNumber('012-345'), '012345', 'tanpa plus kekal tanpa plus');
  assert.equal(sms.normalizeNumber('abc'), null, 'tiada digit null');
  assert.equal(sms.normalizeNumber(''), null);
});

test('cleanBody: potong 480, baris baru dikekalkan, kawalan lain jadi spasi', () => {
  assert.equal(sms.cleanBody('x'.repeat(600)).length, 480);
  const nl = String.fromCharCode(10);
  assert.equal(sms.cleanBody('satu' + nl + 'dua'), 'satu' + nl + 'dua', 'newline dikekalkan');
  assert.equal(sms.cleanBody('a' + NUL + 'b' + BS + 'c'), 'a b c', 'nul/backspace jadi spasi');
});

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-sms-'));
  const app = express();
  app.use(express.json());
  // Pintu admin di-stub (lulus terus); requireDevice dalaman diuji sebenar.
  sms.mount(app, {
    auth: { requireAdmin: (req, res, next) => next() },
    rateLimit: null,
    path: path.join(dir, 'sms.json'),
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, close: () => new Promise((r) => server.close(r)) };
}
async function post(base, p, body, headers) {
  const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function get(base, p, headers) {
  const r = await fetch(base + p, { headers: headers || {} });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

test('loopback penuh: pair -> send -> outbox -> report -> inbox -> baca', async () => {
  const { base, close } = await startServer();
  try {
    // Sebelum pasangan: hujung peranti balas 409 (bukan 5xx — elak topeng mod sandaran tepi).
    const pre = await post(base, '/api/sms/device/outbox', {});
    assert.equal(pre.status, 409, 'tiada peranti dipasangkan lagi');

    // Admin jana token pasangan.
    const rot = await post(base, '/api/sms/device/rotate', {});
    assert.equal(rot.status, 200);
    const token = rot.json.token;
    assert.ok(typeof token === 'string' && token.length >= 32, 'token hex panjang dipulang sekali');
    const H = { 'x-sms-token': token };

    // Token salah ditolak.
    const bad = await post(base, '/api/sms/device/heartbeat', {}, { 'x-sms-token': 'deadbeef'.repeat(4) });
    assert.equal(bad.status, 401, 'token palsu 401');

    // Heartbeat peranti mengisytihar SIM.
    const hb = await post(base, '/api/sms/device/heartbeat', { name: 'Pixel', number: '60111222333', carrier: 'Maxis' }, H);
    assert.equal(hb.status, 200);
    const st = await get(base, '/api/sms/status');
    assert.equal(st.json.paired, true);
    assert.equal(st.json.device.number, '60111222333');
    assert.equal(st.json.device.online, true);

    // Admin hantar SMS masuk katus queued.
    const send = await post(base, '/api/sms/send', { to: '+60 12-345', body: 'Test SMS' });
    assert.equal(send.status, 200);
    const mid = send.json.message.id;
    assert.equal(send.json.message.status, 'queued');

    // Peranti tarik outbox -> dapat 1, jadi sending; poll kedua kosong.
    const ob = await post(base, '/api/sms/device/outbox', {}, H);
    assert.equal(ob.json.messages.length, 1);
    assert.equal(ob.json.messages[0].body, 'Test SMS');
    const ob2 = await post(base, '/api/sms/device/outbox', {}, H);
    assert.equal(ob2.json.messages.length, 0, 'tidak dihantar berganda');

    // Peranti lapor delivered.
    const rp = await post(base, '/api/sms/device/report', { id: mid, status: 'delivered' }, H);
    assert.equal(rp.status, 200);
    assert.equal(rp.json.status, 'delivered');

    // Peranti tolak inbox + dedupe.
    const inb = await post(base, '/api/sms/device/inbox', { from: '+601988', body: 'balas', ts: 1000 }, H);
    assert.equal(inb.status, 200);
    const inb2 = await post(base, '/api/sms/device/inbox', { from: '+601988', body: 'balas', ts: 1000 }, H);
    assert.equal(inb2.json.duplicate, true, 'SMS masuk berganda dedupe');

    // Utas: dua peer, inbox belum dibaca.
    const th = await get(base, '/api/sms/threads');
    const peers = th.json.threads.map((t) => t.peer);
    assert.ok(peers.includes('+601988') && peers.includes('+6012345'), 'kedua-dua peer muncul');
    assert.equal(th.json.threads.find((t) => t.peer === '+601988').unread, 1);

    // Buka utas -> tanda dibaca.
    const one = await get(base, '/api/sms/thread?peer=%2B601988');
    assert.equal(one.json.messages.length, 1);
    assert.equal(one.json.messages[0].read, true);
    const th2 = await get(base, '/api/sms/threads');
    assert.equal(th2.json.threads.find((t) => t.peer === '+601988').unread, 0, 'unread bersih selepas dibuka');

    // Status kiraan katus keluar.
    const st2 = await get(base, '/api/sms/status');
    assert.equal(st2.json.counts.delivered, 1);
    assert.equal(st2.json.counts.queued, 0);
  } finally {
    await close();
  }
});

test('send: nombor tidak sah / isi kosong ditolak', async () => {
  const { base, close } = await startServer();
  try {
    await post(base, '/api/sms/device/rotate', {});
    assert.equal((await post(base, '/api/sms/send', { to: 'abc', body: 'x' })).status, 400);
    assert.equal((await post(base, '/api/sms/send', { to: '+6012345', body: '   ' })).status, 400);
  } finally {
    await close();
  }
});
