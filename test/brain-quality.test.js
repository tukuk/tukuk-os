'use strict';
// Tests for the /ask answer quality gate: the echo-eater + the extractive generator.
// Two real failures are covered here:
//   1. A SHORT cloud answer (or an honest "I don't know" refusal) used to be thrown
//      away as echo → the system fell back to an extractive paragraph.
//   2. A sentence that only deleted the question words ("how", "many") was enough to be
//      an "answer" for a question about a completely different entity.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isEcho, extractiveAnswer, contentTerms } = require('../src/brain/quality');

const PROMPT = [
  'QUESTION: how many counties does California have',
  'SOURCES (source [1] is the closest match):',
  '[1] California counties — California is a state in the United States.'
].join('\n\n');

test('isEcho: a small model still rejects an answer below 40 characters', () => {
  assert.equal(isEcho('California has 58 counties.', PROMPT), true);
});

test('isEcho: a large cloud model accepts a valid short answer', () => {
  assert.equal(isEcho('California has 58 counties.', PROMPT, { smallModel: false }), false);
});

test('isEcho: an honest refusal is accepted (not turned into a wrong essay)', () => {
  assert.equal(isEcho("I don't know.", PROMPT, { smallModel: false }), false);
});

test('isEcho: re-copying the question/prompt labels is rejected even for the cloud model', () => {
  assert.equal(isEcho('how many counties does California have', PROMPT, { smallModel: false }), true);
  assert.equal(isEcho('QUESTION: how many counties does California have', PROMPT, { smallModel: false }), true);
});

test('isEcho: a repeating sentence (loop) is still rejected in both modes', () => {
  const loop = 'It is a county. It is a county. It is a county. It is a county indeed.';
  assert.equal(isEcho(loop, PROMPT), true);
  assert.equal(isEcho(loop, PROMPT, { smallModel: false }), true);
});

test('isEcho: raw quoted source text — loose for the cloud, strict for a small model', () => {
  const cited = 'California has fifty-eight counties in total, of which Los Angeles is the most populous.\n\n(Sources: California counties)';
  assert.equal(isEcho(cited, PROMPT), true);
  assert.equal(isEcho(cited, PROMPT, { smallModel: false }), false);
});

test('contentTerms: question/quantity words are dropped, entities are kept', () => {
  assert.deepEqual(
    contentTerms(['how', 'many', 'counties', 'does', 'california', 'have']),
    ['counties', 'california']
  );
});

test('extractiveAnswer: a sentence that only deletes the question words is NOT an answer', () => {
  // This is exactly the production case: the California county-count question was lifted
  // from a conservation blog mentioning "how many?" — not a California fact.
  const hits = [{
    title: 'The Data Gap in Biology',
    url: '/blog/data-gap',
    content: 'Every conservation decision starts with a boring question: where are they, and how many? '
      + 'You cannot protect a population you have never located.'
  }];
  const out = extractiveAnswer('how many counties does California have', hits);
  assert.equal(out.method, 'extractive-fallback-list');
  assert.ok(!out.answer.includes('conservation'), 'an unrelated paragraph must not become the answer');
});

test('extractiveAnswer: the sentence matching the entity is used', () => {
  const out = extractiveAnswer('capital of Kenya', [{
    title: 'Kenya',
    url: '/wiki/kenya',
    content: 'Nairobi is the capital and largest city of Kenya, sitting on a high plateau.'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('Nairobi is the capital'));
});

test('extractiveAnswer: only ONE document — no stitched-together articles', () => {
  const hits = [{
    title: 'Kenya',
    url: '/wiki/kenya',
    content: 'Nairobi is the capital and largest city of Kenya, sitting on a high plateau.'
  }, {
    title: 'Fashion Week',
    url: '/blog/fashion',
    content: 'The capital of fashion week dates are announced every season in advance.'
  }];
  const out = extractiveAnswer('capital of Kenya', hits);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('Nairobi'), 'the top document must win');
  assert.ok(!out.answer.includes('fashion'), 'the second article must not be sewn in');
  assert.ok(!out.answer.includes('Fashion Week'), 'the source label mentions only one document');
});

test('extractiveAnswer: Malay questions still work', () => {
  const out = extractiveAnswer('apa itu lagoon', [{
    title: 'Lagoon',
    url: '/lagoons/world',
    content: 'A lagoon is a shallow body of water separated from a larger sea by reef or barrier islands.'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(/lagoon/i.test(out.answer));
});

test('extractiveAnswer: a spaceless script (CJK) is not broken by missing content terms', () => {
  const out = extractiveAnswer('ケニアの首都', [{
    title: 'ナイロビ',
    url: '/wiki/nairobi',
    content: 'ナイロビはケニアの首都であり、東アフリカ有数の大都市でもあります。'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('ナイロビ'));
});
