'use strict';
// ── /life expansion anchors — the Wildlife Atlas grows from 16 hand-authored species to a real
// catalogue the same way /books did: an explicit bounded build (scripts/life-build.js) harvests
// "the species the world photographs most" and writes each to disk, so a page request is a file
// read and NEVER a live iNaturalist call. These tests are pure and offline on purpose — the gate,
// the sourcing and the honest line between a hand-written blurb and a Wikipedia summary are exactly
// the things that must be argued here rather than discovered as a thin or fabricated page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'life-build.js'), 'utf8');
const hidup = require('../src/hidup');

test('gate: speciesQualifies refuses what would make a thin or Latin-titled page', () => {
  const ok = { rank: 'species', is_active: true, preferred_common_name: 'Mallard', observations_count: 900000 };
  assert.equal(hidup.speciesQualifies(ok), null, 'a well-known species passes');
  assert.ok(hidup.speciesQualifies({ ...ok, rank: 'genus' }), 'not a species');
  assert.ok(hidup.speciesQualifies({ ...ok, is_active: false }), 'inactive is refused');
  assert.ok(hidup.speciesQualifies({ ...ok, extinct: true }), 'extinct is refused');
  assert.ok(hidup.speciesQualifies({ ...ok, preferred_common_name: '' }), 'no English name → refuse');
  assert.ok(hidup.speciesQualifies({ ...ok, observations_count: hidup.OBS_MIN - 1 }), 'too few observations → refuse');
  assert.ok(hidup.speciesQualifies(null), 'null is refused, not a crash');
  assert.ok(hidup.OBS_MIN >= 20, 'the observation floor is real, not symbolic');
});

test('summarise: Wikipedia markup becomes safe plain text, never rendered HTML', () => {
  const raw = '<p>The mallard (&quot;Anas platyrhynchos&quot;) is a dabbling duck.<sup>[12] &#39;s&#39;</sup></p>';
  const out = hidup.summarise(raw);
  assert.ok(!out.includes('<'), 'no tags survive');
  assert.ok(!/\[\d+\]/.test(out) && !out.includes('[12]'), 'citation markers stripped');
  assert.ok(out.includes('"mallard"') === false && out.includes('"Anas'), 'entities decoded to quotes');
  assert.ok(out.includes("'s'"), 'apostrophe entity decoded');
  assert.ok(hidup.summarise(null) === '', 'null → empty string');
  assert.ok(hidup.summarise('x'.repeat(2000)).length <= 900, 'capped so one summary cannot dominate a page');
});

test('slugify: accented display names fold to a safe url segment', () => {
  assert.equal(hidup.slugify('Monarch Butterfly'), 'monarch-butterfly');
  assert.equal(hidup.slugify('Ocellaris Clownfish!!'), 'ocellaris-clownfish');
  assert.equal(hidup.slugify('Böotian Cücür'), 'bootian-cucur', 'diacritics fold, not drop');
  assert.equal(hidup.slugify('  --  '), '', 'punctuation-only → empty (caller must fall back)');
});

test('curatedBySci: the build reuses the hand-authored honeybee instead of a second thinner page', () => {
  const bee = hidup.curatedBySci.get('apis mellifera');
  assert.ok(bee && bee.slug === 'honeybee', 'a curated scientific name maps to its good slug');
  assert.equal(hidup.curatedBySci.get('not a real name'), undefined, 'an unknown name → nothing');
});

