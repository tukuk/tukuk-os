'use strict';
// Ujian pustaka templat deterministik Tukuk Code (src/brain/codegen.js).
// Template = penjimatan LLM: permintaan umum → keluaran siap-jalan tanpa model.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cg = require('../src/brain/codegen');

test('detectTemplate: kata kunci ms/en → key templat; selain itu kosong', () => {
  assert.equal(cg.detectTemplate('buat game ular'), 'snake');
  assert.equal(cg.detectTemplate('snake'), 'snake');
  assert.equal(cg.detectTemplate('permainan padanan kad'), 'memory');
  assert.equal(cg.detectTemplate('memory match'), 'memory');
  assert.equal(cg.detectTemplate('pomodoro timer fokus'), 'pomodoro');
  assert.equal(cg.detectTemplate('aplikasi kedai'), '', 'tiada padan → kosong');
});

test('scaffoldFor: goal game/app yang padan → single-file template; lain → fallback sedia ada', () => {
  const s = cg.scaffoldFor('game', 'snake');
  assert.equal(s.template, 'snake');
  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].path, 'index.html');
  assert.match(s.files[0].contents, /<!DOCTYPE html>/);

  const a = cg.scaffoldFor('app', 'pomodoro');
  assert.equal(a.template, 'pomodoro');
  assert.equal(a.files.length, 1);

  // backward-compat: goal tanpa padanan → fail game.js generik sedia ada (2 fail)
  const g = cg.scaffoldFor('game', 'projek asing xyz');
  assert.ok(!g.template, 'tiada template untuk goal asing');
  assert.equal(g.files.length, 2);
  assert.equal(g.files[1].path, 'game.js');
});

test('listTemplates & TEMPLATES: setiap templat HTML sah, tanpa backtick (selamat sbg literal)', () => {
  const keys = cg.listTemplates();
  assert.deepEqual(keys.slice().sort(), ['memory', 'pomodoro', 'snake']);
  for (const k of keys) {
    const html = cg.TEMPLATES[k];
    assert.match(html, /^<!DOCTYPE html>/, k + ' bermula DOCTYPE');
    assert.ok(html.includes('<script>') && html.includes('</script>'), k + ' ada script tertutup');
    assert.ok(!html.includes('`'), k + ' tiada backtick (konvensyen fail)');
    assert.ok(!html.includes('${'), k + ' tiada interpolasi ${');
  }
});
