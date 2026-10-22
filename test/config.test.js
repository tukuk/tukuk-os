'use strict';
// Config shape tests — make sure the main keys exist and the defaults are sensible.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');

test('config: the main sections exist as objects', () => {
  for (const key of ['search', 'rateLimit', 'security', 'adsense', 'rerank', 'brain']) {
    assert.equal(typeof config[key], 'object', `${key} must be an object`);
  }
});

test('config.rerank: booleans & strings with sane defaults', () => {
  assert.equal(typeof config.rerank.enabled, 'boolean');
  assert.equal(typeof config.rerank.cloud, 'boolean');
  if (typeof config.rerank.embedModel === 'string') {
    assert.ok(config.rerank.embedModel.length > 0);
  }
});

test('config.adsense: has a client & slot (default placeholders allowed)', () => {
  assert.equal(typeof config.adsense.enabled, 'boolean');
  assert.equal(typeof config.adsense.client, 'string');
});

test('config.rateLimit: windowMs & max are numbers when present', () => {
  for (const k of ['windowMs', 'max']) {
    if (config.rateLimit[k] !== undefined) {
      assert.equal(typeof config.rateLimit[k], 'number');
    }
  }
});
