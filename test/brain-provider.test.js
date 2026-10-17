'use strict';
// Ujian pendaftaran tier pinggir LiteRT dalam rotasi pembekal.
// Config/provider dibaca SEMULA (cache dibuang) dengan env berbeza supaya
// kedua-dua keadaan (LITERT_HOST ada / tiada) boleh disahkan.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshRequire(host) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/src/')) delete require.cache[k];
  }
  if (host === undefined) delete process.env.LITERT_HOST;
  else process.env.LITERT_HOST = host;
  return require('../src/brain/provider');
}

test('litert: tidak tersedia tanpa LITERT_HOST', () => {
  const p = freshRequire(undefined);
  assert.ok(p.CLOUD_PROVIDERS.litert, 'entri litert wajar didaftarkan');
  assert.equal(p.CLOUD_PROVIDERS.litert.kind, 'openai');
  const names = p.listCloudProviders().map((x) => x.name);
  assert.ok(!names.includes('litert'), 'tanpa env, litert tak boleh masuk rotasi');
});

test('litert: tersedia dengan LITERT_HOST + baseUrl dinamik', () => {
  const host = 'http://127.0.0.1:8090/v1';
  const p = freshRequire(host);
  assert.equal(p.providerBaseUrl('litert'), host);
  const found = p.listCloudProviders().find((x) => x.name === 'litert');
  assert.ok(found, 'dengan env, litert wajar muncul dalam senarai');
  assert.equal(found.baseUrl, host);
  assert.ok(found.key, 'key penanda wujud supaya cloudAvailable lulus');
  // Tier lain tak terjejas: groq masih pakai baseUrl statiknya.
  assert.equal(p.providerBaseUrl('groq'), 'https://api.groq.com/openai/v1');
});

test('litert: susunan default letakkannya paling belakang', () => {
  const p = freshRequire('http://127.0.0.1:8090/v1');
  const config = require('../src/config');
  const order = String(config.brain.cloudOrder).split(',');
  assert.equal(order[order.length - 1], 'litert', 'tier lokal paling perlahan — barisan terakhir');
  void p;
});
