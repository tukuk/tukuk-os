'use strict';
// Ujian gerbang & short-circuit reranker. TIADA network, TIADA muat model ONNX.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const reranker = require('../src/brain/reranker');

test('reranker: eksport API yang dijangka', () => {
  assert.equal(typeof reranker.rerank, 'function');
  assert.equal(typeof reranker.status, 'object');
  assert.equal(typeof reranker.looksDeployed, 'function');
  assert.equal(typeof reranker.available, 'function');
});

test('looksDeployed: false untuk path rekaan', () => {
  assert.equal(reranker.looksDeployed('/nonexistent/rerank/dir'), false);
});

test('rerank: senarai kosong / satu hit → pulang sama tanpa network', async () => {
  const empty = await reranker.rerank('q', []);
  assert.deepEqual(empty, []);
  const one = [{ id: 'a', title: 'x' }];
  const r = await reranker.rerank('q', one);
  assert.equal(r.length, 1);
  assert.equal(r[0], one[0]);
});

test('available(): boolean (tak terkikat pada nilai spesifik)', () => {
  assert.equal(typeof reranker.available(), 'boolean');
});
