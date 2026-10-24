'use strict';
// Tests for the reranker gate & short-circuit. NO network, NO ONNX model load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reranker = require('../src/brain/reranker');

test('reranker: exports the expected API', () => {
  assert.equal(typeof reranker.rerank, 'function');
  assert.equal(typeof reranker.status, 'object');
  assert.equal(typeof reranker.looksDeployed, 'function');
  assert.equal(typeof reranker.available, 'function');
});

test('looksDeployed: false for a made-up path', () => {
  assert.equal(reranker.looksDeployed('/nonexistent/rerank/dir'), false);
});

test('rerank: an empty list / a single hit → returned as-is without network', async () => {
  const empty = await reranker.rerank('q', []);
  assert.deepEqual(empty, []);
  const one = [{ id: 'a', title: 'x' }];
  const r = await reranker.rerank('q', one);
  assert.equal(r.length, 1);
  assert.equal(r[0], one[0]);
});

test('available(): a boolean (not pinned to a specific value)', () => {
  assert.equal(typeof reranker.available(), 'boolean');
});

test('warm(): never throws, and says whether it warmed anything', async () => {
  // The first search after a restart used to pay the backend's own load: the cloud embed model
  // took 623 ms cold against 203 ms warm, which turned a 0.25 s search into 1.3 s for exactly
  // one visitor per deploy. Boot warm-up exists so that visitor is not a visitor. With no
  // backend configured it must still be a quiet no-op, never a boot-time throw.
  assert.equal(typeof reranker.warm, 'function');
  const warmed = await reranker.warm();
  assert.equal(typeof warmed, 'boolean');
  if (!reranker.available()) assert.equal(warmed, false, 'no backend means nothing to warm and no request');
});

test('the boot sequence warms the reranker instead of waiting for the first search', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.ok(/require\('\.\/src\/brain\/reranker'\)/.test(src), 'index.js holds the reranker');
  assert.ok(/setTimeout\(\(\) => \{ reranker\.warm\(\); \}, \d+\)/.test(src),
    'and calls warm() on a timer, off the boot path so it cannot delay readiness');
  const at = Number((/reranker\.warm\(\); \}, (\d+)\)/.exec(src) || [])[1]);
  assert.ok(at >= 10000, 'late enough to sit behind the pages that are actually being prerendered');
});
