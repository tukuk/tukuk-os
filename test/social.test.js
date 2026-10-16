// Ujian modul social finder (src/social.js) — validasi & kontrak sahaja.
// TIADA rangkaian: hanya input rosak diuji supaya endpoint tak boleh dibom
// nama haram dan senarai platform kekal konsisten.
const { test } = require('node:test');
const assert = require('node:assert');
const social = require('../src/social');

test('normalizeUsername: buang @ depan & ruang, terima aksara sah', () => {
  assert.equal(social.normalizeUsername('@torvalds'), 'torvalds');
  assert.equal(social.normalizeUsername(' user.name_2-x '), 'user.name_2-x');
  assert.equal(social.normalizeUsername('1abc'), '1abc');
});

test('normalizeUsername: tolak nama kosong / pendek / panjang / sisipan', () => {
  assert.equal(social.normalizeUsername(''), null);
  assert.equal(social.normalizeUsername('a'), null);            // min 2 aksara
  assert.equal(social.normalizeUsername('x'.repeat(32)), null); // maks 31
  assert.equal(social.normalizeUsername('has space'), null);
  assert.equal(social.normalizeUsername('injek/tion?x=1'), null);
  assert.equal(social.normalizeUsername('.mulai-titik'), null);
});

test('lookup: nama tidak sah → error tanpa menyentuh rangkaian', async () => {
  const d = await social.lookup('bad name!!');
  assert.ok(d.error);
  assert.equal(typeof d.username, 'undefined');
});

test('PLATFORMS: setiap entri ada nama + templat URL https', () => {
  assert.ok(social.PLATFORMS.length >= 8);
  for (const p of social.PLATFORMS) {
    assert.ok(p.name, 'platform perlu nama');
    assert.match(p.url('abc'), /^https:\/\//, `${p.name} URL mestilah https`);
  }
});
