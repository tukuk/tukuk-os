'use strict';
/*
 * The proxy cache lease, against the REAL express + REAL compression.
 *
 * test/middleware.test.js covers the decision logic with a mock. This file exists because
 * the mock cannot see the one thing that actually broke twice: compression() flushes the
 * body through res.write() before it calls the res.end() it wrapped, so
 *  · deciding at end() throws ERR_HTTP_HEADERS_SENT (that crash-looped the live process), and
 *  · guarding that with `if (res.headersSent) return` at end() alone marks NOTHING — every
 *    gzipped page silently gets no lease and the cache stays empty while every other check
 *    still passes. A green harness certifying a no-op is the worst failure this feature has.
 *
 * So: build the real middleware chain, make a real request, read the real headers.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { handProxyLease } = require('../src/middleware');

const POLICY = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
const BIG = '<p>bandera dan warna dan maknanya</p>'.repeat(3000);   // over any compression threshold

const app = express();
app.use((req, res, next) => {
  res.setHeader('Cache-Control', POLICY);
  handProxyLease(res, { policy: POLICY, seconds: '300' });
  next();
});
app.use(compression({
  threshold: 128,
  filter: (req, res) => !/text\/event-stream|audio\//.test(String(res.getHeader('Content-Type') || '')),
}));
app.get('/page', (req, res) => res.type('html').send(BIG));
app.get('/private', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(BIG); });
app.get('/missing', (req, res) => res.status(404).type('html').send(BIG));
app.get('/wh-private', (req, res) => {      // no-store handed to writeHead, not setHeader
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(BIG);
});
app.get('/streamed', (req, res) => {          // a route that flushes in several chunks
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': POLICY });
  res.write('<p>chunk one ');
  res.write('chunk two</p>');
  res.end();
});

let server;
test('lease chain: start the real server', async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});

function grab(path, { gzip = true } = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: gzip ? { 'Accept-Encoding': 'gzip' } : {} }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes }));
    });
    req.on('error', reject);
  });
}

test.after(() => { if (server) server.close(); });

test('a gzipped page really does carry the lease (this is what the cache runs on)', async () => {
  const r = await grab('/page');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip', 'the body must actually have been compressed');
  assert.equal(r.headers['x-accel-expires'], '300',
    'no lease on a compressed page means nginx caches nothing and every other check still passes');
  assert.equal(r.headers['cache-control'], POLICY);
});

test('an uncompressed page carries it too', async () => {
  const r = await grab('/page', { gzip: false });
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.headers['x-accel-expires'], '300');
});

test('a page flushed in several chunks carries it once, without throwing', async () => {
  const r = await grab('/streamed');
  assert.equal(r.headers['x-accel-expires'], '300');
});

test('a route that overrode Cache-Control inside a cacheable prefix is NOT leased', async () => {
  const r = await grab('/private');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-accel-expires'], undefined);
});

test('a 404 under a cacheable prefix is NOT leased (no cached "not found")', async () => {
  const r = await grab('/missing');
  assert.equal(r.status, 404);
  assert.equal(r.headers['x-accel-expires'], undefined);
});

test('a route that passes no-store straight to writeHead is NOT leased either', async () => {
  // writeHead applies its own header arguments, so the helper has to read them before the
  // headers go out — otherwise this page would be cached against the route's explicit wish.
  const r = await grab('/wh-private');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-accel-expires'], undefined);
});
