'use strict';
// src/js-errors.js — the visitor error log behind /api/js-error.
//
// The property under test is not "an entry is saved" but "a repeat is recorded as a repeat".
// The original merge bumped `count` and `lastAt` on an entry it then never wrote back, so every
// entry stayed at count 1 with the timestamp of its first sighting: a browser error that fires
// on every visit read exactly like one that happened once three weeks ago.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const log = require('../src/js-errors');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-errors-'));
const file = path.join(dir, 'js-errors.json');
const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a first report is stored once, with count 1 and no lastAt', () => {
  fs.rmSync(file, { force: true });
  const stored = log.record({ message: 'escapeHtml is not defined', page: '/?q=a', kind: 'error', line: 1377 }, file);
  assert.strictEqual(stored.count, 1);
  assert.strictEqual(stored.lastAt, undefined);
  const list = onDisk();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].message, 'escapeHtml is not defined');
});

test('the same error on the next visit is written back as a repeat', () => {
  const stored = log.record({ message: 'escapeHtml is not defined', page: '/?q=a' }, file);
  assert.strictEqual(stored.count, 2, 'the second sighting is counted');
  assert.ok(stored.lastAt, 'and dated');
  assert.notStrictEqual(stored.at, stored.lastAt, 'first seen and last seen are different facts');
  const list = onDisk();
  assert.strictEqual(list.length, 1, 'still one entry, not two');
  assert.strictEqual(list[0].count, 2, 'the count reached the disk — this is what the old code lost');
  assert.ok(list[0].lastAt, 'and so did the timestamp');
});

test('the same message on a different page is a different error', () => {
  log.record({ message: 'escapeHtml is not defined', page: '/books' }, file);
  assert.strictEqual(onDisk().length, 2);
});

test('a repeat moves to the front, so an active error outlives a burst of one-offs', () => {
  fs.rmSync(file, { force: true });
  log.record({ message: 'old but repeating', page: '/a' }, file);
  for (let i = 0; i < 5; i += 1) log.record({ message: `one-off ${i}`, page: '/b' }, file);
  assert.strictEqual(onDisk()[0].message, 'one-off 4');
  log.record({ message: 'old but repeating', page: '/a' }, file);
  const list = onDisk();
  assert.strictEqual(list[0].message, 'old but repeating', 'the recurring error is back at the top');
  assert.strictEqual(list[0].count, 2);
  assert.strictEqual(list.length, 6);
});

test('the log is capped: one-offs age out, and writes stay atomic', () => {
  fs.rmSync(file, { force: true });
  for (let i = 0; i < log.MAX + 20; i += 1) log.record({ message: `m${i}`, page: '/' }, file);
  const list = onDisk();
  assert.strictEqual(list.length, log.MAX);
  assert.strictEqual(list[0].message, `m${log.MAX + 19}`, 'newest first');
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temporary file is left behind');
});

test('a message is required; an empty or missing one writes nothing', () => {
  fs.rmSync(file, { force: true });
  assert.strictEqual(log.record({ page: '/x' }, file), null);
  assert.strictEqual(log.record({ message: '   ', page: '/x' }, file), null);
  assert.strictEqual(fs.existsSync(file), false, 'a rejected report must not create the file');
});

test('a corrupt or foreign file reads as an empty log instead of throwing', () => {
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(log.read(file), []);
  const stored = log.record({ message: 'after corruption', page: '/' }, file);
  assert.strictEqual(stored.count, 1);
  assert.strictEqual(onDisk().length, 1, 'the bad file is replaced, not appended to');
  fs.writeFileSync(file, '{"errors":[]}');
  assert.deepStrictEqual(log.read(file), [], 'an object is not a log');
  fs.rmSync(file, { force: true });
  assert.deepStrictEqual(log.read(file), []);
});

test('free text is bounded before it reaches the disk', () => {
  fs.rmSync(file, { force: true });
  const stored = log.record({ message: 'x'.repeat(2000), page: '/' + 'p'.repeat(2000), ua: 'u'.repeat(2000) }, file);
  assert.ok(stored.message.length <= 401);
  assert.ok(stored.page.length <= 301);
  assert.ok(stored.ua.length <= 201);
});

test('the page really reports, and the route really records', () => {
  const theme = fs.readFileSync(path.join(__dirname, '..', 'public', 'theme.js'), 'utf8');
  assert.ok(theme.includes("sendBeacon('/api/js-error'"), 'theme.js still posts to the endpoint');
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.ok(server.includes("app.post('/api/js-error'"), 'the POST route exists');
  assert.ok(server.includes('jsErrorLog.record('), 'the route goes through the module, not a private copy of it');
  assert.ok(server.includes('jsErrorLog.read()'), 'and the GET route reads the same file');
});
