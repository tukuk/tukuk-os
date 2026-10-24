'use strict';
// ── WORLD RECIPES — a real recipe, from a free source, with the credit kept ─────
//
// tukuk.org answers "what is rendang" and had no answer at all for "how do I cook it".
// This cluster is that answer: the Wikibooks Cookbook — thousands of recipes, written by
// cooks, free under CC BY-SA — read straight from the MediaWiki API, parsed into an
// ingredient list and a method, and served as a page a person can cook from.
//
// Why this source and not another:
//   • it is genuinely free (CC BY-SA 4.0) rather than "free to look at"; the terms are met
//     here, not waved at — every recipe says where it came from, links its source page, and
//     every photo carries its own licence and author;
//   • it is structured enough to parse: {{recipe summary}} gives servings, time and
//     difficulty, and the method is a numbered list;
//   • it has photographs, which a recipe page needs — Google's recipe rich results ask for
//     an image, and a reader decides with their eyes.
//
// Traps in that API, all measured on 24 Oct 2026 and all handled on purpose:
//   • the summary template is spelled four ways — {{recipesummary}}, {{Recipe summary}},
//     {{recipe summary}} and {{RecipeSummary}} — and matching only one of them found a
//     serving size on one Indonesian page in fourteen;
//   • a summary block nests {{recipe}} inside itself, so a lazy `\{\{…\}\}` match cuts the
//     block off early and the parameters after it are silently lost;
//   • a category answers its members in title order, so asking a 148-page category for 24
//     recipes returns the A-B end of the alphabet; and half the "Recipes for X" categories
//     that look right (chicken, rice, sauces, breakfast) hold nothing but subcategories, so
//     those shelves are built from a namespace search instead;
//   • `prop=images` lists the difficulty icon `File:2o5dots.svg` first. The photo comes from
//     `prop=pageimages`, MediaWiki's own "representative image" for the page — it found a
//     photograph on ten of thirty-one Indonesian pages against one for the summary parameter.
//     A page with no pageimage is served without a picture rather than with a wrong one.
//
// What we do NOT do:
//   • no recipe is invented here. Everything on the page came from the source page, and the
//     link is one click away, so a reader can check the method against its authors;
//   • no image is copied to this disk. The photo is served from Wikimedia's own thumb URL
//     with its licence and author printed under it — copying it here would take their
//     bandwidth and separate the picture from the metadata that says who may use it;
//   • nothing is scraped on a loop: pages are read on demand, cached a week in memory and
//     mirrored to disk, so a restart never waits on the API for a page it already showed.
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }), // the box has no usable IPv6 route
  headers: { 'User-Agent': 'TukukOS-Recipes/1.0 (+https://tukuk.org/contact)' },
});
attachGuard(http, { name: 'recipes', budgetMs: 15000 });

// Overridable so the stale path can be exercised on a real mirror with the wiki unreachable.
const API = process.env.RECIPES_API || 'https://en.wikibooks.org/w/api.php';
const NAMESPACE = 102; // "Cookbook:" — everything else on that wiki is a lesson or a category
const MIRROR_FILE = process.env.RECIPES_MIRROR_PATH || path.join(path.dirname(config.store.path), 'recipes-last.json');
const SECTION_TTL = 7 * 24 * 60 * 60 * 1000; // a cookbook shelf moves slowly
const RECIPE_TTL = 30 * 24 * 60 * 60 * 1000; // and a recipe even less
const PER_SECTION = 24; // recipes shown on a shelf
const SAMPLE = 48;       // pages read to fill it — the API will not take more titles than this
const CARD_THUMB = 400;
const PAGE_THUMB = 800;
const KEEP_MIRRORED = 120; // bound the mirror file, oldest entries first out
const CREDIT_TTL = 24 * 60 * 60 * 1000; // a file's licence and author do not change

