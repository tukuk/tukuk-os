'use strict';
// ── TUKUK-OS PERIODIC TABLE (/unsur) — 118 chemical elements, STATIC embedded data ──
// Data source: Bowserinator/Periodic-Table-JSON (CC BY-SA 3.0 license), fetched
// ONCE at authoring time and stored as src/elements-data.json. No
// runtime API calls → instant pages that are impossible to block (lesson
// from the Met WAF incident). Every element has a real encyclopedic `summ`,
// grid coordinates (xpos/ypos) for the interactive table, and CPK category colors.
const RAW = require('./elements-data.json');

// ——— category → display label + color (standard periodic-table scheme) ———
const CAT_DISPLAY = {
  'diatomic nonmetal': 'Reactive nonmetal',
  'polyatomic nonmetal': 'Reactive nonmetal',
  'noble gas': 'Noble gas',
  'alkali metal': 'Alkali metal',
  'alkaline earth metal': 'Alkaline earth metal',
  'transition metal': 'Transition metal',
  'post-transition metal': 'Post-transition metal',
  'metalloid': 'Metalloid',
  'lanthanide': 'Lanthanide',
  'actinide': 'Actinide',
};
const CAT_COLOR = {
  'Reactive nonmetal': '#3ec6a4',
  'Noble gas': '#7c6cf0',
  'Alkali metal': '#ff6b6b',
  'Alkaline earth metal': '#ffb14e',
  'Transition metal': '#4c8dff',
  'Post-transition metal': '#64d2ff',
  'Metalloid': '#c9b458',
  'Lanthanide': '#ff7ad9',
  'Actinide': '#e56bd6',
  'Unknown properties': '#8a94a6',
};
// Legend / hub grouping order.
const CATEGORY_ORDER = [
  'Reactive nonmetal', 'Noble gas', 'Alkali metal', 'Alkaline earth metal',
  'Transition metal', 'Post-transition metal', 'Metalloid',
  'Lanthanide', 'Actinide', 'Unknown properties',
];

function slugify(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function catDisplay(cat) {
  const c = String(cat || '');
  if (CAT_DISPLAY[c]) return CAT_DISPLAY[c];
  if (/^unknown/i.test(c)) return 'Unknown properties';
  return 'Unknown properties';
}

// ——— decorate every record with slug + label + color ———
const ELEMENTS = RAW.map((e) => {
  const disp = catDisplay(e.cat);
  return {
    ...e,
    slug: slugify(e.name),
    catLabel: disp,
    color: CAT_COLOR[disp] || CAT_COLOR['Unknown properties'],
  };
});

const BY_SLUG = new Map(ELEMENTS.map((e) => [e.slug, e]));
const BY_SYMBOL = new Map(ELEMENTS.map((e) => [String(e.s).toLowerCase(), e]));
const BY_NUMBER = new Map(ELEMENTS.map((e) => [e.n, e]));

// Find by slug, symbol (H, He…) or atomic number (1..118). null when nothing matches.
function findElement(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (BY_SLUG.has(q)) return BY_SLUG.get(q);
  const low = q.toLowerCase();
  if (BY_SYMBOL.has(low)) return BY_SYMBOL.get(low);
  const n = Number(q);
  if (Number.isInteger(n) && BY_NUMBER.has(n)) return BY_NUMBER.get(n);
  return null;
}

// List the elements of one display category, sorted by atomic number.
function byCategory(label) {
  return ELEMENTS.filter((e) => e.catLabel === label).sort((a, b) => a.n - b.n);
}

// Group by category for the hub (only categories that actually have elements).
function groupedByCategory() {
  return CATEGORY_ORDER.map((label) => ({ label, color: CAT_COLOR[label], items: byCategory(label) }))
    .filter((g) => g.items.length);
}

module.exports = { ELEMENTS, findElement, byCategory, groupedByCategory, CATEGORY_ORDER, CAT_COLOR, catDisplay, slugify };
