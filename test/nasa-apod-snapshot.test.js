'use strict';
// src/nasa.js — the cold-start snapshot for /nasa.
//
// The behaviour that matters: a picture we already have on disk must be answerable in
// milliseconds, and it must never stand in for a picture that is too old to be "today's",
// nor for a request that asked for a specific date.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apod-snapshot-'));
const file = path.join(dir, 'apod-last.json');
process.env.APOD_FALLBACK_PATH = file; // read at module load, so before the require
const nasa = require('../src/nasa');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const EXPLANATION = 'A long and detailed explanation of the picture that is comfortably over the eighty character minimum the validator applies to every APOD payload.';

function payload(date) {
  return {
    date,
    title: 'The Horsehead Nebula',
    media_type: 'image',
    explanation: EXPLANATION,
    url: 'https://apod.nasa.gov/apod/image/2410/horsehead.jpg',
  };
}

const dayOffset = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const write = (obj) => fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));

test('today\'s snapshot is served from disk', () => {
  write(payload(dayOffset(0)));
  const snap = nasa.apodFromDiskIfFresh();
  assert.ok(snap, 'a snapshot from today is usable');
  assert.strictEqual(snap.title, 'The Horsehead Nebula');
});

test('yesterday\'s snapshot is still usable — the API can lag a day behind', () => {
  write(payload(dayOffset(1)));
  assert.ok(nasa.apodFromDiskIfFresh(), 'one day old is what a cold start usually has');
});

test('a snapshot from earlier in the week is usable — the page prints its date', () => {
  write(payload(dayOffset(4)));
  assert.ok(nasa.apodFromDiskIfFresh(), 'a dated picture beats a 12-second wait');
});

test('a snapshot too old to be today\'s picture is refused', () => {
  write(payload(dayOffset(10)));
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null, 'a week and a half of silence is a broken API, not a slow one');
});

test('a snapshot with no usable date is refused rather than guessed at', () => {
  write({ ...payload(undefined), date: '' });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null);
  write({ ...payload('not-a-date') });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null);
});

test('an invalid payload on disk is refused — the validator is the same one the API answers to', () => {
  write({ ...payload(dayOffset(0)), explanation: 'too short' });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null, 'a stub explanation is not a picture of the day');
  write({ ...payload(dayOffset(0)), title: 'Astronomy Picture of the Day' });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null, 'the placeholder title NASA serves during outages is not content');
  write({ ...payload(dayOffset(0)), url: 'https://www.nasa.gov/nasa-logo.png' });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null, 'the logo is not the picture');
});

test('no file at all is a null, not a throw', () => {
  fs.rmSync(file, { force: true });
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null);
  write('{not json');
  assert.strictEqual(nasa.apodFromDiskIfFresh(), null);
});

test('the shortcut is wired into getAPOD and cannot outlive the first read', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'nasa.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function getAPOD('), src.indexOf('async function getAPOD(') + 1500);
  assert.ok(fn.includes('apodFromDiskIfFresh()'), 'getAPOD asks the disk before the network');
  assert.ok(fn.includes('refreshApodBehind()'), 'and asks the API behind the response');
  assert.ok(fn.includes('refreshing: true'), 'the payload is marked as being refreshed, not as an outage');
  assert.match(fn, /if \(!date && !count && !force && !apodColdStartHandled\)/,
    'only the current-picture read, only once per process');
  assert.ok(!/staleNote/.test(fn.slice(0, fn.indexOf('const yesterday'))), 'a normal cold start must not show the "NASA is offline" note');
});
