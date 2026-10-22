'use strict';
// ── TUKUK-OS PROVERBS (/pepatah) — Proverbs of the World ──────────────────────
// STATIC embedded data (src/proverbs-data.json), curated ONCE at authoring time
// from genuinely attested world proverbs (original text + romanisation + English
// meaning). NO runtime API calls → instant pages & impossible
// to block (lesson from the Met WAF incident). Proverbs are folk heritage (public
// domain). Page text is in English (international); every entry
// cross-links to the country profile /negara/<slug> of its country cluster.
const DATA = require('./proverbs-data.json');

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Add countrySlug (matches the /negara slug, from the common world country name).
const PROVERBS = DATA.map((p) => ({ ...p, countrySlug: slugify(p.country) }));
const P_BY_SLUG = new Map(PROVERBS.map((p) => [p.slug, p]));

// Regions in an order that reads sensibly for the hub.
const REGION_ORDER = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

// Group by country (name + slug + count + list of proverbs).
const COUNTRY_MAP = new Map();
for (const p of PROVERBS) {
  if (!COUNTRY_MAP.has(p.countrySlug)) {
    COUNTRY_MAP.set(p.countrySlug, { name: p.country, slug: p.countrySlug, region: p.region, items: [] });
  }
  COUNTRY_MAP.get(p.countrySlug).items.push(p);
}
const COUNTRIES = [...COUNTRY_MAP.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const c of COUNTRIES) c.items.sort((a, b) => a.slug.localeCompare(b.slug));

function findProverb(slug) {
  return P_BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}
function findCountry(slug) {
  return COUNTRY_MAP.get(String(slug || '').toLowerCase()) || null;
}
function countriesInRegion(region) {
  return COUNTRIES.filter((c) => c.region === region);
}

module.exports = {
  PROVERBS, COUNTRIES, REGION_ORDER,
  findProverb, findCountry, countriesInRegion, slugify,
};
