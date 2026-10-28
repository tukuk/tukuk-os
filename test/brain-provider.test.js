'use strict';
// Tests for the LiteRT edge tier registration in the provider rotation.
// The config/provider modules are re-read (cache dropped) with different env values so
// both states (LITERT_HOST present / absent) can be verified.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshRequire(host) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/src/')) delete require.cache[k];
  }
  // Deleting the variable is not enough on a configured box: src/config.js reads the repo `.env`
  // and puts LITERT_HOST straight back, so the "absent" case quietly exercised the present one
  // and this file failed wherever the edge tier is actually set up. The loader never overwrites
  // a key that is already in process.env, so an empty value wins — and an empty host means the
  // same thing to the provider as no host at all.
  process.env.LITERT_HOST = host === undefined ? '' : host;
  return require('../src/brain/provider');
}

test('litert: unavailable without LITERT_HOST', () => {
  const p = freshRequire(undefined);
  assert.ok(p.CLOUD_PROVIDERS.litert, 'the litert entry should be registered');
  assert.equal(p.CLOUD_PROVIDERS.litert.kind, 'openai');
  const names = p.listCloudProviders().map((x) => x.name);
  assert.ok(!names.includes('litert'), 'without env, litert must not enter the rotation');
});

test('litert: available with LITERT_HOST + a dynamic baseUrl', () => {
  const host = 'http://127.0.0.1:8090/v1';
  const p = freshRequire(host);
  assert.equal(p.providerBaseUrl('litert'), host);
  const found = p.listCloudProviders().find((x) => x.name === 'litert');
  assert.ok(found, 'with env set, litert should appear in the list');
  assert.equal(found.baseUrl, host);
  assert.ok(found.key, 'a marker key exists so cloudAvailable passes');
  // The other tiers are unaffected: groq still uses its static baseUrl.
  assert.equal(p.providerBaseUrl('groq'), 'https://api.groq.com/openai/v1');
});

test('litert: the default order puts it last', () => {
  const p = freshRequire('http://127.0.0.1:8090/v1');
  const config = require('../src/config');
  const order = String(config.brain.cloudOrder).split(',');
  assert.equal(order[order.length - 1], 'litert', 'the local tier is the slowest — last in line');
  void p;
});