test('taxonToRecord: lineage is filtered, status is expanded, sourcing links are kept, nothing is invented', () => {
  const full = {
    id: 7218, name: 'Danaus plexippus', rank: 'species', preferred_common_name: 'Monarch Butterfly',
    observations_count: 562000, wikipedia_url: 'https://en.wikipedia.org/wiki/Monarch_butterfly',
    wikipedia_summary: '<p>The monarch is a milkweed-dependent butterfly.</p>',
    ancestors: [
      { rank: 'kingdom', name: 'Animalia' }, { rank: 'phylum', name: 'Arthropoda' },
      { rank: 'class', name: 'Insecta' }, { rank: 'order', name: 'Lepidoptera' },
      { rank: 'family', name: 'Nymphalidae' }, { rank: 'genus', name: 'Danaus' },
    ],
    conservation_status: { status: 'lc', authority: 'IUCN' },
    default_photo: { medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg', attribution: 'Photo by someone (CC BY-NC)', license_code: 'CC-BY-NC' },
  };
  const rec = hidup.taxonToRecord(full, { slug: 'monarch-butterfly', blurb: 'A hand-written story.' });
  assert.equal(rec.slug, 'monarch-butterfly', 'the caller controls the slug (uniqueness)');
  assert.equal(rec.name, 'Monarch Butterfly', 'display name from the taxon, not invented');
  assert.equal(rec.blurb, 'A hand-written story.', 'a curated blurb is carried through');
  assert.ok(rec.summary.includes('milkweed') && !rec.summary.includes('<'), 'sourced summary, markup stripped');
  assert.equal(rec.summaryUrl, full.wikipedia_url, 'the summary is linkable → creditable');
  assert.ok(!rec.classification.some((c) => c.rank === 'genus'), 'lineage keeps kingdom→family, not genus');
  assert.deepEqual(rec.classification.map((c) => c.rank), ['kingdom', 'phylum', 'class', 'order', 'family'], 'ranked lineage');
  assert.equal(rec.conservation.label, 'Least Concern', 'IUCN code is expanded to words');
  assert.equal(rec.obsCount, 562000, 'the count is the catalogue’s own number');
  assert.equal(rec.iNatUrl, 'https://www.inaturalist.org/taxa/7218', 'a link back to the record');
  assert.equal(rec.photo.license, 'CC-BY-NC', 'the photo carries its licence');
  // A species with no conservation status must not gain a fake one.
  const bare = hidup.taxonToRecord({ ...full, conservation_status: null, preferred_common_name: '' }, { slug: 'x' });
  assert.ok(!bare.conservation, 'no status → no status, never a guess');
});

test('disk reads are read-only safe before the first build', () => {
  assert.ok(Array.isArray(hidup.builtSpecies()), 'builtSpecies is an array even with nothing built yet');
  assert.equal(hidup.speciesRecord('this-slug-will-not-exist'), null, 'an unbuilt slug reads as null, no live call');
  assert.equal(hidup.speciesRecord('../../etc/passwd'), null, 'path traversal in a slug is refused by the sanitizer');
});

test('server: /life is disk-backed — a-z precedes :slug, a page is a file read, sourcing is credited', () => {
  const az = serverSrc.indexOf("app.get('/life/a-z'");
  const slug = serverSrc.indexOf("app.get('/life/:slug'");
  assert.ok(az > 0 && slug > 0, 'both routes exist');
  assert.ok(az < slug, '/life/a-z is registered before /life/:slug, or a-z would be eaten as a slug');
  // The built route reads disk first and only the curated fallback reaches the network.
  assert.ok(serverSrc.includes('hidup.speciesRecord(req.params.slug)'), '/life/:slug reads the disk record first');
  assert.ok(serverSrc.includes('hidupBuiltPage(req, rec)'), 'a disk record is rendered by the built-page renderer');
  const built = (serverSrc.match(/function hidupBuiltPage\(req, rec\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(built.length > 1000, 'the built renderer was found');
  assert.ok(built.includes('Wikipedia, CC BY-SA') && built.includes('summaryUrl'), 'built prose is credited + linked, never anonymous');
  assert.ok(built.includes('rel="noopener nofollow"'), 'outbound research links are nofollow');
  assert.ok(built.includes('seni-grid'), 'the CC photograph wall reuses the gallery grid');
  // A curated blurb is shown for the seeded 16; only the harvested tail falls back to sourced text.
  assert.ok(built.includes('rec.blurb'), 'a curated page keeps its hand-written blurb');
  assert.ok(!/Math\.random\(\)/.test(built), 'no invented numbers on a species page');
});

test('server: hub, A–Z, sitemap and the nav count all read ONE merged species set (no disagreement)', () => {
  assert.ok(serverSrc.includes('function hidupMerged()'), 'the merged built+curated set exists');
  const sm = (serverSrc.match(/app\.get\('\/sitemap-life\.xml'[\s\S]*?\n}\);/) || [''])[0];
  assert.ok(sm.includes('hidupMerged()'), 'the sitemap lists the real published set, not a hardcoded 16');
  assert.ok(sm.includes("one('/life/a-z'"), 'the A–Z page is advertised');
  assert.ok(!sm.includes('hidup.TAXA.map'), 'the sitemap no longer promises only the curated dozen-and-a-half');
  const nav = (serverSrc.match(/const hidupNav = \(\)[\s\S]*?\n  \.concat/) || [''])[0];
  assert.ok(nav.includes('hidupMerged().length'), 'the nav count matches the same merged set the sitemap uses');
});

test('build guard: bounded, paced, cooldown-aware, seeded curated-first — it is a guest on a free API', () => {
  assert.ok(buildSrc.includes('call budget reached'), 'a lifetime --calls budget stops the run');
  assert.ok(/load1\(\)\s*>\s*LOAD_MAX/.test(buildSrc), 'it checks this box’s own load before adding to it');
  assert.ok(buildSrc.includes("e.cooling || e.code === 'EOUTBOUND_COOLING'"), 'a cooled URL is waited out, not failed over');
  assert.ok(buildSrc.includes('seedCurated') && buildSrc.includes('curated: true'), 'the curated 16 are seeded before the harvest');
  assert.ok(buildSrc.includes('hidup.getObservations'), 'the photograph wall is confirmed before a page is kept');
  assert.ok(/hasBody|wikipedia_summary/.test(buildSrc), 'a built page needs sourced body text, not just a picture');
});
