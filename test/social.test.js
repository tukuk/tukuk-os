// Tests for the social finder module (src/social.js) — validation and contracts only.
// NO network: only broken input is tested so the endpoints cannot be bombarded
// with invalid names and the platform list stays consistent.
const { test } = require('node:test');
const assert = require('node:assert');
const social = require('../src/social');

test('normalizeUsername: strips a leading @ and spaces, accepts valid characters', () => {
  assert.equal(social.normalizeUsername('@torvalds'), 'torvalds');
  assert.equal(social.normalizeUsername(' user.name_2-x '), 'user.name_2-x');
  assert.equal(social.normalizeUsername('1abc'), '1abc');
});

test('normalizeUsername: rejects empty / too short / too long / injected names', () => {
  assert.equal(social.normalizeUsername(''), null);
  assert.equal(social.normalizeUsername('a'), null);            // min 2 characters
  assert.equal(social.normalizeUsername('x'.repeat(32)), null); // max 31
  assert.equal(social.normalizeUsername('has space'), null);
  assert.equal(social.normalizeUsername('inject/ion?x=1'), null);
  assert.equal(social.normalizeUsername('.leading-dot'), null);
});

test('lookup: an invalid name → an error without touching the network', async () => {
  const d = await social.lookup('bad name!!');
  assert.ok(d.error);
  assert.equal(typeof d.username, 'undefined');
});

test('PLATFORMS: every entry has a name + an https URL template', () => {
  assert.ok(social.PLATFORMS.length >= 21);
  for (const p of social.PLATFORMS) {
    assert.ok(p.name, 'a platform needs a name');
    assert.match(p.url('abc'), /^https:\/\//, `${p.name} URL must be https`);
  }
});
