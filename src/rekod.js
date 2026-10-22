'use strict';
// ── TUKUK-OS WORLD EXTREMES (/rekod) — Superlatives of the Earth ──────────────
// STATIC embedded data (src/rekod-data.json), curated ONCE at authoring time from
// widely accepted reference figures (Guinness-world-records style facts + standard
// geographic sources). NO runtime API calls → instant pages & impossible to block
// (lesson from the Met WAF incident). Page text is English (international); every
// record cross-links to the matching geo / built-world cluster where that feature
// class is catalogued, and to the country profile /negara/<slug> where one nation
// clearly owns the record. Measurements are approximate "widely cited" values.
const DATA = require('./rekod-data.json');

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Derive countrySlug (for the /negara link) and catSlug (for the hub anchor).
const RECORDS = DATA.map((r) => ({
  ...r,
  slug: r.id,
  countrySlug: r.country ? slugify(r.country) : null,
  catSlug: slugify(r.category),
}));
const R_BY_SLUG = new Map(RECORDS.map((r) => [r.slug, r]));

// Categories in the order they first appear in the data (reads sensibly on the hub).
const CATEGORY_ORDER = [...new Set(RECORDS.map((r) => r.category))];

// Group records by category, preserving CATEGORY_ORDER.
const CAT_MAP = new Map();
for (const c of CATEGORY_ORDER) CAT_MAP.set(c, { name: c, slug: slugify(c), items: [] });
for (const r of RECORDS) CAT_MAP.get(r.category).items.push(r);
const CATEGORIES = CATEGORY_ORDER.map((c) => CAT_MAP.get(c));

function findRecord(slug) {
  return R_BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}
function recordsInCategory(category) {
  return (CAT_MAP.get(category) || { items: [] }).items;
}

module.exports = {
  RECORDS, CATEGORIES, CATEGORY_ORDER,
  findRecord, recordsInCategory, slugify,
};
