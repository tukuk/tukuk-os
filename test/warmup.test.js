'use strict';
// src/warmup.js — the post-restart page warm-up.
//
// The point of this module is not that it fetches pages (trivial), it is that it does so
// without ever being able to make a restart worse: sequential, deadline per page, and a
// page that never answers must not hold the queue. Those are the three properties tested.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const warmup = require('../src/warmup');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function baseOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
function stop(server) {
  if (server.closeAllConnections) server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

test('warms every path, in order, with the public Host header', async () => {
  const seen = [];
  const server = await serve((req, res) => {
    seen.push({ url: req.url, host: req.headers.host });
    res.writeHead(req.url === '/gone' ? 404 : 200, { 'Content-Type': 'text/html' });
    res.end('<html>ok</html>');
  });
  try {
    const result = await warmup.start({
      base: baseOf(server),
      paths: ['/a', '/gone', '/b'],
      host: 'tukuk.org',
      delayMs: 0,
      log: () => {},
    });
    assert.deepStrictEqual(seen.map((s) => s.url), ['/a', '/gone', '/b'], 'one request per path, in order');
    assert.ok(seen.every((s) => s.host === 'tukuk.org'), 'every request carries the public Host, never 127.0.0.1');
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.ok, 2, 'the 404 is reported as not warm, not as a failure to run');
    assert.deepStrictEqual(result.results.map((r) => r.status), [200, 404, 200]);
  } finally {
    await stop(server);
  }
});

test('a page that never answers is cut off by its own deadline and the queue continues', async () => {
  const server = await serve((req, res) => {
    if (req.url === '/hang') return; // never respond
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('ok');
  });
  try {
    const startedAt = Date.now();
    const result = await warmup.start({
      base: baseOf(server),
      paths: ['/hang', '/after'],
      delayMs: 0,
      timeoutMs: 150,
      log: () => {},
    });
    const elapsed = Date.now() - startedAt;
    assert.deepStrictEqual(result.results.map((r) => r.status), [0, 200], 'the hung page reports 0, the next page still warms');
    assert.strictEqual(result.ok, 1);
    assert.ok(elapsed < 5000, `one deadline, not an open-ended wait (took ${elapsed} ms)`);
  } finally {
    await stop(server);
  }
});

test('a page that is slow to warm is named in the log, so the list is tuned from evidence', async () => {
  const server = await serve((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('ok');
    }, req.url === '/nasa' ? 80 : 0);
  });
  try {
    const lines = [];
    const result = await warmup.start({
      base: baseOf(server),
      paths: ['/fast', '/nasa'],
      delayMs: 0,
      slowMs: 50,
      log: (line) => lines.push(line),
    });
    const expensive = lines.find((l) => l.includes('expensive:'));
    assert.ok(expensive, 'the slow page is reported');
    assert.ok(expensive.includes('/nasa'), 'under its own name');
    assert.ok(!expensive.includes('/fast'), 'and the fast one is not noise in the line');
    assert.ok(result.results.find((r) => r.path === '/nasa').ms >= 50, 'the result carries the timing');
  } finally {
    await stop(server);
  }
});

test('an empty list or a missing base is a no-op, not a crash', async () => {
  assert.deepStrictEqual(await warmup.start({}), { ok: 0, total: 0, results: [] });
  assert.deepStrictEqual(await warmup.start({ base: 'http://127.0.0.1:1', paths: [] }), { ok: 0, total: 0, results: [] });
});

test('plan() reads the environment: WARMUP=0 disables, WARMUP_PATHS overrides, port is honoured', () => {
  assert.strictEqual(warmup.plan({ WARMUP: '0' }, 3000), null, 'WARMUP=0 turns the warm-up off');
  assert.strictEqual(warmup.plan({ WARMUP: ' 0 ' }, 3000), null, 'whitespace is not a way to accidentally enable it');

  const byDefault = warmup.plan({}, 3111);
  assert.strictEqual(byDefault.base, 'http://127.0.0.1:3111', 'the app warms its own port, not a guess');
  assert.strictEqual(byDefault.host, 'tukuk.org');
  assert.deepStrictEqual(byDefault.paths, warmup.DEFAULT_PATHS);

  const custom = warmup.plan({ WARMUP_PATHS: '/x, /y ,, /z' }, 3000);
  assert.deepStrictEqual(custom.paths, ['/x', '/y', '/z'], 'commas and blanks are tolerated');

  const many = warmup.plan({ WARMUP_PATHS: Array.from({ length: 50 }, (_, i) => `/p${i}`).join(',') }, 3000);
  assert.strictEqual(many.paths.length, 24, 'a runaway list is capped');

  const elsewhere = warmup.plan({ WARMUP_BASE: 'http://127.0.0.1:8080' }, 3000);
  assert.strictEqual(elsewhere.base, 'http://127.0.0.1:8080', 'a front proxy can be warmed instead');
});
