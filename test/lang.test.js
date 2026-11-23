'use strict';
// Unit tests for src/lang.js — locale detection, tokenisation & the Unicode sentence splitter.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  detectLocale,
  isSpacelessScript,
  splitSentencesUnicode,
  tokenizeQuery,
  t
} = require('../src/lang');

// ── detectLocale ──
test('detectLocale: documented examples + the English fallback', () => {
  assert.strictEqual(detectLocale('apa itu DNS'), 'ms');
  assert.strictEqual(detectLocale('什么是API'), 'zh');
  assert.strictEqual(detectLocale('how do I reset my password'), 'en');
  assert.strictEqual(detectLocale(''), 'en');
  assert.strictEqual(detectLocale(null), 'en');
});

// ── isSpacelessScript ──
test('isSpacelessScript: CJK/JP/KO true, Latin false', () => {
  assert.strictEqual(isSpacelessScript('中文测试'), true);
  assert.strictEqual(isSpacelessScript('日本語です'), true);
  assert.strictEqual(isSpacelessScript('한국어'), true);
  assert.strictEqual(isSpacelessScript('hello world'), false);
  assert.strictEqual(isSpacelessScript(''), false);
});

// ── splitSentencesUnicode ──
test('splitSentencesUnicode: Latin terminators [.!?]', () => {
  assert.deepStrictEqual(
    splitSentencesUnicode('Hello world. Second one! Third?'),
    ['Hello world.', 'Second one!', 'Third?']
  );
});
test('splitSentencesUnicode: the CJK terminator 。 and whitespace collapse', () => {
  assert.deepStrictEqual(splitSentencesUnicode('一。二'), ['一。', '二']);
  assert.deepStrictEqual(splitSentencesUnicode('  a b   c  '), ['a b c']);
  assert.deepStrictEqual(splitSentencesUnicode(''), []);
});

// ── tokenizeQuery ──
test('tokenizeQuery: plain text — tokens of ≥2 chars, single letters dropped', () => {
  assert.deepStrictEqual(tokenizeQuery('hello world'), ['hello', 'world']);
  assert.deepStrictEqual(tokenizeQuery('a bb c cc'), ['bb', 'cc']);
  // technical + and . are kept
  assert.deepStrictEqual(tokenizeQuery('C++ node.js'), ['c++', 'node.js']);
  assert.deepStrictEqual(tokenizeQuery('   '), []);
});
test('tokenizeQuery: spaceless scripts — one CJK character per token', () => {
  assert.deepStrictEqual(tokenizeQuery('中文测试'), ['中', '文', '测', '试']);
});

// ── t (display strings) ──
test('t: matches the locale, falls back to en for an unknown locale', () => {
  assert.strictEqual(t('sourcesLabel', 'ms'), 'Sumber');
  assert.strictEqual(t('sourcesLabel', 'de'), 'Quellen');
  assert.strictEqual(t('sourcesLabel', 'zz'), 'Sources'); // en fallback
  assert.strictEqual(t('no-such-key', 'en'), '');          // unknown key → ''
  assert.ok(t('dontKnow', 'ms').includes('Tukuk-OS'));
});
