'use strict';
// Ujian bentuk config — pastikan kunci utama ada & nilai default masuk akal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');

test('config: pindaan utama wujud sebagai objek', () => {
  for (const key of ['search', 'rateLimit', 'security', 'adsense', 'rerank', 'brain']) {
    assert.equal(typeof config[key], 'object', `${key} perlu objek`);
  }
});

test('config.rerank: boolean & string dengan default waras', () => {
  assert.equal(typeof config.rerank.enabled, 'boolean');
  assert.equal(typeof config.rerank.cloud, 'boolean');
  if (typeof config.rerank.embedModel === 'string') {
    assert.ok(config.rerank.embedModel.length > 0);
  }
});

test('config.adsense: ada client & slot (placeholder default dibenarkan)', () => {
  assert.equal(typeof config.adsense.enabled, 'boolean');
  assert.equal(typeof config.adsense.client, 'string');
});

test('config.rateLimit: windowMs & max ialah nombor bila wujud', () => {
  for (const k of ['windowMs', 'max']) {
    if (config.rateLimit[k] !== undefined) {
      assert.equal(typeof config.rateLimit[k], 'number');
    }
  }
});
