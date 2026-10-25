'use strict';
// src/recipes.js — the cookbook.
//
// The thing worth testing is the parser, because it is the part that can be silently wrong:
// every rule here exists because a real Wikibooks page broke it on 24 Oct 2026. MediaWiki
// spells the same recipe five ways, and a parser that only understands the tidy way reports a
// perfectly good recipe as "no ingredients". parseRecipe, splitAmount, scaleAmount and
// chooseTitles are pure, so all of it is checked without the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rec = require('../src/recipes');
const config = require('../src/config');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'recipes.js'), 'utf8');

// Rendang as the wiki actually stores it: a summary closed on the same line as its own
// opening brace, a nested {{recipe}}, a spaced heading, and bullets with no space.
const RENDANG = `__NOTOC__{{Recipesummary
| Category = Meat recipes
| Servings = 10
| Time = 180 minutes
| Difficulty = 3
| Image = [[Image:Rendang.JPG|300px]]
}}{{recipe}} | [[Cookbook:Cuisine of Indonesia|Cuisine of Indonesia]]

'''Rendang''' is made from [[Cookbook:Beef|beef]] or water buffalo meat slowly cooked in [[Cookbook:Coconut Milk|coconut milk]] and spices.

==Ingredients==

=== Spice paste ===
* 2 cloves [[Cookbook:Garlic|garlic]]
* 25 [[Cookbook:Gram|g]] [[Cookbook:Ginger|ginger]]
* ½ pod dried [[Cookbook:Nutmeg|nutmeg]]

=== Stew ===
* 1 [[Cookbook:Kilogram|kg]] [[Cookbook:Beef|beef]], cut into big cubes
* 2 [[Cookbook:Liter|L]] ready-to-use [[Cookbook:Coconut|coconut milk]]

==Procedure==
#Using a [[Cookbook:Food Processor|food processor]], grind together all the ingredients for the spice paste.
#[[Cookbook:Marinating|Marinate]] meat with the spice paste for at least 1 hour.
#Heat the coconut milk over low heat until some oil rises.

[[Category:Indonesian recipes]]
`;

test('the summary template is found however the wiki spelled it', () => {
  // Four spellings were seen on real pages. Matching only {{recipesummary}} found a serving
  // size on one page in fourteen, and the site would have said "serves ?" about a recipe
  // that says "serves 10" on its own source page.
  for (const open of ['{{recipesummary', '{{Recipesummary', '{{Recipe summary', '{{recipe summary']) {
    const r = rec.readSummary(`${open}\n| Servings = 4\n| Time = 20 minutes\n}}`);
    assert.strictEqual(r.servings, '4', `${open}: servings read`);
    assert.strictEqual(r.time, '20 minutes', `${open}: time read`);
  }
});

test('a parameter after a nested template is not lost', () => {
  // The block closes with "}}{{recipe}}", and a lazy \{\{…\}\} match stops at the inner "}}",
  // so everything below the nesting quietly disappeared — including the ingredients' photo.
  const r = rec.readSummary(RENDANG);
  assert.strictEqual(r.servings, '10', 'the parameter before the nesting survives');
  assert.strictEqual(r.difficulty, '3', 'and so does the one the nested template used to cut off');
  assert.strictEqual(r.image, '[[Image:Rendang.JPG|300px]]', 'the photo, read out of the link');
});

test('a list marker does not need a space, and most of the Cookbook does not use one', () => {
  // The most expensive rule here: `#Using a food processor…` and `*2 eggs` are valid MediaWiki
  // and were read as prose. Nineteen bread pages came back as "no ingredient list".
  const r = rec.parseRecipe('Cookbook:Rendang', RENDANG);
  assert.strictEqual(r.steps.length, 3, 'the method is a list of three steps');
  assert.match(r.steps[0].text, /^Using a food processor/, 'the first step, markup stripped');
  assert.ok(r.groups.some((g) => g.items.some((i) => i.text.startsWith('2 cloves garlic'))), 'bullets read');
});

test('a sub-heading inside the ingredients is kept as a group', () => {
  // Rendang is two preparations in one list. Flatten it and a cook puts the stew's coconut
  // milk into the spice paste.
  const r = rec.parseRecipe('Cookbook:Rendang', RENDANG);
  assert.deepStrictEqual(r.groups.map((g) => g.group), ['Spice paste', 'Stew']);
  assert.strictEqual(r.groups[0].items.length, 3);
  assert.strictEqual(r.groups[1].items.length, 2);
});

