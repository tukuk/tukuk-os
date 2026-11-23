'use strict';
// Unit tests for the live-traffic tile proxy (src/traffic-live.js).
//
// These pin the four promises the /traffic page makes to a visitor:
//   1. a tile coordinate outside the slippy-map pyramid is refused, never forwarded;
//   2. the same tile inside two minutes is NOT fetched twice (upstream stays polite);
//   3. when the provider dies we keep drawing the last copy instead of a hole;
//   4. a provider that answers with HTML is an outage, not a tile — it must never
//      overwrite the good copy in the cache.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const live = require('../src/traffic-live');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120, 7)]);

function stubImage() {
  const calls = [];
  live.__setTransport(async (url) => {
    calls.push(url);
    return { data: PNG, headers: { 'content-type': 'image/png' } };
  });
  return calls;
}

beforeEach(() => live.reset());

test('normalise refuses coordinates outside the pyramid', () => {
  assert.equal(live.normalise(1, 0, 0), null, 'zoom 1 is below the floor');
  assert.equal(live.normalise(21, 0, 0), null, 'zoom 21 is above the ceiling');
  assert.equal(live.normalise(3, 8, 0), null, 'x must be < 2^z');
  assert.equal(live.normalise(3, 0, -1), null, 'negative y is not a tile');
  assert.deepEqual(live.normalise('13', '6410', '4024'), { z: 13, x: 6410, y: 4024 });
  assert.equal(live.normalise(13.5, 1, 1), null, 'fractional zoom is not a tile');
  assert.equal(live.normalise(undefined, 1, 1), null);
});

test('upstreamUrl fills every token and rotates the subdomain', () => {
  const url = live.upstreamUrl(13, 6410, 4024);
  assert.match(url, /^https:\/\/mt[0-3]\.google\.com\/vt\/lyrs=m,traffic/);
  assert.ok(url.includes('x=6410'), url);
  assert.ok(url.includes('y=4024'), url);
  assert.ok(url.includes('z=13'), url);
  assert.ok(!url.includes('{'), 'no template token may survive');
  // (6410 + 4024) % 4 = 2 → mt2
  assert.match(url, /^https:\/\/mt2\./);
});

test('a tile is fetched once and then served from cache', async () => {
  const calls = stubImage();
  const first = await live.getTile(13, 6410, 4024);
  assert.equal(calls.length, 1);
  assert.equal(first.cached, false);
  assert.equal(first.stale, false);
  assert.equal(first.type, 'image/png');
  assert.ok(first.buf.length > 64);

  const second = await live.getTile(13, 6410, 4024);
  assert.equal(calls.length, 1, 'the second read must not touch the provider');
  assert.equal(second.cached, true);

  const s = live.status();
  assert.equal(s.tiles.upstream, 1);
  assert.ok(s.tiles.hits >= 1);
  assert.equal(s.tiles.cached, 1);
  assert.ok(s.lastOkAt > 0);
});

test('a dead provider serves the stale copy instead of a blank square', async () => {
  const calls = stubImage();
  const first = await live.getTile(12, 3204, 2012);
  assert.equal(calls.length, 1);

  // Past the fresh window but inside the stale window: the provider is consulted,
  // fails, and the last good copy must still be the answer.
  live.__age(live.FRESH_MS + 60 * 1000);
  live.__setTransport(async () => { throw new Error('ECONNREFUSED'); });

  const stale = await live.getTile(12, 3204, 2012);
  assert.ok(stale, 'a stale tile beats no tile');
  assert.equal(stale.stale, true);
  assert.equal(stale.cached, true);
  assert.deepEqual(stale.buf, first.buf, 'byte-for-byte the last good copy');
  assert.ok(live.status().tiles.errors >= 1, 'the failure is counted');
});

test('past the stale window and with no provider the tile is simply absent', async () => {
  stubImage();
  await live.getTile(12, 3204, 2012);
  live.__age(live.STALE_MS + 60 * 1000);
  live.__setTransport(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await live.getTile(12, 3204, 2012), null);
});

test('a broken answer never overwrites the cached tile', async () => {
  stubImage();
  const good = await live.getTile(10, 800, 500);

  // Age past the fresh window so the provider really is called, then answer with the
  // exact shape that poisons a map: an HTML 404 body served with a 200.
  live.__age(live.FRESH_MS + 1000);
  live.__setTransport(async () => ({
    data: Buffer.from('<!doctype html><title>404</title>'),
    headers: { 'content-type': 'text/html' },
  }));

  const again = await live.getTile(10, 800, 500);
  assert.ok(again, 'the cache still answers');
  assert.equal(again.stale, true);
  assert.deepEqual(again.buf, good.buf, 'the HTML body must not reach the map');
  assert.ok(live.status().tiles.errors >= 1);
});

test('no cache and no provider answers null (route then sends a transparent tile)', async () => {
  live.__setTransport(async () => { throw new Error('timeout'); });
  const tile = await live.getTile(9, 100, 100);
  assert.equal(tile, null);
  assert.ok(live.status().tiles.errors >= 1);
  assert.equal(live.TRANSPARENT.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a real 1x1 PNG header');
});

test('status never leaks anything but counters', async () => {
  stubImage();
  await live.getTile(11, 1602, 1006);
  const s = live.status();
  assert.equal(typeof s.source, 'string');
  assert.ok(s.refreshSec >= 60);
  assert.ok(s.staleSec > s.refreshSec);
  assert.ok(s.tiles.bytes > 0);
  assert.equal(JSON.stringify(s).includes('6410'), false, 'tile coordinates are not reported');
});
