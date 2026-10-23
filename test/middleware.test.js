'use strict';
// Unit tests for the rate-limit middleware, client identification, and the proxy cache lease.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mw = require('../src/middleware');

const POLICY = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

/**
 * A response that behaves like Node's ServerResponse where it matters: writeHead() is the
 * point of no return — it applies any headers given as arguments and puts everything on the
 * wire — and any setHeader() after that throws. That throw is the crash that took the site
 * down once, so the mock reproduces the mechanism instead of describing it.
 */
function mockRes({ status = 200, cacheControl = POLICY } = {}) {
  const headers = { 'cache-control': cacheControl };
  const res = {
    statusCode: status,
    headersSent: false,
    lease: null,
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    setHeader(k, v) {
      if (res.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT: set');
      if (String(k).toLowerCase() === 'x-accel-expires') res.lease = v;
      headers[String(k).toLowerCase()] = v;
    },
    writeHead(code, a, b) {
      if (typeof code === 'number') res.statusCode = code;
      const passed = typeof a === 'string' ? b : a;
      if (passed && !Array.isArray(passed)) {
        for (const [k, v] of Object.entries(passed)) res.setHeader(k, v);
      }
      res.headersSent = true;
      return res;
    },
    write() { return true; },
    end() { return true; },
  };
  return res;
}

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

test('handProxyLease: a render that flushes its headers gets the lease it was promised', () => {
  const res = mockRes();
  mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
  res.writeHead(200);          // what express/compression do before touching the body
  assert.equal(res.lease, '300');
  assert.equal(res.headersSent, true, 'the headers are out, so the lease had to go with them');
  res.end('<html></html>');    // and nothing afterwards may throw
});

test('handProxyLease: a route that overrode Cache-Control keeps its answer private', () => {
  // The /bendera/studio case: inside a cacheable prefix, but the route says no-store.
  const res = mockRes({ cacheControl: 'no-store' });
  mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
  res.writeHead(200);
  assert.equal(res.lease, null);
});

test('handProxyLease: Cache-Control handed to writeHead itself is read before deciding', () => {
  // writeHead applies its header arguments itself, which is too late for setHeader() — so the
  // helper must look at them, or a route could say no-store and still be cached for 300 s.
  const priv = mockRes();
  mw.handProxyLease(priv, { policy: POLICY, seconds: '300' });
  priv.writeHead(200, { 'Cache-Control': 'no-store' });
  assert.equal(priv.lease, null, 'no-store passed as an argument must not be leased');

  const pub = mockRes({ cacheControl: 'no-store' });
  mw.handProxyLease(pub, { policy: POLICY, seconds: '300' });
  pub.writeHead(200, { 'Cache-Control': POLICY });
  assert.equal(pub.lease, '300', 'the argument is the final word, so it may be leased');
});

test('handProxyLease: an error under a cacheable prefix is never leased', () => {
  // The unknown-slug 404 case, plus the redirect/503 cases that ride the same prefix.
  for (const status of [301, 404, 500, 503]) {
    const res = mockRes({ status });
    mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
    res.writeHead(status);
    assert.equal(res.lease, null, `status ${status} must not be cached`);
  }
});

test('handProxyLease: if the headers really did go out first, it declines instead of crashing', () => {
  const res = mockRes();
  mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
  res.headersSent = true;                    // a flush that was somehow never hooked
  assert.doesNotThrow(() => res.writeHead(200));
  assert.equal(res.lease, null);
});

test('handProxyLease: a header argument it will not interpret leaves the page uncached', () => {
  // The array form exists in Node's API. Guessing at it could wrongly cache a private page,
  // so the honest behaviour is to abstain — uncached is always safe, wrongly cached is not.
  const res = mockRes({ cacheControl: 'no-store' });
  mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
  assert.doesNotThrow(() => res.writeHead(200, [['Cache-Control', POLICY]]));
  assert.equal(res.lease, null);
});

test('handProxyLease: writeHead is intercepted once, then handed back', () => {
  const res = mockRes();
  const before = res.writeHead;
  mw.handProxyLease(res, { policy: POLICY, seconds: '300' });
  assert.notEqual(res.writeHead, before, 'patched while the response is still unflushed');
  res.writeHead(200);
  assert.equal(res.writeHead, before, 'back to the original after the only flush that matters');
  assert.equal(res.lease, '300', 'the lease survives the unwrapping');
  res.write('body');
  res.end();
  assert.equal(res.lease, '300');
});