// The shelves are editorial: what a person looks for on a Saturday, from several cooking
// traditions rather than one. `cats` are exact Wikibooks category titles and `search` is one
// or more namespace queries for the shelves no category can supply; `featured` names the
// dishes a visitor came for, which would otherwise be buried under four hundred pages of A.
// Every one of them was checked to exist and to parse into cookable recipes before it was
// listed here.
const SECTIONS = [
  {
    slug: 'indonesian', title: 'Indonesian', cats: ['Indonesian recipes'],
    blurb: 'Rendang, gado-gado, nasi goreng: coconut milk, palm sugar and a spice paste ground before it goes in the pan.',
    featured: ['Rendang', 'Gado-gado', 'Nasi Goreng', 'Sambal', 'Sate', 'Tempeh', 'Bakso'],
  },
  {
    slug: 'malaysian', title: 'Malaysian', cats: ['Malaysian recipes'],
    blurb: 'Nasi lemak, satay and the sambal that sits under half the dishes on the table.',
    featured: ['Nasi Lemak', 'Satay', 'Kari', 'Laksa', 'Hun Kuay Tiew'],
  },
  {
    slug: 'indian', title: 'Indian', cats: ['Indian recipes'],
    blurb: 'Curries, dals and flatbreads — the largest cookbook in the world, written region by region.',
    featured: ['Butter Chicken', 'Tandoori', 'Dal', 'Samosa', 'Aloo Gobi', 'Paneer', 'Biryani', 'Vindaloo'],
  },
  {
    slug: 'chinese', title: 'Chinese', cats: ['Chinese recipes'],
    blurb: 'Wok dishes, steamed things and the sauces that make a stir-fry taste of a restaurant.',
    featured: ['Fried Rice', 'Wonton', 'Char Siu', 'Kung Pao', 'Mapo'],
  },
  {
    slug: 'japanese', title: 'Japanese', cats: ['Japanese recipes'],
    blurb: 'Rice, dashi, raw fish and the discipline of a very short ingredient list.',
    featured: ['Dashi', 'Miso Soup', 'Sushi Rice', 'Ramen', 'Tonkatsu', 'Agedashi', 'Tempura', 'Udon'],
  },
  {
    slug: 'thai', title: 'Thai', cats: ['Thai recipes'],
    blurb: 'Sweet, sour, salty and hot in the same spoonful — curry pastes, salads and soups.',
    featured: ['Green Curry', 'Red Curry', 'Tom Yum', 'Pad Thai', 'Som Tam', 'Massaman'],
  },
  {
    slug: 'vietnamese', title: 'Vietnamese', cats: ['Vietnamese recipes'],
    blurb: 'Herbs, fish sauce and broth: a plate that is assembled rather than cooked.',
    featured: ['Banh Mi', 'Pho', 'Bun', 'Chao', 'Goi'],
  },
  {
    slug: 'korean', title: 'Korean', cats: ['Korean recipes'],
    blurb: 'Fermented, grilled and served with five small plates at once.',
    featured: ['Bibimbap', 'Bulgogi', 'Kimchi', 'Japchae', 'Samgyeopsal'],
  },
  {
    slug: 'filipino', title: 'Filipino', cats: ['Filipino recipes'],
    blurb: 'Adobo, coconut and vinegar — the cooking of seven thousand islands and three colonies.',
    featured: ['Adobo', 'Sinigang', 'Lechon', 'Bicol', 'Lumpia', 'Kare'],
  },
  {
    slug: 'italian', title: 'Italian', cats: ['Italian recipes'],
    blurb: 'Pasta, beans, tomatoes and olive oil: cooking that survives on four good ingredients.',
    featured: ['Ragu', 'Carbonara', 'Minestrone', 'Risotto', 'Osso Buco', 'Pesto', 'Lasagna', 'Polenta'],
  },
  {
    slug: 'french', title: 'French', cats: ['French recipes'],
    blurb: 'The sauces and the techniques the rest of the Western kitchen was built on.',
    featured: ['Bouillabaisse', 'Beef Burgignon', 'Quiche', 'Souffle', 'Ratatouille', 'Béchamel', 'Veloute'],
  },
  {
    slug: 'mexican', title: 'Mexican', cats: ['Mexican recipes'],
    blurb: 'Maize, chiles and beans — mole to salsa, and everything in between.',
    featured: ['Mole', 'Pozole', 'Chilaquiles', 'Tamales', 'Enchilada', 'Ceviche'],
  },
  {
    slug: 'middle-eastern', title: 'Middle Eastern', cats: ['Middle Eastern recipes'],
    blurb: 'Chickpeas, yoghurt, sesame and grilled meat: the cooking of the Levant and beyond.',
    featured: ['Hummus', 'Baba Ganoush', 'Foul', 'Kibbeh', 'Tabbouleh', 'Shawarma', 'Musakhan', 'Kibbe'],
  },
  {
    slug: 'african', title: 'African', cats: ['Ethiopian recipes', 'African recipes'],
    blurb: 'Injera, peanuts and slow stews — a continent, cooked one region at a time.',
    featured: ['Doro Wat', 'Injera', 'Jollof', 'Tibs', 'Egusi', 'Tagine'],
  },
  {
    slug: 'soups', title: 'Soups & Broths', cats: ['Recipes for soup'],
    blurb: 'The cheapest dinner there is, and the one that tastes better the next day.',
    featured: ['Chicken Soup', 'Tomato Soup', 'Onion Soup', 'Miso', 'Minestrone', 'Gazpacho', 'Beef Broth'],
  },
  {
    slug: 'stews', title: 'Stews & Braises', cats: ['Recipes for stew'],
    blurb: 'Low heat, long time, and a pot that feeds more people than the shop bought.',
    featured: ['Beef Stew', 'Goulash', 'Cassoulet', 'Ragout', 'Lamb Stew', 'Chili'],
  },
  {
    slug: 'bread', title: 'Bread', cats: ['Recipes for bread'],
    blurb: 'Flour, water, salt, time — plus the quick breads for the day you have no time.',
    featured: ['Sourdough', 'Ciabatta', 'Focaccia', 'Baguette', 'Cornbread', 'Naan', 'Brioche', 'Potato Bread'],
  },
  {
    slug: 'rice', title: 'Rice & Grains', search: ['intitle:rice', 'intitle:congee'],
    blurb: 'The side dish that is the main course for most of the world, cooked so it comes out right.',
    featured: ['Steamed Basmati Rice', 'Fried Rice', 'Sushi Rice', 'Jollof Rice', 'Rice Pilaf'],
  },
  {
    slug: 'pasta', title: 'Pasta & Noodles', cats: ['Recipes for pasta'], search: 'intitle:noodle',
    blurb: 'Boiled, fried or in a soup, with the sauces that cling to it.',
    featured: ['Egg Noodles', 'Lasagna', 'Fettuccine', 'Ramen Noodle', 'Udon', 'Spaghetti'],
  },
  {
    slug: 'chicken', title: 'Chicken', search: 'intitle:chicken',
    blurb: 'The most-cooked meat on earth, from a roast to a curry to something fried late at night.',
    featured: ['Roast Chicken', 'Fried Chicken', 'Butter Chicken', 'Chicken Curry', 'Chicken Soup', 'Cordon Bleu'],
  },
  {
    slug: 'salads', title: 'Salads & Cold Dishes', cats: ['Recipes for salad'],
    blurb: 'Raw or cooked, and the dressings that make a vegetable want to be eaten.',
    featured: ['Coleslaw', 'Caesar', 'Potato Salad', 'Waldorf', 'Tabbouleh', 'Noodle Salad'],
  },
  {
    slug: 'vegetables', title: 'Vegetables', search: ['intitle:vegetable', 'intitle:eggplant'],
    blurb: 'The part of the meal nobody teaches you to cook properly.',
    featured: ['Roasted Eggplant', 'Grilled Zucchini', 'Creamed Spinach', 'Vegetable Curry'],
  },
  {
    slug: 'cakes', title: 'Cake & Sponge', cats: ['Recipes for cake'],
    blurb: 'Birthdays, tea, and the banana bread that saves two overripe bunches.',
    featured: ['Banana Bread', 'Sponge Cake', 'Cheesecake', 'Carrot Cake', 'Black Forest', 'Pound Cake'],
  },
  {
    slug: 'cookies', title: 'Biscuits & Cookies', cats: ['Recipes for cookies'],
    blurb: 'A one-hour bake that keeps for a week in a tin.',
    featured: ['Chocolate Chip', 'Gingerbread', 'Shortbread', 'Snickerdoodle', 'Anzac', 'Macaroon'],
  },
  {
    slug: 'desserts', title: 'Desserts', cats: ['Recipes for dessert'],
    blurb: 'Four hundred and seventy pages of the last course, from a custard to a something with fruit.',
    featured: ['Tiramisu', 'Creme Brulee', 'Apple Pie', 'Trifle', 'Panna Cotta', 'Mousse', 'Baklava'],
  },
  {
    slug: 'sauces', title: 'Sauces & Condiments', cats: ['Recipes for sauces and condiments'],
    blurb: 'The five a cook should know cold, and the jars that go with them.',
    featured: ['Mayonnaise', 'Hollandaise', 'Tomato Sauce', 'Pesto', 'Salsa', 'Gravy', 'Ketchup', 'Chutney'],
  },
  {
    slug: 'drinks', title: 'Drinks', cats: ['Recipes for beverages'],
    blurb: 'Tea, coffee, cordials and the fermented ones, made at home.',
    featured: ['Lemonade', 'Horchata', 'Coffee', 'Smoothie', 'Punch', 'Sangria', 'Chai'],
  },
];

