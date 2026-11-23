'use strict';
// Swapping the traffic provider must be configuration, not code (see the header of
// src/traffic-live.js). Two failures are pinned here, both of which are silent in
// production: a keyed template shipped without its key would hammer the provider with
// 403s on every tile, and a key must never be spliced into a template that never asked
// for it — nor appear in /api/traffic/live, which is a public endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');

const MODULE = require.resolve('../src/traffic-live.js');
const TOMTOM = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key={apiKey}';

function load(env) {
  delete require.cache[MODULE];
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const mod = require(MODULE);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return mod;
}

test('a keyed provider without its key is treated as unconfigured', () => {
  const live = load({ TRAFFIC_TILE_URL: TOMTOM, TRAFFIC_API_KEY: '', TRAFFIC_SOURCE_LABEL: 'TomTom live traffic' });
  assert.equal(live.upstreamUrl(13, 6410, 4024), '', 'no URL is built without a key');
  const s = live.status();
  assert.equal(s.provider, '', 'the status page does not claim a provider it cannot reach');
  assert.equal(s.source, 'TomTom live traffic', 'the label still follows the configuration');
});

test('a keyed provider with its key fills the placeholder and keeps the key out of status', () => {
  const live = load({ TRAFFIC_TILE_URL: TOMTOM, TRAFFIC_API_KEY: 'SECRET123', TRAFFIC_SOURCE_LABEL: 'TomTom live traffic' });
  assert.equal(live.upstreamUrl(13, 6410, 4024),
    'https://api.tomtom.com/traffic/map/4/tile/flow/relative/13/6410/4024.png?key=SECRET123');
  const s = live.status();
  assert.equal(s.provider, 'api.tomtom.com');
  assert.equal(JSON.stringify(s).includes('SECRET123'), false, 'the key never reaches a public payload');
});

test('a keyless template ignores the key entirely', () => {
  const live = load({ TRAFFIC_TILE_URL: 'https://tile.example.com/{z}/{x}/{y}.png', TRAFFIC_API_KEY: 'SECRET123' });
  const url = live.upstreamUrl(3, 2, 1);
  assert.equal(url, 'https://tile.example.com/3/2/1.png');
  assert.equal(url.includes('SECRET123'), false, 'an unused key is not appended');
});
