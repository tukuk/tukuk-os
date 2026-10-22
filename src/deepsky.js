'use strict';
// ── TUKUK-OS DEEP-SKY (/buruj + /messier) — 88 IAU constellations + 110 Messier objects ─
// STATIC embedded data (src/deepsky-data.json), generated ONCE at authoring time
// from vetted Wikipedia tables (IAU designated constellations +
// Messier object). NO runtime API calls → instant pages &
// impossible to block (lesson from the Met WAF incident). Source: en.wikipedia.org
// (CC BY-SA). Names/terminology and page text are in English (international).
const DATA = require('./deepsky-data.json');

function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Constellations: add the slug.
const CONSTELLATIONS = DATA.constellations.map((c) => ({ ...c, slug: slug(c.name) }));
const C_BY_SLUG = new Map(CONSTELLATIONS.map((c) => [c.slug, c]));
const C_BY_NAME = new Map(CONSTELLATIONS.map((c) => [c.name.toLowerCase(), c]));

// Messier objects: slug = m31; link to the parent constellation (slug) for cross-linking.
const MESSIER = DATA.messier.map((m) => ({
  ...m,
  slug: String(m.id).toLowerCase(),
  cSlug: (C_BY_NAME.get(String(m.constellation || '').toLowerCase()) || {}).slug || null,
}));
const M_BY_SLUG = new Map(MESSIER.map((m) => [m.slug, m]));

// Object-type order (galaxies are the most numerous → first).
const TYPES = ['Galaxy', 'Globular cluster', 'Open cluster', 'Diffuse nebula', 'Planetary nebula', 'Supernova remnant', 'Deep-sky object'];

// Short description of each object type — accurate general facts, not inventions.
const TYPE_INFO = {
  'Galaxy': 'A vast, gravitationally-bound system of stars, gas and dust — from small irregular collections to giant spirals containing a trillion suns. Most Messier galaxies are island universes far beyond the Milky Way.',
  'Globular cluster': 'A dense, spheroidal ball of hundreds of thousands of old stars orbiting a galaxy’s halo. Through a small telescope they look like fuzzy stars; in a large one they resolve into glittering swarms.',
  'Open cluster': 'A loose, young family of a few dozen to a few thousand stars born together from the same gas cloud and drifting apart over time. The Pleiades are the most famous example.',
  'Diffuse nebula': 'An interstellar cloud of gas and dust — glowing where hot young stars energise it (emission), reflecting nearby starlight, or silhouetted against brighter clouds.',
  'Planetary nebula': 'Not a planet at all: the glowing shell of gas a sun-like star sheds at the end of its life, its exposed hot core lighting the cast-off envelope blue-green.',
  'Supernova remnant': 'The expanding wreckage of a star that exploded — a shock-fuelled bubble of shredded stellar material, often still racing outward at thousands of kilometres a second.',
  'Deep-sky object': 'A fainter or more ambiguous fuzzy patch in the sky — a star cloud, double star or object whose nature was debated long after Messier logged it as a comet-like smudge.',
};

function findConstellation(query) {
  const q = String(query || '').toLowerCase();
  return C_BY_SLUG.get(q) || null;
}

// Accepts 'M31', 'm31', '31' or 'Messier 31'.
function findMessier(query) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return null;
  if (M_BY_SLUG.has(raw)) return M_BY_SLUG.get(raw);
  const n = raw.replace(/[^0-9]/g, '');
  if (n) { const id = 'm' + Number(n); if (M_BY_SLUG.has(id)) return M_BY_SLUG.get(id); }
  return null;
}

function messierInConstellation(name) {
  const key = String(name || '').toLowerCase();
  return MESSIER.filter((m) => String(m.constellation || '').toLowerCase() === key);
}
function messierByType(type) {
  return MESSIER.filter((m) => m.type === type);
}

module.exports = {
  CONSTELLATIONS, MESSIER, TYPES, TYPE_INFO,
  findConstellation, findMessier, messierInConstellation, messierByType, slug,
};
