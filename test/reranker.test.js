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

test('qualityPrior(): the page we reviewed settles a near-tie, and only a near-tie', () => {
  // Meilisearch ranks by `quality:desc` before exactness, and the cloud reranker used to throw
  // that away by ordering on cosine alone: for "largest deserts by area" our geography-record
  // page (0.593) lost to a BBC wildfire story (0.598) by five thousandths of cosine. The prior
  // is deliberately smaller than any real relevance gap, so it can only break a tie.
  const ours = reranker.qualityPrior({ quality: 0.95 });
  const crawled = reranker.qualityPrior({ quality: 0.5 });
  assert.ok(ours > 0.05 && ours < 0.08, 'a reviewed page carries a small positive nudge');
  assert.equal(crawled, 0, 'a crawled page carries none, which is what the old behaviour amounted to');
  assert.equal(reranker.qualityPrior({}), 0, 'a hit with no quality is a crawled page, not a bonus');
  assert.equal(reranker.qualityPrior({ quality: 'x' }), 0, 'and junk is not arithmetic');
  assert.ok(ours - 0.598 + 0.593 > 0, 'and that nudge is enough to put the reviewed page back on top');
  // The index carries a second scale: some crawled records hold 0-100 (96, 94 were the first two
  // seen). Un-normalised, 0.15 × 95.5 = +14 would bury every real similarity score — which is
  // how an MDN page about HTTP answered "solar panel efficiency" for a few minutes on 25 Oct 2026.
  const hundred = reranker.qualityPrior({ quality: 96 });
  assert.ok(hundred > 0 && hundred < 0.08, 'a 0-100 score is read on the same scale, not eleven times louder');
  assert.ok(Math.abs(hundred - reranker.qualityPrior({ quality: 0.96 })) < 1e-9, 'and the two spellings agree');
});

test('the cloud reranker scores relevance plus that prior, and the local one does not pretend to', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'brain', 'reranker.js'), 'utf8');
  assert.ok(/cosine\(qv, vecs\[i \+ 1\]\) \+ qualityPrior\(hit\)/.test(src),
    'the cloud path adds the prior to every hit');
  assert.ok(/No quality prior here[\s\S]{0,200}raw, unbounded logit/.test(src),
    'the local path says why it does not, instead of quietly adding a number that means nothing');
});
