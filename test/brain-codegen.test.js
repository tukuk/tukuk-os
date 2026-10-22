'use strict';
// Tests for the deterministic Tukuk Code template library (src/brain/codegen.js).
// Templates = LLM savings: a common request → ready-to-run output without a model.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cg = require('../src/brain/codegen');

test('detectTemplate: ms/en keywords → template key; anything else is empty', () => {
  assert.equal(cg.detectTemplate('buat game ular'), 'snake');
  assert.equal(cg.detectTemplate('snake'), 'snake');
  assert.equal(cg.detectTemplate('permainan padanan kad'), 'memory');
  assert.equal(cg.detectTemplate('memory match'), 'memory');
  assert.equal(cg.detectTemplate('pomodoro timer fokus'), 'pomodoro');
  assert.equal(cg.detectTemplate('aplikasi kedai'), '', 'no match → empty');
});

test('scaffoldFor: a matching game/app goal → a single-file template; otherwise the existing fallback', () => {
  const s = cg.scaffoldFor('game', 'snake');
  assert.equal(s.template, 'snake');
  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].path, 'index.html');
  assert.match(s.files[0].contents, /<!DOCTYPE html>/);

  const a = cg.scaffoldFor('app', 'pomodoro');
  assert.equal(a.template, 'pomodoro');
  assert.equal(a.files.length, 1);

  // backward-compat: a goal with no template match → the existing generic game.js files (2 files)
  const g = cg.scaffoldFor('game', 'foreign project xyz');
  assert.ok(!g.template, 'no template for an unmatched goal');
  assert.equal(g.files.length, 2);
  assert.equal(g.files[1].path, 'game.js');
});

test('listTemplates & TEMPLATES: every template is valid HTML, no backtick (safe as a literal)', () => {
  const keys = cg.listTemplates();
  assert.deepEqual(keys.slice().sort(), ['memory', 'pomodoro', 'snake']);
  for (const k of keys) {
    const html = cg.TEMPLATES[k];
    assert.match(html, /^<!DOCTYPE html>/, k + ' starts with DOCTYPE');
    assert.ok(html.includes('<script>') && html.includes('</script>'), k + ' has a closed script tag');
    assert.ok(!html.includes('`'), k + ' has no backtick (file convention)');
    assert.ok(!html.includes('${'), k + ' has no ${ interpolation');
  }
});
