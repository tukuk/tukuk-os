'use strict';
// ── TUKUK-OS PEPATAH (/pepatah) — Proverbs of the World ──────────────────────
// Data STATIK tertanam (src/proverbs-data.json), dikurasi SEKALI semasa penulisan
// daripada peribahasa dunia yang betul-betul attested (teks asal + rumi + maksud
// Inggeris). TIADA panggilan API semasa runtime → halaman instant & mustahil
// diblok (pelajaran insiden WAF Met). Peribahasa ialah warisan rakyat (domain
// awam). Teks halaman dalam Bahasa Inggeris (internasional); setiap entri
// paut-silang ke profil negara /negara/<slug> kluster negara.
const DATA = require('./proverbs-data.json');

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Tambah countrySlug (padan slug /negara, daripada nama common dunia).
const PROVERBS = DATA.map((p) => ({ ...p, countrySlug: slugify(p.country) }));
const P_BY_SLUG = new Map(PROVERBS.map((p) => [p.slug, p]));

// Lapan kawasan mengikut susunan yang masuk akal untuk hab.
const REGION_ORDER = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

// Kumpul mengikut negara (nama + slug + bilangan + senarai peribahasa).
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