test('a page the wiki itself flags as unfinished never reaches a shelf', () => {
  // Gado-gado carries {{Incomplete recipe|reason=missing quantities}}. Serving it as a recipe
  // would be our fault, not the authors'.
  const r = rec.parseRecipe('Cookbook:Gado-gado', '{{Incomplete recipe|reason=missing quantities}}\n== Ingredients ==\n* beans\n== Procedure ==\n# Boil.');
  assert.strictEqual(r.incomplete, true);
  assert.strictEqual(r.usable, false);
});

test('a page with no summary template is an article about an ingredient, not a recipe', () => {
  // The namespace search for "chicken" returns Cookbook:Chicken — real text, no quantities.
  const r = rec.parseRecipe('Cookbook:Chicken', '== Overview ==\nThe chicken is a bird.\n== Procedure ==\n# Roast it.');
  assert.strictEqual(r.usable, false, 'no {{recipe summary}} means the Cookbook does not call it a recipe');
});

test('the source link keeps the namespace, because without it every one of them is a 404', () => {
  const r = rec.parseRecipe('Cookbook:Rendang (Indonesian Beef and Coconut Stew)', RENDANG);
  assert.strictEqual(r.url, 'https://en.wikibooks.org/wiki/Cookbook:Rendang_(Indonesian_Beef_and_Coconut_Stew)');
  assert.strictEqual(r.title, 'Rendang (Indonesian Beef and Coconut Stew)', 'the page itself does not show the namespace');
});

test('the difficulty icon is never used as the photograph', () => {
  assert.strictEqual(rec.imageFile({ image: '[[File:2o5dots.svg|20px]]' }), '', 'a rating icon is not food');
  assert.strictEqual(rec.imageFile({ image: '[[Image:Rendang.JPG|300px]]' }), 'Rendang.JPG');
  assert.strictEqual(rec.imageFile({}), '', 'and no image at all is an honest answer');
});

test('a quantity is one number, not every digit in the string glued together', () => {
  // "5–6 servings" read as 56 would scale a whole recipe by the wrong factor and print it
  // with confidence, which is the worst kind of wrong for a site about cooking.
  assert.strictEqual(rec.toNumber('½'), 0.5);
  assert.strictEqual(rec.toNumber('1 1/2'), 1.5);
  assert.strictEqual(rec.toNumber('2½'), 2.5);
  assert.strictEqual(rec.toNumber('2-3'), 2.5, 'a range is its middle');
  assert.strictEqual(rec.toNumber('5–6 servings'), 5.5, 'a range with words after it is still read');
  assert.strictEqual(rec.toNumber('salt'), null, 'a word is not a number');
  assert.strictEqual(rec.servingsCount('5–6 servings'), 6, 'a batch that is a range becomes a whole number, or every factor on the page is a fraction');
  assert.strictEqual(rec.servingsCount('1 plate'), 1);
  assert.strictEqual(rec.servingsCount(''), null, 'and no batch at all means no scaler on the page');
});

test('only a real unit is taken as the unit, and only one word of it', () => {
  // Taking three words left "2 cloves" with the unit "cloves garlic" and no item at all, and
  // "2 L" with the unit "L ready" out of "2 L ready-to-use coconut milk".
  assert.deepStrictEqual(rec.splitAmount('2 cloves garlic'), { amount: '2', unit: 'cloves', item: 'garlic' });
  assert.deepStrictEqual(rec.splitAmount('2 L ready-to-use coconut milk'), { amount: '2', unit: 'L', item: 'ready-to-use coconut milk' });
  assert.deepStrictEqual(rec.splitAmount('4 shallots'), { amount: '4', unit: '', item: 'shallots' });
  assert.deepStrictEqual(rec.splitAmount('salt'), { amount: '', unit: '', item: 'salt' });
  assert.deepStrictEqual(rec.splitAmount('2 oranges, juiced'), { amount: '2', unit: '', item: 'oranges, juiced' });
});

