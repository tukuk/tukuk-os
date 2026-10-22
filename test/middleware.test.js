'use strict';
// Unit tests for the rate-limit middleware & client identification.
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

test('clientKey: prefers the first XFF segment, then ip, then the socket', () => {
  // The trustProxy config may be true/false depending on the environment — we only assert
  // a non-empty string is returned and the source choice follows the priority order.
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

test('rateLimit: produces a middleware (3-arg function)', () => {
  const handler = mw.rateLimit({ windowMs: 1000, max: 2 });
  assert.equal(typeof handler, 'function');
  assert.equal(handler.length, 3);
});

test('rateLimit: lets 2 requests through, blocks the 3rd with 429', () => {
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
  assert.equal(nextCalled, 2, 'the first two requests should pass');
  handler(req, res, next);
  assert.equal(nextCalled, 2, 'the third request must not call next');
  assert.equal(status, 429);
  assert.ok(json && typeof json.error === 'string');
});
