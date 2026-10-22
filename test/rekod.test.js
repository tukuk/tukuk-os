'use strict';
// World Extremes (/rekod) — static-data cluster tests.
// Guards the curated dataset (shape + uniqueness), the module helpers, and — most
// importantly — that every record's cross-links resolve to a route that still
// exists in server.js (a broken cluster/country link would 404 in production).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rek = require('../src/rekod');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

test('rekod: dataset is populated and every record is complete', () => {
  assert.ok(rek.RECORDS.length >= 40, `expected 40+ records, got ${rek.RECORDS.length}`);
  for (const r of rek.RECORDS) {
    for (const f of ['id', 'slug', 'category', 'record', 'name', 'value', 'place', 'blurb', 'catSlug']) {
      assert.ok(typeof r[f] === 'string' && r[f].trim(), `${r.id || '?'}: field "${f}" must be a non-empty string`);
    }
  }
});

test('rekod: slugs are unique and lowercase-slug shaped', () => {
  const ids = rek.RECORDS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'record ids must be unique');
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${id} must be a url slug`);
});

test('rekod: CATEGORIES cover every record and counts add up', () => {
  const names = new Set(rek.CATEGORIES.map((c) => c.name));
  for (const r of rek.RECORDS) assert.ok(names.has(r.category), `${r.id}: category "${r.category}" not in CATEGORIES`);
  const total = rek.CATEGORIES.reduce((s, c) => s + c.items.length, 0);
  assert.equal(total, rek.RECORDS.length, 'category item counts must sum to the record count');
});

test('rekod: findRecord() works and slugify() folds accents', () => {
  const known = rek.RECORDS[0];
  assert.equal(rek.findRecord(known.id), known);
  assert.equal(rek.findRecord(known.id.toUpperCase()), known, 'lookup is case-insensitive');
  assert.equal(rek.findRecord('definitely-not-a-record'), null);
  assert.equal(rek.findRecord(''), null);
  assert.equal(rek.slugify('Phong Nha-Kẻ Bàng'), 'phong-nha-ke-bang');
  assert.equal(rek.slugify('  Ojos del Salado  '), 'ojos-del-salado');
});

test('rekod: countrySlug is set exactly when a country is present', () => {
  for (const r of rek.RECORDS) {
    if (r.country) {
      assert.equal(r.countrySlug, rek.slugify(r.country), `${r.id}: countrySlug must derive from country`);
    } else {
      assert.equal(r.countrySlug, null, `${r.id}: no country → countrySlug must be null`);
    }
  }
});

test('rekod: every cross-linked route still exists in server.js (no dead links)', () => {
  for (const r of rek.RECORDS) {
    // Country profile links are dynamic (/negara/:slug), only assert the base is live.
    if (r.country) assert.match(SRV, /app\.get\('\/negara'/, '/negara hub must exist for country links');
    if (r.cluster) {
      const live = SRV.includes(`'/${r.cluster}'`) || SRV.includes(`geoRoutes('${r.cluster}'`) || SRV.includes(`geoSitemap('${r.cluster}'`);
      assert.ok(live, `${r.id}: cluster link /${r.cluster} has no matching route in server.js`);
    }
  }
});
