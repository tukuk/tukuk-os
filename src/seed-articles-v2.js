#!/usr/bin/env node
/**
 * One-shot seed script — populates the store with the bundled articles under
 * `src/articles/*` (v2 batch: journey-a/b, tukuk-a/b, extra) and normalises every
 * post's author to the current owner. Also flags any article outside the 650–850
 * word range so a batch that slipped through review is visible in the console output.
 *
 * Run manually from a dev checkout (`node src/seed-articles-v2.js`) — NOT part of
 * the boot sequence. The runtime store is idempotent, so re-running only inserts new
 * slugs and never duplicates existing posts.
 */
const store = require('./store');
const journeyA = require('./articles/journey-a');
const journeyB = require('./articles/journey-b');
const tukukA = require('./articles/tukuk-a');
const tukukB = require('./articles/tukuk-b');
const extra = require('./articles/extra');

const AUTHOR = 'Fevian Donald';
const articles = [...journeyA, ...journeyB, ...tukukA, ...tukukB, ...extra];

/** Count whitespace-delimited tokens (used to flag articles outside the 650-850 window). */
function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Insert every bundled article that is not already in the store; report the deltas. */
function seed() {
  store.load();

  let authorsFixed = 0;
  for (const post of store.getAllPosts(500)) {
    if (post.author !== AUTHOR) {
      store.updatePost(post.id, { author: AUTHOR });
      authorsFixed += 1;
    }
  }

  let added = 0;
  const problems = [];
  for (const item of articles) {
    if (store.getPostBySlug(item.slug)) continue;
    store.createPost({ ...item, author: AUTHOR });
    added += 1;
    const wc = wordCount(item.content);
    if (wc < 650 || wc > 850) problems.push(`${wc} words: ${item.title}`);
  }

  const total = store.getAllPosts(500).length;
  console.log(`[seed-v2] authors normalised: ${authorsFixed}`);
  console.log(`[seed-v2] new articles added: ${added}`);
  console.log(`[seed-v2] total articles: ${total}`);
  if (problems.length) {
    console.log('[seed-v2] WARNING outside the 650-850 word range:');
    for (const p of problems) console.log('  - ' + p);
  } else {
    console.log('[seed-v2] every new article is inside the 650-850 word range.');
  }
}

seed();
process.exit(0);
