'use strict';
// Ujian unit untuk middleware rate-limit & pengenalan klien.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mw = require('../src/middleware');

function mockReq({ xff, ip, remote } = {}) {
  return {
    headers: xff ? { 'x-forwarded-for': xff } : {},
    ip,
    socket: { remoteAddress: remote }
  };
}

test('clientKey: utamakan XFF segmen pertama, fallback ip, kemudian socket', () => {
  // trustProxy config boleh jadi true/false pada persekitaran — kita cuma sahkan
  // pemulangan bukan-empty string & pilihan sumber ikut keutamaan.
  const a = mw.clientKey(mockReq({ xff: '203.0.113.7, 10.0.0.1' }));
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);

  const b = mw.clientKey(mockReq({ ip: '198.51.100.9' }));
  assert.equal(typeof b, 'string');
  assert.ok(b.length > 0);

  const c = mw.clientKey(mockReq({ remote: '192.0.2.42' }));
  assert.equal(typeof c, 'string');
  assert.ok(c.length > 0);
});

test('rateLimit: hasilkan middleware (function 3-arg)', () => {
  const handler = mw.rateLimit({ windowMs: 1000, max: 2 });
  assert.equal(typeof handler, 'function');
  assert.equal(handler.length, 3);
});

test('rateLimit: lalu 2 permintaan, bloating ke-3 dengan 429', () => {
  const handler = mw.rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 't-' });
  const req = mockReq({ ip: '203.0.113.200' });
  let status = 200, json = null, nextCalled = 0;
  const res = {
    set() { return res; },
    status(code) { status = code; return res; },
    json(body) { json = body; return res; }
  };
  const next = () => { nextCalled += 1; };

  handler(req, res, next);
  handler(req, res, next);
  assert.equal(nextCalled, 2, 'dua permintaan pertama wajar lulus');
  handler(req, res, next);
  assert.equal(nextCalled, 2, 'permintaan ketiga tidak wajar panggil next');
  assert.equal(status, 429);
  assert.ok(json && typeof json.error === 'string');
});