const BY_SLUG = new Map(SECTIONS.map((s) => [s.slug, s]));
const cache = new Map(); // 'section:slug' | 'recipe:Title' → { at, ... }
const credits = new Map(); // 'File name' → { at, value } — the licence and author of a photograph
const stats = { through: 0, mirrored: 0, failed: 0, lastError: '' };

// ── wikitext → a recipe ─────────────────────────────────────────────────────────
// MediaWiki text is not markup for a human to skip: templates, category tags and reference
// notes are instructions to the wiki, and none of them belong on a recipe page.
//
// The one rule that cost the most to learn: a list marker does not need a space. Nineteen of
// the forty-six sampled bread pages and Nasi Goreng's whole ingredient list are written
// `*2 eggs`, and insisting on `* ` reported them as recipes with no ingredients at all.

/** Every wiki construct a reader has no use for, removed in the order it must be removed. */
function stripWiki(text) {
  let t = String(text || '');
  t = t.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  t = t.replace(/<[^>]*>/g, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  // Templates first, innermost, so {{a|{{b}}}} cannot leave a stray brace behind.
  for (let i = 0; i < 4 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/gi, '');
  t = t.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1'); // [[Cookbook:Peanut|peanuts]] → peanuts
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');          // [[Peanut]] → Peanut
  t = t.replace(/'''''([^']*)'''''/g, '$1');
  t = t.replace(/'''?([^']*)'''?/g, '$1');
  t = t.replace(/__[A-Z]+__/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

// A page flagged with one of these is telling the reader it is not finished — missing
// quantities, an unformatted method, text copied off YouTube. Publishing it as a recipe would
// be the site's fault, not the wiki's.
const INCOMPLETE = /\{\{\s*(incomplete|improve|stubrec|copyedyoutube|not english|delete|update)\b/i;

/**
 * The body of the {{recipe summary}} block, with the braces counted rather than matched
 * lazily: the Cookbook nests {{recipe}} inside its own summary, and a lazy pattern stops
 * there and loses every parameter that came after it.
 */
function summaryBlock(wikitext) {
  const w = String(wikitext || '');
  const start = /\{\{\s*recipe[ _]?summary\b/i.exec(w);
  if (!start) return '';
  let depth = 0;
  for (let i = start.index; i < w.length - 1; i++) {
    const pair = w.substr(i, 2);
    if (pair === '{{') depth++;
    else if (pair === '}}') {
      depth--;
      if (depth === 0) return w.slice(start.index + 2, i);
    }
  }
  return w.slice(start.index + 2);
}

/**
 * The parameters of a summary block, lower-cased and de-spaced — the wiki spells them five
 * ways and on one line or forty. A value that contains a wikilink is split across the pipe
 * the link itself uses, so links are hidden from the splitter first and put back after.
 */
function readSummary(wikitext) {
  let body = summaryBlock(wikitext);
  if (!body) return {};
  body = body.replace(/\[\[[^\]]*\]\]/g, (m) => m.replace(/\|/g, '\u0001'));
  const out = {};
  let last = '';
  for (const chunk of body.split('|')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) {
      if (last && chunk.trim()) out[last] = `${out[last]} ${chunk.trim()}`;
      continue;
    }
    const k = chunk.slice(0, eq).trim().toLowerCase().replace(/[^a-z]/g, '');
    const v = chunk.slice(eq + 1).trim();
    if (!k) continue;
    if (v) {
      if (!(k in out)) out[k] = v;
      last = k;
    } else {
      last = '';
    }
  }
  for (const k of Object.keys(out)) out[k] = out[k].replace(/\u0001/g, '|');
  return out;
}

/**
 * The file name inside `[[File:…]]` or `[[Image:…]]`, read a character at a time: the name
 * ends at the pipe of a size or the brackets that close the link, and neither of those can
 * appear in a file name, so there is nothing to match and nothing to get wrong.
 */
function readLink(raw) {
  const start = /\[\[\s*(?:image|file)\s*:\s*/i.exec(raw);
  if (!start) return '';
  const stop = ['|', '[', ']', '\n'];
  let found = '';
  for (const ch of raw.slice(start.index + start[0].length)) {
    if (stop.includes(ch)) break;
    found += ch;
  }
  return found.trim();
}

/** The File: name from the summary's Image=, if there is a photograph at all. */
function imageFile(summary) {
  const raw = String(summary.image || '');
  const name = readLink(raw).replace(/_/g, ' ');
  if (!name) return '';
  // The Cookbook's difficulty and rating icons are SVGs sitting in the same field on some
  // pages. A recipe page with a dot-icon for a photograph is worse than one with no image.
  if (/\.svg$/i.test(name)) return '';
  return name;
}

/** "300 g peanuts" → the amount and the thing, so the scaler has a number to multiply. */
const UNITS = 'g|kg|ml|l|litre|litres|liter|liters|mg|oz|lb|lbs|tsp|tbsp|tablespoons?|teaspoons?|cup|cups|pint|pints|quart|quarts|gallon|gallons|pinch|pinches|clove|cloves|slice|slices|piece|pieces|can|cans|packet|packets|handful|handfuls|bunch|bunches|sprig|sprigs|head|heads|stalk|stalks|leaf|leaves|each|ea|small|large|medium|dash|dashes|stick|sticks|fillet|fillets|cm|mm|inch|inches|mcal|kcal|cal';
const VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

// The marks a measuring cup and a set of spoons actually carry, to the nearest of which a
// scaled quantity is rounded — "⅓ × 1.5" is ½, and it is ½ on the page and in the cup.
const MARKS = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'],
  [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']];

// A quantity at the head of an ingredient line, longest shape first so "1 1/2" is not read as
// "1" and left over as "1/2 cups flour": a mixed number, a number and a fraction mark (typed
// together as "1½" or apart as "1 ½"), a plain fraction, a fraction mark, a range, a bare
// number.
const MARKS_CLASS = '[½⅓⅔¼¾⅛⅜⅝⅞]';
const NUM = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*${MARKS_CLASS}|\\d+\\s*\\/\\s*\\d+|${MARKS_CLASS}|\\d+\\s*[-–]\\s*\\d+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)`;

/**
 * Split one ingredient line. Returns an empty amount when there is no number at the start,
 * which is the honest answer for "salt" and "vegetable oil" — nothing can be scaled, but the
 * word still has to be on the list.
 *
 * Only one word is allowed to be the unit, and it is kept only if it really is one: taking
 * three left "2 cloves" with the unit "cloves garlic" and no item at all, and "2 L" with the
 * unit "L ready" out of "2 L ready-to-use coconut milk".
 */
function splitAmount(cleaned) {
  const s = String(cleaned || '').trim();
  const m = new RegExp(`^(${NUM})(?:\\s*([a-zA-Z]+)\\.?)?\\s*`, 'i').exec(s);
  if (!m) return { amount: '', unit: '', item: s };
  const amount = m[1].replace(/\s+/g, ' ').trim();
  let unit = (m[2] || '').trim();
  let item = s.slice(m[0].length).trim();
  if (unit && !new RegExp(`^(?:${UNITS})\\b`, 'i').test(unit)) {
    // The "unit" slot caught the first word of the ingredient itself ("2 tomatoes" →
    // unit "tomatoes"), so put it back where it belongs — and not in front of a comma.
    item = `${unit}${item && !/^[.,;)]/.test(item) ? ' ' : ''}${item}`.trim();
    unit = '';
  }
  return { amount, unit, item };
}

/** A number out of a quantity. Fractions, ranges, unicode marks, and the first number only. */
function toNumber(amount) {
  const s = String(amount || '').trim();
  if (!s) return null;
  if (VULGAR[s] !== undefined) return VULGAR[s];
  const chars = [...s].map((c) => (VULGAR[c] !== undefined ? String(VULGAR[c]) : c)).join('');
  const mixedMark = /^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])/.exec(s); // "2 ½" and "2½" are both two and a half
  if (mixedMark) return Number(mixedMark[1]) + VULGAR[mixedMark[2]];
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(chars);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const single = /^(\d+)\s*\/\s*(\d+)/.exec(chars);
  if (single) return Number(single[1]) / Number(single[2]);
  const range = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/.exec(chars);
  if (range) return (Number(range[1].replace(',', '.')) + Number(range[2].replace(',', '.'))) / 2;
  // The first number in the string and nothing else: gluing every digit together turned
  // "5–6 servings" into 56 and silently scaled a recipe by the wrong factor.
  const first = /(\d+(?:[.,]\d+)?)/.exec(chars);
  return first ? Number(first[1].replace(',', '.')) : null;
}

/**
 * A quantity the reader can multiply. Fractions stay fractions, because a kitchen measures in
 * halves and quarters and "0.3333333333333333 cups" is not a thing anyone pours.
 */
function scaleAmount(amount, factor) {
  const n = toNumber(amount);
  if (n === null) return String(amount || '');
  const v = n * factor;
  if (v >= 100) return String(Math.round(v));
  const whole = Math.floor(v);
  const rest = v - whole;
  let best = MARKS[0];
  for (const m of MARKS) if (Math.abs(m[0] - rest) < Math.abs(best[0] - rest)) best = m;
  let total = whole;
  let frac = best[1];
  if (best[0] === 1) { total += 1; frac = ''; }
  if (total === 0 && frac === '') return String(+v.toFixed(2)); // never show "0" for a pinch
  return `${total || ''}${total && frac ? ' ' : ''}${frac}`.trim();
}

/**
 * The batch the recipe was written for, as a number to divide by. "4" is 4 and "5–6 servings"
 * is 6 — a range is rounded because the scaler works in whole servings and a base of 5.5 makes
 * every factor on the page a fraction. "1 plate" or a blank parameter is null, and a null
 * means no scaler on the page: guessing a batch size and halving somebody else's recipe is how
 * a site loses a reader.
 */
function servingsCount(raw) {
  const s = String(raw || '').replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, (c) => String(VULGAR[c]));
  const range = /(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/.exec(s);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2);
  const n = /(\d+(?:[.,]\d+)?)/.exec(s);
  return n ? Number(n[1]) : null;
}

/**
 * "1 h 30 min", "4hrs", "2 1/2 hours" → an ISO 8601 duration, or '' when it is not a time.
 * Only hours and minutes: nothing in the Cookbook gives seconds, and a made-up `PT0S` in the
 * structured data is a wrong answer rather than an empty one.
 */
function duration(text) {
  const s = String(text || '').toLowerCase();
  const h = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(s);
  const m = /(\d+(?:[.,]\d+)?)\s*(?:mins?|minutes?)\b/.exec(s);
  const mins = Math.round((h ? Number(h[1].replace(',', '.')) * 60 : 0) + (m ? Number(m[1].replace(',', '.')) : 0));
  if (!mins) return '';
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `PT${hh ? `${hh}H` : ''}${mm ? `${mm}M` : ''}`;
}

/**
 * Everything between two headings of the same name at any depth.
 *
 * A sub-heading inside the section belongs to it and is kept — "=== Spice paste ===" over a
 * dozen bullets in rendang is the difference between an ingredient list and a pile of
 * ingredients. A heading at the depth the section started at ends it.
 */
function sectionText(wikitext, names) {
  const wanted = names.map((n) => String(n).toLowerCase().replace(/[^a-z ]/g, '').trim());
  const lines = String(wikitext || '').split('\n');
  let depth = 0; let collecting = false;
  const out = [];
  for (const line of lines) {
    const h = /^(=+)\s*(.*?)\s*=+\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const name = h[2].toLowerCase().replace(/[^a-z ]/g, '').trim();
      if (wanted.includes(name)) {
        if (!collecting) { collecting = true; depth = level; }
        continue;
      }
      if (collecting) {
        if (level <= depth) { if (out.length) break; collecting = false; }
        else out.push(line); // a group heading inside the section, like the spice paste
      }
      continue;
    }
    if (collecting) out.push(line);
  }
  return out.join('\n');
}

/** Ingredient lines, from either house style: a bullet list, or a wikitable. */
function parseIngredients(wikitext) {
  const body = sectionText(wikitext, ['ingredients', 'what you will need', 'you will need']);
  if (!body.trim()) return [];
  if (/\{\|\s*class="wikitable/.test(body)) return parseIngredientTable(body);
  const groups = [];
  let current = { group: '', items: [] };
  for (const line of body.split('\n')) {
    const sub = /^={3,}\s*(.*?)\s*={3,}\s*$/.exec(line);
    if (sub) {
      if (current.items.length) groups.push(current);
      current = { group: stripWiki(sub[1]), items: [] };
      continue;
    }
    const item = /^\s*[*#]+\s*(.*)$/.exec(line);
    if (!item) continue;
    const text = stripWiki(item[1]);
    if (!text || /^-{0,2}\s*$/.test(text)) continue;
    current.items.push({ text, ...splitAmount(text) });
  }
  if (current.items.length) groups.push(current);
  return groups;
}

// The baker's-style table: Ingredient | Count | Volume | Weight | %. Read by position, and
// the amount prefers volume, then count, then weight — in that order a cook uses them.
function parseIngredientTable(body) {
  const rows = body.split(/^\s*\|-\s*$/m).slice(1);
  const groups = [{ group: '', items: [] }];
  for (const row of rows) {
    if (/^[-{}]/.test(row.trim()) || /\|\}/.test(row)) continue;
    const cells = row.split('\n|').map((c) => c.replace(/^\|/, '').replace(/^\s*!.*$/, '').trim());
    if (cells.length < 2) continue;
    const item = stripWiki(cells[0]);
    if (!item || /^(total|ingredient)$/i.test(item)) continue;
    const amount = [cells[2], cells[1], cells[3]].map((c) => stripWiki(c || '')).find((c) => /\d/.test(c)) || '';
    groups[0].items.push({ text: amount ? `${amount} ${item}` : item, ...splitAmount(amount ? `${amount} ${item}` : item) });
  }
  return groups[0].items.length ? groups : [];
}

/** The method: numbered lines, with indented lines folded into the step they follow. */
function parseSteps(wikitext) {
  const body = sectionText(wikitext, ['procedure', 'directions', 'preparation', 'method', 'steps']);
  const steps = [];
  for (const line of body.split('\n')) {
    const m = /^\s*(#+)\s*(.*)$/.exec(line);
    if (m) {
      if (m[1].length > 1 && steps.length) {
        const extra = stripWiki(m[2]);
        if (extra) steps[steps.length - 1].text += ` ${extra}`;
        continue;
      }
      const text = stripWiki(m[2]);
      if (text) steps.push({ text });
    } else if (steps.length && /^\s{2,}\S/.test(line) && !/^[*|=]/.test(line.trim())) {
      const extra = stripWiki(line); // a step that wrapped onto the next line
      if (extra && !/^\{/.test(line.trim())) steps[steps.length - 1].text += ` ${extra}`;
    }
  }
  return steps;
}

/** The one paragraph the Cookbook writes before the ingredients, kept for the lead. */
function parseIntro(wikitext) {
  const lines = String(wikitext || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || /^[={*#|;<>!]/.test(t) || /^__/.test(t) || /^\{\{/.test(t) || /^\[\[/.test(t)) continue;
    // A summary block closed on one line and its leftovers on the next, so a line still
    // holding a brace is wiki machinery, not prose: "}}{{recipe}} | Cuisine of Indonesia".
    if (/[{}]/.test(t)) continue;
    const cleaned = stripWiki(t);
    if (cleaned.length > 24 && /\S+\s+\S+/.test(cleaned)) return cleaned;
  }
  return '';
}

const dishName = (title) => String(title || '').replace(/^Cookbook:/, '').trim();

/**
 * A title in a url. Accents are folded rather than dropped, because `Bánh Mì` and `Banh Mi`
 * are two different pages of the Cookbook and one of them must not be handed the other's
 * recipe; and a title that folds to nothing (one written entirely in a non-latin script)
 * still needs a link, so it falls back to the shelf's index rather than to an empty slug.
 */
function dishSlug(title) {
  const folded = dishName(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return folded || 'recipe';
}

/** The last path segment a dish is served under, with repeats numbered instead of shadowed. */
function assignSlugs(recipes) {
  const seen = new Map();
  for (const r of recipes) {
    const base = dishSlug(r.title);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.path = n === 1 ? base : `${base}-${n}`;
  }
  return recipes;
}

const recipePath = (r) => r.path || dishSlug(r.title);

/**
 * One page of Cookbook wikitext, turned into something a person can cook from.
 * Pure — every rule above is testable without the network, and each was added because a real
 * page broke it. `photo` is what MediaWiki says represents the page: `{ name, thumb }`.
 */
function parseRecipe(title, wikitext, photo) {
  const w = String(wikitext || '');
  const summary = readSummary(w);
  const groups = parseIngredients(w);
  const steps = parseSteps(w);
  const p = photo || {};
  const batch = stripWiki(summary.servings || summary.yield || '');
  const incomplete = INCOMPLETE.test(w);
  return {
    title: dishName(title),
    // The page title as the wiki spells it, namespace included: the dish route resolves a
    // shelf entry back to its page, and a title with "Cookbook:" stripped is a 404.
    full: String(title || '').trim(),
    slug: dishSlug(title),
    // The namespace stays in the link: dropping "Cookbook:" makes the source url a 404, and
    // that link is the one promise on the page a reader can check the recipe against.
    url: `https://en.wikibooks.org/wiki/${String(title || '').replace(/ /g, '_')}`,
    incomplete,
    servings: batch,
    batch: servingsCount(batch || String(summary.servings || '')),
    time: stripWiki(summary.time || ''),
    difficulty: stripWiki(summary.difficulty || ''),
    note: stripWiki(summary.note || ''),
    image: p.name || imageFile(summary), // pageimages is the better judge, the summary the fallback
    thumb: p.thumb || '',
    intro: parseIntro(w),
    groups,
    steps,
    // A Cookbook page that carries no summary template at all is an article about an
    // ingredient, not a recipe — the namespace search turns up plenty of them.
    usable: !incomplete && Object.keys(summary).length > 0
      && steps.length > 0 && groups.some((g) => g.items.length),
  };
}

// ── the API ─────────────────────────────────────────────────────────────────────
function readMirror() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMirror(key, entry, all) {
  try {
    all[key] = { at: new Date().toISOString(), ...entry };
    const keys = Object.keys(all).filter((k) => k.startsWith('recipe:'));
    if (keys.length > KEEP_MIRRORED) {
      keys.sort((a, b) => String(all[a].at).localeCompare(String(all[b].at)))
        .slice(0, keys.length - KEEP_MIRRORED)
        .forEach((k) => delete all[k]);
    }
    fs.mkdirSync(path.dirname(MIRROR_FILE), { recursive: true });
    const tmp = `${MIRROR_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, MIRROR_FILE); // rename is atomic: a reader never sees half a file
    stats.mirrored++;
  } catch {
    // a failed mirror is a slow request later, never a broken page now
  }
}

function api(params) {
  return http.get(API, { params: { format: 'json', ...params } }).then((r) => r.data);
}

/** The recipe pages in one category, in the order the wiki lists them (which is alphabetical). */
async function categoryTitles(cat) {
  const data = await api({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmlimit: 500, cmtype: 'page' });
  return ((data.query && data.query.categorymembers) || [])
    .map((p) => p.title)
    .filter((t) => t.startsWith('Cookbook:')); // a category also holds the sandboxes people file things into
}

/** The recipe pages a namespace search finds, in relevance order. */
async function searchTitles(text) {
  const data = await api({ action: 'query', list: 'search', srsearch: text, srnamespace: NAMESPACE, srlimit: 160 });
  return ((data.query && data.query.search) || []).map((h) => h.title).filter((t) => t.startsWith('Cookbook:'));
}

async function gatherTitles(spec) {
  const out = [];
  const seen = new Set();
  const add = (t) => { if (!seen.has(t)) { seen.add(t); out.push(t); } };
  for (const cat of spec.cats || []) {
    for (const t of await categoryTitles(cat)) add(t);
    await new Promise((r) => setTimeout(r, 120));
  }
  // One query per term: CirrusSearch reads `intitle:rice OR intitle:congee` as a phrase and
  // answers with one page, so a shelf that needs several words asks for them one at a time.
  for (const term of [].concat(spec.search || [])) {
    for (const t of await searchTitles(term)) add(t);
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

/**
 * Which pages a shelf is made of. The dishes a visitor came for first, then a spread of the
 * rest: a category is sorted by title, so taking the first twenty-four of one hundred and
 * forty-eight Indian recipes gave a shelf of dishes beginning A and B and nothing else. A
 * search is already ordered by how well it matches, so its order is left alone.
 *
 * `n` is asked for larger than a shelf shows, because the source is untidy: about a fifth of
 * the pages in a category are stubs, sandboxes or articles about an ingredient rather than a
 * recipe, and they are only known to be after they have been read.
 */
function chooseTitles(all, spec, n = SAMPLE) {
  const picked = [];
  const taken = new Set();
  for (const want of spec.featured || []) {
    const hit = all.find((t) => !taken.has(t) && dishName(t).toLowerCase().includes(String(want).toLowerCase()));
    if (hit) { picked.push(hit); taken.add(hit); }
  }
  const rest = all.filter((t) => !taken.has(t));
  const slots = Math.max(0, n - picked.length);
  if (!slots) return picked.slice(0, n);
  if ([].concat(spec.search || []).length) return picked.concat(rest.slice(0, slots)).slice(0, n);
  const stride = Math.max(1, Math.ceil(rest.length / slots));
  for (let i = 0; i < rest.length && picked.length < n; i += stride) picked.push(rest[i]);
  return picked;
}

/**
 * Content, summary and representative photo for up to fifty pages, in one request.
 *
 * The answer comes back in page-id order, which is the order the pages were created in, not
 * the order they were asked for — so the curated sequence is put back afterwards, or the
 * featured dishes end up wherever the wiki happens to have filed them.
 */
async function fetchPages(titles, thumbSize) {
  const data = await api({
    action: 'query', titles: titles.slice(0, 50).join('|'),
    prop: 'revisions|pageimages', rvprop: 'content', rvslots: 'main',
    piprop: 'name|thumbnail', pithumbsize: thumbSize, redirects: 1, indexpageids: 1,
  });
  const pages = data && data.query && data.query.pageids
    ? data.query.pageids.map((id) => data.query.pages[id]) : [];
  const parsed = pages.filter(Boolean).map((p) => parseRecipe(p.title,
    (p.revisions && p.revisions[0] && p.revisions[0].slots && p.revisions[0].slots.main && p.revisions[0].slots.main['*']) || '',
    // The file name is kept spaced, the way every image title is answered, or a photo called
    // "Banh_Mi,_Eden_Center.jpg" never matches the credit looked up for it.
    { name: String(p.pageimage || '').replace(/_/g, ' '), thumb: (p.thumbnail && p.thumbnail.source) || '' }));
  const rank = new Map(titles.map((t, i) => [dishName(t).toLowerCase(), i]));
  return parsed.sort((a, b) => (rank.has(a.title.toLowerCase()) ? rank.get(a.title.toLowerCase()) : 1e3)
    - (rank.has(b.title.toLowerCase()) ? rank.get(b.title.toLowerCase()) : 1e3));
}

/** Everything on one shelf that a person could actually cook. */
async function fetchSection(slug) {
  const spec = BY_SLUG.get(slug);
  if (!spec) return [];
  const all = await gatherTitles(spec);
  if (!all.length) throw new Error(`nothing in ${slug} any more`);
  const parsed = await fetchPages(chooseTitles(all, spec), CARD_THUMB);
  return assignSlugs(parsed.filter((r) => r.usable).slice(0, PER_SECTION));
}

/** The list for one shelf. Fresh memory → the API → the disk mirror → nothing. */
async function section(slug) {
  if (!BY_SLUG.get(slug)) return { recipes: [], at: null, stale: false };
  const key = `section:${slug}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SECTION_TTL) return { recipes: hit.recipes, at: hit.at, stale: false };
  const mirror = readMirror();
  try {
    const recipes = await fetchSection(slug);
    if (!recipes.length) throw new Error('no cookable recipe on this shelf');
    cache.set(key, { at: Date.now(), recipes });
    stats.through++;
    writeMirror(key, { recipes }, mirror);
    return { recipes, at: Date.now(), stale: false };
  } catch (err) {
    stats.failed++;
    stats.lastError = String((err && err.message) || err).slice(0, 160);
    const last = mirror[key];
    if (last && Array.isArray(last.recipes) && last.recipes.length) {
      return { recipes: last.recipes, at: Date.parse(last.at) || null, stale: true };
    }
    return { recipes: [], at: null, stale: false };
  }
}

/** Thumb URL + licence + author for a photograph, because CC-BY-SA says we print them. */
async function images(names) {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean).slice(0, 20);
  if (!wanted.length) return {};
  try {
    const data = await api({
      action: 'query', titles: wanted.map((n) => `File:${n.replace(/ /g, '_')}`).join('|'),
      prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: PAGE_THUMB,
      iiextmetadatafilter: 'LicenseShortName|Artist|AttributionRequired|LicenseUrl',
    });
    const out = {};
    for (const p of Object.values((data.query && data.query.pages) || {})) {
      const info = (p.imageinfo || [])[0];
      if (!info) continue;
      const meta = info.extmetadata || {};
      const artist = stripWiki((meta.Artist || {}).value || '');
      out[String(p.title || '').replace(/^File:/, '').replace(/_/g, ' ')] = {
        thumb: info.thumburl || info.url || '',
        page: info.descriptionurl || '',
        licence: stripWiki((meta.LicenseShortName || {}).value || ''),
        author: artist.slice(0, 120),
        required: String((meta.AttributionRequired || {}).value || '').toLowerCase() !== 'false',
      };
    }
    return out;
  } catch {
    return {}; // a photo whose credit cannot be read is a photo that does not get shown
  }
}

/** One recipe by its exact page title ("Cookbook:Rendang (Indonesian Beef and Coconut Stew)"). */
async function recipe(title) {
  const key = `recipe:${title}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RECIPE_TTL) return hit.data;
  const mirror = readMirror();
  try {
    const [parsed] = await fetchPages([title], PAGE_THUMB);
    if (!parsed) throw new Error('the cookbook has no such page');
    if (!parsed.usable) throw new Error('that page is not a cookable recipe');
    cache.set(key, { at: Date.now(), data: parsed });
    stats.through++;
    writeMirror(key, { data: parsed }, mirror);
    return parsed;
  } catch (err) {
    stats.failed++;
    stats.lastError = String((err && err.message) || err).slice(0, 160);
    const last = mirror[key];
    if (last && last.data) return { ...last.data, stale: true };
    return null;
  }
}

/**
 * The licence and the author of one photograph, kept a day.
 *
 * Returns `{}` when the file cannot be read, and that answer is not cached: a five-second
 * network failure must not cost a dish its picture for a month, since the recipe itself is
 * cached for a month.
 */
async function credit(name) {
  const key = String(name || '').replace(/_/g, ' ').trim();
  if (!key) return {};
  const hit = credits.get(key);
  if (hit && Date.now() - hit.at < CREDIT_TTL) return hit.value;
  const found = await images([key]);
  const value = found[key] || {};
  if (value.thumb) credits.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Every dish this site currently serves, for the sitemap.
 *
 * Read from memory first and the disk mirror after, and never from the network: a crawler
 * hitting /sitemap-recipes.xml must get an answer at the same moment the API is down, and it
 * must be an answer about pages that really render. A shelf that has never been visited or
 * mirrored simply contributes no urls until it has.
 */
function inventory() {
  const mirror = readMirror();
  const rows = [];
  for (const spec of SECTIONS) {
    const key = `section:${spec.slug}`;
    const live = cache.get(key);
    const stored = mirror[key];
    const recipes = (live && live.recipes && live.recipes.length && live.recipes)
      || (stored && stored.recipes && stored.recipes.length && stored.recipes) || [];
    const at = live ? new Date(live.at).toISOString().slice(0, 10)
      : (stored && stored.at ? String(stored.at).slice(0, 10) : null);
    for (const r of recipes) {
      if (r && r.title && !r.incomplete) rows.push({ section: spec.slug, path: recipePath(r), title: r.title, at });
    }
  }
  return rows;
}

/**
 * Read every shelf once so the first visitor after a deploy is not the one who waits for it.
 * Sequential and spaced — this is a shared free API, not our own database.
 */
async function prime({ gapMs = 900, log = () => {}, fetchOne = fetchSection } = {}) {
  let done = 0;
  for (const spec of SECTIONS) {
    try {
      const recipes = await fetchOne(spec.slug);
      if (recipes.length) { cache.set(`section:${spec.slug}`, { at: Date.now(), recipes }); done++; }
      log(`[recipes] ${spec.slug}: ${recipes.length}`);
    } catch {
      log(`[recipes] ${spec.slug}: unavailable`); // the mirror and the next visitor will cope
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return done;
}

function status() {
  return { sections: SECTIONS.length, cached: cache.size, ...stats, lastError: stats.lastError || null };
}

module.exports = {
  SECTIONS, BY_SLUG, PER_SECTION, SAMPLE, API, NAMESPACE, MIRROR_FILE, SECTION_TTL, RECIPE_TTL, CARD_THUMB, PAGE_THUMB,
  section, recipe, images, credit, inventory, prime, status, fetchSection, chooseTitles, gatherTitles,
  parseRecipe, parseIngredients, parseSteps, parseIntro, stripWiki, summaryBlock, readSummary,
  imageFile, splitAmount, scaleAmount, toNumber, servingsCount, duration, dishName, dishSlug, assignSlugs, recipePath,
  INCOMPLETE,
};