test('a scaled quantity is rounded to a mark a cup or a spoon actually has', () => {
  assert.strictEqual(rec.scaleAmount('1/3', 1.5), '½', 'a third of a cup doubled-and-a-half is a half');
  assert.strictEqual(rec.scaleAmount('2', 0.4), '¾', 'four servings from ten: two cloves become three quarters');
  assert.strictEqual(rec.scaleAmount('1', 2), '2');
  assert.strictEqual(rec.scaleAmount('½', 2), '1', 'and it does not print "1 " with a stray space');
  assert.strictEqual(rec.scaleAmount('25', 0.4), '10', 'grams stay grams');
  assert.strictEqual(rec.scaleAmount('300', 4), '1200', 'a big number is only rounded');
  assert.strictEqual(rec.scaleAmount('', 2), '', 'something with no number is left as it was written');
});

test('a shelf leads with the dishes a visitor came for, not with the letter A', () => {
  // 148 Indian recipes answered in title order, asked for 24, gave a shelf of dishes beginning
  // A and B. The featured names come first and the rest are taken at a stride across the list.
  const all = [];
  for (let i = 0; i < 140; i++) all.push(`Cookbook:${String.fromCharCode(65 + (i % 26))}urry dish ${i}`);
  all.push('Cookbook:Chicken Biryani');
  all.push('Cookbook:Butter Chicken I');
  const spec = { slug: 'indian', cats: ['Indian recipes'], featured: ['Biryani', 'Butter Chicken'] };
  const chosen = rec.chooseTitles(all, spec, 24);
  assert.deepStrictEqual(chosen.slice(0, 2), ['Cookbook:Chicken Biryani', 'Cookbook:Butter Chicken I'],
    'the featured dishes are first, in the order they were named');
  const letters = new Set(chosen.map((t) => t.replace('Cookbook:', '')[0]));
  assert.ok(letters.size > 8, `a spread of the alphabet, not A and B — got ${[...letters].sort().join('')}`);
  assert.ok(chosen.length <= rec.SAMPLE, 'and never more than the api will take in one call');
});

test('a search shelf keeps the order the search answered in', () => {
  // Relevance is the editorial judgement we are borrowing; spreading it at a stride throws it
  // away and puts a roast chicken below forty pages of nothing in particular.
  const all = ['Cookbook:A B', 'Cookbook:B C', 'Cookbook:C D', 'Cookbook:D E', 'Cookbook:E F'];
  const chosen = rec.chooseTitles(all, { slug: 'chicken', search: ['intitle:chicken'], featured: [] }, 2);
  assert.deepStrictEqual(chosen, ['Cookbook:A B', 'Cookbook:B C']);
});

test('the photo comes from pageimages, and the licence is read before it is shown', () => {
  // prop=images lists the difficulty icon first. A credit that cannot be read is a photo that
  // does not get shown, because we are borrowing somebody's picture under their terms.
  const fetchBlock = src.slice(src.indexOf('async function fetchPages'), src.indexOf('/** Everything on one shelf'));
  assert.ok(fetchBlock.includes('pageimages'), 'the representative image is asked for');
  assert.ok(!/prop:\s*'images'/.test(fetchBlock), 'and the raw image list is not');
  const credit = src.slice(src.indexOf('async function images'), src.indexOf('/** One recipe by its exact'));
  assert.ok(credit.includes('LicenseShortName'), 'the licence is read');
  assert.ok(credit.includes('AttributionRequired'), 'and whether the author must be named');
  assert.ok(credit.includes('return {}'), 'a failure returns nothing rather than a photo without credit');
});

test('a shelf is mirrored beside the store and served stale if the wiki dies', () => {
  assert.strictEqual(rec.MIRROR_FILE, path.join(path.dirname(config.store.path), 'recipes-last.json'));
  const writer = src.slice(src.indexOf('function writeMirror'), src.slice(0).indexOf('/** Everything on one shelf'));
  assert.ok(writer.includes('writeFileSync(tmp'), 'written to a temp name first');
  assert.ok(writer.includes('renameSync(tmp, MIRROR_FILE)'), 'then renamed, so a reader never sees half a file');
  assert.ok(writer.includes('catch {'), 'a failed mirror is a slow request later, not a broken page now');
  assert.ok(writer.includes('KEEP_MIRRORED'), 'and the file is bounded, because a recipe page is not a line');
});

