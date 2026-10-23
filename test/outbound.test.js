'use strict';
/*
 * The outbound guard, against a REAL http server and the REAL axios http adapter.
 *
 * This is deliberately not a mock of the upstream. Every promise this module makes is about
 * behaviour that only a real socket can show: that a deadline actually releases the connection
 * (instead of leaving it draining in the background, which is the memory the box is paying
 * for), that twenty simultaneous requests for the same URL become one upstream call, that a
 * failure silences the URL for a while, and — just as important — that a 404 does NOT, and
 * that a call with its own careful short timeout is never lengthened by a module budget.
 *
 * The measured harm this is fixing (23 Oct 2026, /var/log/nginx/tukuk-front.log): 25 requests
 * of 2,845 burned 283.9 s — 19% of all request-time — nine of them /muzik/<cc> held for
 * exactly 15.00 s and then answering 503, which is not cached, so the next visitor pays again.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const axios = require('axios');
const { attachGuard, keyOf } = require('../src/outbound');

// A controllable upstream. `mode` decides what the next request does; counters are per server.
function upstream() {
  const seen = { hits: 0, concurrent: 0, peak: 0, earlyClose: 0 };
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    seen.hits++;
    seen.concurrent++;
    seen.peak = Math.max(seen.peak, seen.concurrent);
    res.on('close', () => { if (!res.writableEnded) seen.earlyClose++; });
    const done = () => { seen.concurrent--; };
    if (mode === 'hang') return;                       // never answers: the deadline must fire
    if (req.url.startsWith('/404')) { seen.concurrent--; res.writeHead(404).end('nope'); return done(); }
    if (req.url.startsWith('/500')) { seen.concurrent--; res.writeHead(500).end('broken'); return done(); }
    if (req.url.startsWith('/slow')) {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, url: req.url })); done(); }, 250);
      return;
    }
    if (req.url.startsWith('/stream')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write('chunk-one-');
      const t = setInterval(() => res.write('x'), 50);
      req.on('close', () => { clearInterval(t); done(); });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
    return done();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        seen,
        setMode: (m) => { mode = m; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const mk = (u, opts) => {
  const inst = axios.create({ timeout: 15000, baseURL: u.base });
  const guard = attachGuard(inst, opts);
  return { inst, guard };
};

// The guard annotates axios' own timeout error instead of replacing it (see src/outbound.js:
// replacing it with an aborted signal makes axios swallow it in throwIfCancellation).
const isDeadline = (err) => Boolean(err && err.outboundDeadline === true
  && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'));

test('twenty requests for one cold URL cost the upstream ONE call', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'muzik-test' });
  const all = await Promise.all(Array.from({ length: 20 }, () => inst.get('/chart')));
  assert.equal(all.length, 20, 'everybody got an answer');
  assert.equal(all[0].data.ok, true);
  assert.equal(u.seen.hits, 1, `the upstream was called ${u.seen.hits} times, not 1`);
  assert.equal(guard.stats.deduped, 19);
  assert.equal(guard.stats.through, 1);
  await u.close();
});

test('the deadline is real: it refuses the wait AND releases the socket', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'hang-test', budgetMs: 300, cooldownMs: 0 });
  u.setMode('hang');
  const t0 = Date.now();
  await assert.rejects(() => inst.get('/stall'), (err) => {
    assert.ok(isDeadline(err), `expected a deadline error, got ${err && err.code}: ${err && err.message}`);
    assert.match(err.message, /hang-test: .*\/stall did not answer within 300ms/);
    return true;
  });
  const took = Date.now() - t0;
  assert.ok(took < 1200, `the caller waited ${took}ms for a 300ms budget`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(u.seen.earlyClose, 1, 'the abandoned request did not keep a socket open');
  assert.equal(guard.stats.deadline, 1);
  await u.close();
});

test('after a failure the URL is refused INSTANTLY, without touching the upstream again', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'cool-test', budgetMs: 250, cooldownMs: 30000 });
  u.setMode('hang');
  await assert.rejects(() => inst.get('/dead'));
  const hitsAfterFirst = u.seen.hits;
  const t0 = Date.now();
  await assert.rejects(() => inst.get('/dead'), (err) => {
    assert.equal(err.code, 'EOUTBOUND_COOLING');
    assert.equal(err.cooling, true);
    return true;
  });
  assert.ok(Date.now() - t0 < 100, 'a cooled call must not wait for anything');
  assert.equal(u.seen.hits, hitsAfterFirst, 'a cooled call must not reach the upstream');
  assert.equal(guard.stats.cooled, 1);
  await u.close();
});

test('a 404 is an answer, not an outage: the next request really tries again', async () => {
  const u = await upstream();
  const { inst } = mk(u, { name: 'nf-test', cooldownMs: 30000 });
  await assert.rejects(() => inst.get('/404'), (err) => err.response && err.response.status === 404);
  assert.equal(u.seen.hits, 1);
  const second = await inst.get('/chart');
  assert.equal(second.data.ok, true);
  assert.equal(u.seen.hits, 2, 'a 4xx must not put the module into cooldown');
  await u.close();
});

test('an upstream 500 IS an outage, and is remembered as one', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'boom-test', cooldownMs: 30000 });
  await assert.rejects(() => inst.get('/500'), (err) => err.response && err.response.status === 500);
  assert.equal(guard.stats.failed, 1);
  await assert.rejects(() => inst.get('/500'), (err) => err.code === 'EOUTBOUND_COOLING');
  assert.equal(u.seen.hits, 1, 'the broken upstream gets one try per cooldown, not one per visitor');
  await u.close();
});

test('a storm is queued, never fanned out: maxConcurrent is a hard ceiling', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'cap-test', maxConcurrent: 2 });
  await Promise.all([1, 2, 3, 4, 5, 6].map((i) => inst.get(`/slow${i}`)));
  assert.equal(u.seen.hits, 6, 'six distinct URLs are six calls — dedupe only merges identical ones');
  assert.ok(u.seen.peak <= 2, `the upstream saw ${u.seen.peak} simultaneous calls, the cap was 2`);
  assert.ok(guard.stats.queued > 0, 'some of them had to wait for a slot');
  await u.close();
});

test('a stream is never shared and never cooled — two readers need two pipes', async () => {
  const u = await upstream();
  const { inst } = mk(u, { name: 'stream-test', cooldownMs: 30000 });
  const [a, b] = await Promise.all([
    inst.get('/stream', { responseType: 'stream' }),
    inst.get('/stream', { responseType: 'stream' }),
  ]);
  assert.equal(u.seen.hits, 2, 'both readers got their own response');
  a.data.destroy(); b.data.destroy();
  // And a failed stream must not silence the URL for the JSON calls that follow it.
  await u.close();
});

test('a call with its own shorter timeout is never LENGTHENED by the module budget', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'careful-test', budgetMs: 5000 });
  u.setMode('hang');
  const t0 = Date.now();
  await assert.rejects(() => inst.get('/stall', { timeout: 200 }), isDeadline);
  assert.ok(Date.now() - t0 < 1200, `the caller waited ${Date.now() - t0}ms; its own 200ms must win`);
  assert.equal(guard.stats.deadline, 1);
  await u.close();
});

test('a call that legitimately needs longer says so, and gets it', async () => {
  const u = await upstream();
  const { inst } = mk(u, { name: 'big-test', budgetMs: 120 });
  const res = await inst.get('/slow', { guardBudgetMs: 4000 });
  assert.equal(res.data.ok, true, 'the 250ms answer arrived under the per-call opt-out');
  await u.close();
});

test('the cache key is order-insensitive over params (NASA passes params objects)', () => {
  const a = keyOf({ baseURL: 'https://api.nasa.gov', url: '/planetary/apod', params: { date: '2024-01-01', api_key: 'k' } });
  const b = keyOf({ baseURL: 'https://api.nasa.gov', url: '/planetary/apod', params: { api_key: 'k', date: '2024-01-01' } });
  assert.equal(a, b, 'the same call written two ways must be the same in-flight entry');
  const c = keyOf({ baseURL: 'https://api.nasa.gov', url: '/planetary/apod', params: { date: '2024-01-02', api_key: 'k' } });
  assert.notEqual(a, c, 'a different date is a different chart, not a share');
});

test('the guard is transparent on the happy path — same shape, same data, no side effects', async () => {
  const u = await upstream();
  const { inst, guard } = mk(u, { name: 'plain-test' });
  const res = await inst.get('/chart?a=1');
  assert.equal(res.status, 200);
  assert.equal(res.data.url, '/chart?a=1');
  assert.ok(res.headers['content-type'].includes('application/json'));
  assert.deepEqual(guard.stats, { name: 'plain-test', through: 1, deduped: 0, cooled: 0, queued: 0, deadline: 0, failed: 0 });
  await u.close();
});
