'use strict';
// Ujian unit src/lang.js — pengesanan locale, tokenisasi & pemisah ayat Unicode.
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
test('detectLocale: contoh didokumentasi + fallback English', () => {
  assert.strictEqual(detectLocale('apa itu DNS'), 'ms');
  assert.strictEqual(detectLocale('什么是API'), 'zh');
  assert.strictEqual(detectLocale('how do I reset my password'), 'en');
  assert.strictEqual(detectLocale(''), 'en');
  assert.strictEqual(detectLocale(null), 'en');
});

// ── isSpacelessScript ──
test('isSpacelessScript: CJK/JP/KO benar, Latin salah', () => {
  assert.strictEqual(isSpacelessScript('中文测试'), true);
  assert.strictEqual(isSpacelessScript('日本語です'), true);
  assert.strictEqual(isSpacelessScript('한국어'), true);
  assert.strictEqual(isSpacelessScript('hello world'), false);
  assert.strictEqual(isSpacelessScript(''), false);
});

// ── splitSentencesUnicode ──
test('splitSentencesUnicode: penamat Latin [.!?]', () => {
  assert.deepStrictEqual(
    splitSentencesUnicode('Hello world. Second one! Third?'),
    ['Hello world.', 'Second one!', 'Third?']
  );
});
test('splitSentencesUnicode: penamat CJK 。 dan runtuh ruang', () => {
  assert.deepStrictEqual(splitSentencesUnicode('一。二'), ['一。', '二']);
  assert.deepStrictEqual(splitSentencesUnicode('  a b   c  '), ['a b c']);
  assert.deepStrictEqual(splitSentencesUnicode(''), []);
});

// ── tokenizeQuery ──
test('tokenizeQuery: beruang — token ≥2 aksara, buang satu huruf', () => {
  assert.deepStrictEqual(tokenizeQuery('hello world'), ['hello', 'world']);
  assert.deepStrictEqual(tokenizeQuery('a bb c cc'), ['bb', 'cc']);
  // kekalkan + dan . teknikal
  assert.deepStrictEqual(tokenizeQuery('C++ node.js'), ['c++', 'node.js']);
  assert.deepStrictEqual(tokenizeQuery('   '), []);
});
test('tokenizeQuery: tanpa-ruang — satu aksara CJK satu token', () => {
  assert.deepStrictEqual(tokenizeQuery('中文测试'), ['中', '文', '测', '试']);
});

// ── t (rangkaian paparan) ──
test('t: padan locale, jatuh ke en untuk locale tak diketahui', () => {
  assert.strictEqual(t('sourcesLabel', 'ms'), 'Sumber');
  assert.strictEqual(t('sourcesLabel', 'de'), 'Quellen');
  assert.strictEqual(t('sourcesLabel', 'zz'), 'Sources'); // fallback en
  assert.strictEqual(t('tiada-kunci', 'en'), '');           // kunci tak wujud → ''
  assert.ok(t('dontKnow', 'ms').includes('Tukuk-OS'));
});
