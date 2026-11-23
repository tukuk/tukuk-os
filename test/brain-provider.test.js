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
  // The operator's .env may pin its own rotation in LLM_CLOUD_ORDER. Where litert lands is a
  // property of the default order in src/config.js, not of the box it happens to run on, so the
  // pinned value is masked here: the .env loader never overwrites a key already in process.env,
  // and src/config.js falls back to its default when the value is empty.
  process.env.LLM_CLOUD_ORDER = '';
  if (host === undefined) delete process.env.LITERT_HOST;
  else process.env.LITERT_HOST = host;
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

// ── Groq veto (owner decision) ───────────────────────────────────────────────
// Groq stays in CLOUD_PROVIDERS (characterisation tests + providerBaseUrl), but it must
// NEVER reach the rotation — not through the default order, not through LLM_CLOUD_ORDER,
// not through a leftover GROQ_API_KEY, not through the admin aiProvider setting.
test('groq: a GROQ_API_KEY alone can never enter the rotation', () => {
  process.env.GROQ_API_KEY = 'gsk_stale_should_be_ignored';
  const p = freshRequire(undefined);
  assert.equal(p.isDisabled('groq'), true, 'groq is on the default veto list');
  assert.ok(!p.listCloudProviders().some((x) => x.name === 'groq'), 'a stale key must not activate it');
  delete process.env.GROQ_API_KEY;
});

test('groq: listing it in LLM_CLOUD_ORDER is still vetoed', () => {
  process.env.GROQ_API_KEY = 'gsk_stale';
  const p = freshRequire(undefined);
  // freshRequire masks the operator's order; override the loaded config to simulate a
  // .env that still lists groq (the real-world upgrade case).
  require('../src/config').brain.cloudOrder = 'groq,openrouter';
  const names = p.listCloudProviders().map((x) => x.name);
  assert.ok(!names.includes('groq'), 'the env order cannot re-admit a vetoed provider');
  delete process.env.GROQ_API_KEY;
});

test('groq: the veto can be lifted explicitly (order must name it too)', () => {
  process.env.LLM_DISABLED_PROVIDERS = '';
  process.env.GROQ_API_KEY = 'gsk_ok';
  const p = freshRequire(undefined);
  assert.equal(p.isDisabled('groq'), false);
  // Two independent locks: the veto list AND the default order. The default order no
  // longer names groq, so lifting only the veto is not enough.
  const config = require('../src/config');
  assert.ok(!p.listCloudProviders().some((x) => x.name === 'groq'), 'default order does not name it');
  config.brain.cloudOrder = 'groq,openrouter';
  assert.ok(p.listCloudProviders().some((x) => x.name === 'groq'), 'veto lifted + named in the order → admitted');
  delete process.env.LLM_DISABLED_PROVIDERS;
  delete process.env.GROQ_API_KEY;
});