// Measured on the VPS, 25 Oct 2026: after a deploy /sitemap-recipes.xml answered with 85 dish
// urls instead of 608, because the sitemap is built from the mirror when the memory is empty and
// the mirror had never been written — prime() read every shelf with the bare fetch, so only a
// visitor who arrived on a cold cache ever wrote one. A mirror younger than the shelf TTL is an
// answer, not a hint: the previous process had already paid for those wiki pages.
test('a restart reads the shelf from the mirror instead of re-reading the wiki', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-recipes-'));
  const probe = `
    process.env.RECIPES_MIRROR_PATH = ${JSON.stringify(path.join(dir, 'recipes-last.json'))};
    let calls = 0;
    const axios = require('axios');
    const realCreate = axios.create;
    axios.create = (opts) => {
      const inst = realCreate.call(axios, opts);
      inst.defaults.adapter = async () => { calls += 1; throw new Error('wikibooks unreachable (probe)'); };
      return inst;
    };
    const fs = require('node:fs');
    const path = require('node:path');
    const rec = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'recipes.js'))});
    fs.mkdirSync(path.dirname(rec.MIRROR_FILE), { recursive: true });
    fs.writeFileSync(rec.MIRROR_FILE, JSON.stringify({
      'section:indonesian': { at: new Date().toISOString(), recipes: [{ title: 'Rendang', path: 'rendang' }, { title: 'Nasi Goreng', path: 'nasi-goreng' }] },
      'section:thai': { at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), recipes: [{ title: 'Tom Yum', path: 'tom-yum' }] },
    }));
    (async () => {
      const fresh = await rec.section('indonesian');
      const freshCalls = calls;
      const stale = await rec.section('thai');
      console.log(JSON.stringify({ fresh, freshCalls, calls, stale, inventory: rec.inventory().map((r) => r.path).sort() }));
    })();
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', cwd: path.join(__dirname, '..') }));

  assert.strictEqual(out.freshCalls, 0, 'a mirror younger than the shelf TTL is served without touching the wiki');
  assert.strictEqual(out.fresh.recipes.length, 2, 'the whole shelf comes off disk');
  assert.strictEqual(out.fresh.stale, false, 'and is not presented as stale');
  assert.ok(out.calls >= 1, 'an older mirror is still revalidated against the wiki');
  assert.strictEqual(out.stale.recipes[0].title, 'Tom Yum', 'and answers with it when the wiki cannot be reached');
  assert.strictEqual(out.stale.stale, true, 'saying so, rather than pretending it is fresh');
  assert.deepStrictEqual(out.inventory, ['nasi-goreng', 'rendang', 'tom-yum'], 'the sitemap is complete from disk alone, which is what a restart needs');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every shelf is reachable, distinct, and has somewhere to read from', () => {
  const seen = new Set();
  for (const s of rec.SECTIONS) {
    assert.match(s.slug, /^[a-z][a-z0-9-]*$/, `${s.slug}: a slug goes in a url`);
    assert.ok(!seen.has(s.slug), `${s.slug} appears once`);
    seen.add(s.slug);
    assert.ok(s.title.length > 2, `${s.slug}: a shelf needs a name to show`);
    assert.ok(s.blurb.length > 40, `${s.slug}: a shelf without a reason to open it is a link farm`);
    assert.ok((s.cats || []).length || (s.search || '') !== '', `${s.slug}: it must say where the recipes come from`);
    assert.ok(rec.BY_SLUG.get(s.slug) === s, `${s.slug} resolves through BY_SLUG`);
  }
});

test('a shelf nobody asked for is not fetched on a loop at boot', async () => {
  // prime() is called unhandled, so one thrown request must not stop the twenty-six after it.
  const asked = [];
  const done = await rec.prime({
    gapMs: 0,
    log: () => {},
    fetchOne: async (slug) => {
      asked.push(slug);
      if (slug === 'thai') throw new Error('socket hang up');
      // A shelf entry as fetchSection actually returns it, because prime() caches what it
      // reads and the sitemap is built from that cache — a fake row here is a fake shelf.
      return [{ title: 'Primed dish', path: 'primed-dish' }];
    },
  });
  assert.strictEqual(asked.length, rec.SECTIONS.length, 'every shelf was attempted once');
  assert.strictEqual(done, rec.SECTIONS.length - 1, 'and the count reported honestly');
});

test('a slug the site does not know answers empty rather than throwing', async () => {
  assert.deepStrictEqual(await rec.section('not-a-shelf'), { recipes: [], at: null, stale: false });
});

test('a dish url is readable, its accents folded, and never taken from another dish', () => {
  // The titles in the Cookbook carry accents and punctuation: "Bánh Mì", "Rendang (Indonesian
  // Beef and Coconut Stew)", "Pão de Queijo". Dropping the accents rather than folding them
  // would hand two different pages one url, and an un-escaped space or bracket in a path is a
  // broken link as soon as somebody pastes it into a chat.
  assert.strictEqual(rec.dishSlug('Cookbook:Rendang (Indonesian Beef and Coconut Stew)'),
    'rendang-indonesian-beef-and-coconut-stew');
  assert.strictEqual(rec.dishSlug('Cookbook:Bánh Mì'), 'banh-mi', 'accents are folded, not deleted');
  assert.strictEqual(rec.dishSlug('Cookbook:Pão de Queijo'), 'pao-de-queijo');
  assert.strictEqual(rec.dishSlug('Cookbook:'), 'recipe', 'a title with nothing readable left still gets a url');
  assert.ok(!/[\s()?%,]/.test(rec.dishSlug('Cookbook:Cheese Puffs (Pão de Queijo)')), 'no character that needs escaping survives');
  // Two dishes that fold to the same thing are numbered instead of one of them being unreachable.
  const [a, b] = rec.assignSlugs([{ title: 'Banh Mi' }, { title: 'Bánh Mì' }]);
  assert.strictEqual(rec.recipePath(a), 'banh-mi');
  assert.strictEqual(rec.recipePath(b), 'banh-mi-2', 'the second one is not shadowed');
});

test('a time only reaches the structured data when it really is a time', () => {
  // schema.org wants an ISO 8601 duration. Feeding it the wiki's free text, or a figure
  // invented from it, is worse than saying nothing: the number shows up in the search result.
  assert.strictEqual(rec.duration('1 h 30 min'), 'PT1H30M');
  assert.strictEqual(rec.duration('4hrs'), 'PT4H');
  assert.strictEqual(rec.duration('45 minutes'), 'PT45M');
  assert.strictEqual(rec.duration('Refrigerate overnight'), '', 'not a duration, not a duration in the data');
  assert.strictEqual(rec.duration(''), '');
  assert.strictEqual(rec.duration('12 months'), '', 'a number that is not a cooking time is left out');
});

test('the inventory is only ever what the site can actually serve', () => {
  // The sitemap is a promise about pages that render. Anything the shelf does not know, or a
  // page the wiki flags as unfinished, must not be in it.
  for (const row of rec.inventory()) {
    assert.ok(rec.BY_SLUG.has(row.section), `${row.section} is a shelf`);
    assert.match(row.path, /^[a-z0-9-]+$/, `${row.title}: a path segment with no escaping in it`);
    assert.ok(row.title.length > 1, `${row.section}: a dish needs its name`);
  }
  assert.ok(rec.RECIPE_TTL > rec.SECTION_TTL, 'a recipe is trusted longer than the shelf that lists it');
});

test('the recipe page keeps the four promises the source is owed', () => {
  // CC BY-SA is a share-alike licence, not a free-for-all: the page has to say what it came
  // from and who made it. Pinned in the renderer because a later edit that drops the notice is
  // a licence breach, not a layout change.
  const pages = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const dish = pages.slice(pages.indexOf('function recipesDishPage'), pages.indexOf('const REC_UNAVAILABLE'));
  assert.ok(dish.includes('creativecommons.org/licenses/by-sa/4.0/'), 'the licence is stated and linked');
  assert.ok(dish.includes('rel="nofollow noopener license"'), 'and marked as a licence link for the crawlers');
  assert.ok(dish.includes('isBasedOn'), 'the structured data names the source page too');
  assert.ok(dish.includes('HowToStep'), 'the steps are typed the way Google reads them');
  assert.ok(/photograph by/.test(dish) && dish.includes('rc-credit'), 'the photographer is named under the picture');
  assert.ok(dish.includes('!/\\d/.test(tail)'), 'a line with a second number of its own is not scaled');
  assert.ok(pages.includes('"@type": \'Recipe\'') || dish.includes("'Recipe'"), 'the page declares itself a Recipe');
});

test('the scaler script is javascript a browser will actually run', () => {
  // It is written as a string inside a template literal, so nothing checks it but this: a
  // stray brace is not a syntax error at boot, it is a page where the numbers never change.
  const pages = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const m = /const RC_SCALE_JS = `([\s\S]*?)`;/.exec(pages);
  assert.ok(m, 'the scaler is found');
  assert.ok(m[1].length > 400, 'and it is the whole body');
  assert.doesNotThrow(() => new Function(m[1]), 'it parses');
  assert.ok(m[1].includes('data-orig'), 'and it restores the source text rather than recomputing it');
});
