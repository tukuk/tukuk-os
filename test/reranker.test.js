'use strict';
// Tests for the reranker gate & short-circuit. NO network, NO ONNX model load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
