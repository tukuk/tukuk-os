'use strict';
// Tests for the SMS gateway (src/sms.js) — pure logic + one full loopback HTTP run:
// pair -> send -> device polls the outbox -> report status -> push into the inbox.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sms = require('../src/sms');

const BS = String.fromCharCode(8);   // backspace (a control char, should be stripped)
const NUL = String.fromCharCode(0);  // nul (a control char, should be stripped)

test('normalizeNumber: keeps + and digits, strips symbols', () => {
  assert.equal(sms.normalizeNumber(' +60 12-345 6789 '), '+60123456789');
  assert.equal(sms.normalizeNumber('012-345'), '012345', 'no plus stays without a plus');
  assert.equal(sms.normalizeNumber('abc'), null, 'no digits → null');
  assert.equal(sms.normalizeNumber(''), null);
});

test('cleanBody: cuts at 480, keeps newlines, turns other control chars into spaces', () => {
  assert.equal(sms.cleanBody('x'.repeat(600)).length, 480);
  const nl = String.fromCharCode(10);
  assert.equal(sms.cleanBody('one' + nl + 'two'), 'one' + nl + 'two', 'the newline is kept');
  assert.equal(sms.cleanBody('a' + NUL + 'b' + BS + 'c'), 'a b c', 'nul/backspace become spaces');
});

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-sms-'));
  const app = express();
  app.use(express.json());
  // The admin door is stubbed (always passes); the internal requireDevice is really tested.
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

test('full loopback: pair -> send -> outbox -> report -> inbox -> read', async () => {
  const { base, close } = await startServer();
  try {
    // Before pairing: the device endpoints answer 409 (not 5xx — avoids masking the edge-fallback mode).
    const pre = await post(base, '/api/sms/device/outbox', {});
    assert.equal(pre.status, 409, 'no device has been paired yet');

    // The admin generates a pairing token.
    const rot = await post(base, '/api/sms/device/rotate', {});
    assert.equal(rot.status, 200);
    const token = rot.json.token;
    assert.ok(typeof token === 'string' && token.length >= 32, 'a long hex token is returned once');
    const H = { 'x-sms-token': token };

    // A wrong token is rejected.
    const bad = await post(base, '/api/sms/device/heartbeat', {}, { 'x-sms-token': 'deadbeef'.repeat(4) });
    assert.equal(bad.status, 401, 'a forged token → 401');

    // The device heartbeat declares the SIM.
    const hb = await post(base, '/api/sms/device/heartbeat', { name: 'Pixel', number: '60111222333', carrier: 'Maxis' }, H);
    assert.equal(hb.status, 200);
    const st = await get(base, '/api/sms/status');
    assert.equal(st.json.paired, true);
    assert.equal(st.json.device.number, '60111222333');
    assert.equal(st.json.device.online, true);

    // The admin sends an SMS; the queue count goes up.
    const send = await post(base, '/api/sms/send', { to: '+60 12-345', body: 'Test SMS' });
    assert.equal(send.status, 200);
    const mid = send.json.message.id;
    assert.equal(send.json.message.status, 'queued');

    // The device pulls the outbox → gets 1, turns sending; the second poll is empty.
    const ob = await post(base, '/api/sms/device/outbox', {}, H);
    assert.equal(ob.json.messages.length, 1);
    assert.equal(ob.json.messages[0].body, 'Test SMS');
    const ob2 = await post(base, '/api/sms/device/outbox', {}, H);
    assert.equal(ob2.json.messages.length, 0, 'nothing is delivered twice');

    // The device reports delivered.
    const rp = await post(base, '/api/sms/device/report', { id: mid, status: 'delivered' }, H);
    assert.equal(rp.status, 200);
    assert.equal(rp.json.status, 'delivered');

    // The device pushes into the inbox + dedupe.
    const inb = await post(base, '/api/sms/device/inbox', { from: '+601988', body: 'reply', ts: 1000 }, H);
    assert.equal(inb.status, 200);
    const inb2 = await post(base, '/api/sms/device/inbox', { from: '+601988', body: 'reply', ts: 1000 }, H);
    assert.equal(inb2.json.duplicate, true, 'a duplicated inbound SMS is deduped');

    // Threads: two peers, the inbox is still unread.
    const th = await get(base, '/api/sms/threads');
    const peers = th.json.threads.map((t) => t.peer);
    assert.ok(peers.includes('+601988') && peers.includes('+6012345'), 'both peers show up');
    assert.equal(th.json.threads.find((t) => t.peer === '+601988').unread, 1);

    // Open a thread → marked as read.
    const one = await get(base, '/api/sms/thread?peer=%2B601988');
    assert.equal(one.json.messages.length, 1);
    assert.equal(one.json.messages[0].read, true);
    const th2 = await get(base, '/api/sms/threads');
    assert.equal(th2.json.threads.find((t) => t.peer === '+601988').unread, 0, 'unread is cleared after opening');

    // The status counts the outgoing queue.
    const st2 = await get(base, '/api/sms/status');
    assert.equal(st2.json.counts.delivered, 1);
    assert.equal(st2.json.counts.queued, 0);
  } finally {
    await close();
  }
});

test('send: an invalid number / an empty body are rejected', async () => {
  const { base, close } = await startServer();
  try {
    await post(base, '/api/sms/device/rotate', {});
    assert.equal((await post(base, '/api/sms/send', { to: 'abc', body: 'x' })).status, 400);
    assert.equal((await post(base, '/api/sms/send', { to: '+6012345', body: '   ' })).status, 400);
  } finally {
    await close();
  }
});

// ─── Pure functions of the Chat ⇄ Cell bridge (enqueue / isPaired / onInbound) ───
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-sms-'));
  sms.setPath(path.join(dir, 'sms.json'));
}

test('isPaired: false while no device is paired', () => {
  fresh();
  assert.equal(sms.isPaired(), false, 'empty store → no relay');
});

test('enqueue: an invalid number / an empty body → error', () => {
  fresh();
  assert.ok(sms.enqueue('abc', 'x').error, 'invalid number');
  assert.ok(sms.enqueue('+60123456789', '   ').error, 'empty body');
});

test('enqueue: valid → the outgoing message is normalised + queued (no device needed)', () => {
  fresh();
  const r = sms.enqueue('+6012-345 6789', 'hello');
  assert.ok(r.ok, 'enqueue succeeded');
  assert.equal(r.message.dir, 'out');
  assert.equal(r.message.peer, '+60123456789', 'the number is normalised');
  assert.equal(r.message.body, 'hello');
  assert.equal(r.message.status, 'queued');
});

test('enqueue: a long body is cut to MAX_BODY (about 3 SMS segments)', () => {
  fresh();
  const r = sms.enqueue('+60123456789', 'a'.repeat(900));
  assert.ok(r.ok);
  assert.equal(r.message.body.length, 480, 'cut at 480 characters');
});

test('onInbound: registers the listener (function) without throwing', () => {
  fresh();
  assert.equal(typeof sms.onInbound(() => {}), 'function', 'a returned function is registered');
  assert.equal(sms.onInbound(null), null, 'not a function → not registered, no throw');
});
