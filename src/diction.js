'use strict';
// ── TUKUK-OS /dictionary — the browsable shelf of the word bank ──────────────
// /alat/dictionary is the search box; this cluster is the shelf. Every published
// page is one headword from a small hand-picked collection — real WordNet words,
// grouped by theme — rendered server-side through kamus.define (our local `kata`
// bank first, the Free Dictionary API as the long-standing fallback). Anything
// not on the shelf is a normal 404: this is a curated reference section, not an
// unbounded API mirror, which is the difference between a dictionary people
// trust and the doorway pages search results learned to distrust.
// The bank itself (tukuk/tukuk-devops: Princeton WordNet + wordfreq, plus
// wiktextract for Malay/Indonesian) is credited on every word page.

const COLLECTIONS = [
  {
    slug: 'feelings', icon: '💭', name: 'Feelings & Moods',
    blurb: 'The words we reach for when something is happening inside — each one sharper than the last.',
    words: ['joy', 'sorrow', 'hope', 'dread', 'pride', 'shame', 'guilt', 'envy', 'calm',
      'anxiety', 'wonder', 'relief', 'longing', 'nostalgia', 'gratitude', 'remorse',
      'boredom', 'curiosity', 'doubt', 'confidence', 'frustration', 'irritation',
      'affection', 'serenity', 'despair', 'elation'],
  },
  {
    slug: 'weather', icon: '🌦️', name: 'Weather & Sky',
    blurb: 'Rain has eight names and the sky keeps supplying more. The vocabulary of looking up.',
    words: ['drizzle', 'hail', 'sleet', 'blizzard', 'monsoon', 'cyclone', 'tornado',
      'hurricane', 'mist', 'fog', 'haze', 'frost', 'dew', 'rainbow', 'lightning',
      'thunder', 'gust', 'squall', 'breeze', 'tempest', 'shower', 'storm', 'drought',
      'cloud', 'wind', 'rain', 'snow', 'twilight'],
  },
  {
    slug: 'mind', icon: '🧠', name: 'Mind & Thought',
    blurb: 'Words for the machinery of thinking itself — ideas about ideas, evidence about evidence.',
    words: ['idea', 'notion', 'insight', 'memory', 'attention', 'perception',
      'imagination', 'belief', 'logic', 'theory', 'evidence', 'conclusion',
      'assumption', 'inference', 'reasoning', 'judgment', 'awareness',
      'consciousness', 'cognition', 'understanding', 'knowledge', 'wisdom',
      'hypothesis', 'analogy', 'reflection', 'deliberation', 'contemplation', 'thought'],
  },
  {
    slug: 'landscape', icon: '🏞️', name: 'Land & Sea',
    blurb: 'Words the geography of coasts, rivers and plains left in English — most of them are still places you can stand on.',
    words: ['coast', 'shore', 'cliff', 'canyon', 'delta', 'estuary', 'fjord',
      'glacier', 'island', 'lagoon', 'mesa', 'mountain', 'oasis', 'peninsula',
      'plateau', 'reef', 'ridge', 'river', 'savanna', 'steppe', 'strait', 'swamp',
      'tundra', 'valley', 'volcano', 'waterfall', 'wetland', 'dune', 'cave', 'prairie'],
  },
  {
    slug: 'work', icon: '💼', name: 'Work & Money',
    blurb: 'The ledger vocabulary — what the payslip, the invoice and the recession are actually called.',
    words: ['salary', 'wage', 'bonus', 'profit', 'loss', 'invoice', 'budget',
      'ledger', 'pension', 'debt', 'interest', 'inflation', 'recession',
      'dividend', 'equity', 'audit', 'contract', 'employer', 'employee',
      'colleague', 'deadline', 'negotiation', 'promotion', 'retirement',
      'revenue', 'expense', 'investment', 'savings'],
  },
  {
    slug: 'objects', icon: '🧺', name: 'Everyday Objects',
    blurb: 'Household words that most of us never look up because we assumed we knew them. Some of us did not.',
    words: ['kettle', 'umbrella', 'lantern', 'mirror', 'pillow', 'blanket',
      'basket', 'bottle', 'candle', 'clock', 'curtain', 'cupboard', 'ladder',
      'napkin', 'plate', 'razor', 'scissors', 'spoon', 'towel', 'vase', 'wallet',
      'whistle', 'wrench', 'anchor', 'broom', 'bucket', 'compass', 'hammer'],
  },
];

const BY_SLUG = new Map(COLLECTIONS.map((c) => [c.slug, c]));
const SET = new Set();
for (const c of COLLECTIONS) for (const w of c.words) SET.add(w);
const ALL_WORDS = [...SET].sort();

function findCollection(slug) {
  return BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

function isPublished(word) {
  return SET.has(String(word || '').trim().toLowerCase());
}

function collectionsOf(word) {
  const w = String(word || '').toLowerCase();
  return COLLECTIONS.filter((c) => c.words.includes(w));
}

module.exports = { COLLECTIONS, ALL_WORDS, findCollection, isPublished, collectionsOf };
