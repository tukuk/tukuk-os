const crypto = require('crypto');
const store = require('./store');

/**
 * Index the blog content (store.posts) into the main search corpus.
 *
 * The problem: `scripts/import-posts.js` + `store.syncPostsFromContent()` load
 * content/blog/*.md into the STORE (served at /blog), but NOTHING
 * pushes them into Meilisearch. `/search` and the `/ask` grounding only read
 * `halaman_web` (the crawled news corpus). As a result the curated guides/blogs — 'bm25',
 * 'cloudflare' — returned 0 hits.
 *
 * This module bridges that gap: turn each store post into a document
 * with the same schema as `_populateInitialDocs` (meili.js), then updateDocuments
 * into the main index. The id is deterministic (sha256(slug)) → idempotent; running it
 * many times produces no duplicates.
 */

// The blog document schema — matches the seed articles in meili.js `_populateInitialDocs`.
function postToDoc(post) {
  const content = post.content || '';
  const id = crypto.createHash('sha256').update(post.slug || post.title).digest('hex').slice(0, 16);
  return {
    id,
    url: `https://tukuk.org/blog/${post.slug}`,
    title: post.title,
    description: post.excerpt || content.slice(0, 200),
    content,
    summary: post.excerpt || '',
    siteName: 'Tukuk-OS',
    host: 'tukuk.org',
    lang: /[a-z]/i.test(post.title) && !/\b(dan|yang|untuk|ini|itu)\b/i.test(content) ? 'en' : 'ms',
    type: 'article',
    section: (post.tags && post.tags[0]) || 'Blog',
    keywords: (post.tags && post.tags.length) ? post.tags : ['tukuk', 'search'],
    headings: (content.match(/^#{2,4}\s+(.+)$/gm) || []).map((h) => h.replace(/^#{2,4}\s+/, '')),
    publishedAt: post.createdAt || new Date('2026-03-01').toISOString(),
    crawledAt: new Date().toISOString(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    quality: 0.95
  };
}

/**
 * Push every store post into the main index.
 * @param {object} index  The Meilisearch index (hybrid real+mock) from ensureIndex().
 * @param {object} opts   { limit, logger }
 * @returns {Promise<{count:number, taskUid:*}>}
 */
async function indexBlogPosts(index, { limit = 1000, logger = console } = {}) {
  const posts = store.getAllPosts(limit);
  if (!posts || posts.length === 0) {
    return { count: 0, taskUid: null };
  }
  const docs = posts.map(postToDoc);
  const task = await index.updateDocuments(docs);
  if (logger && logger.log) {
    logger.log(`[blog-index] ${docs.length} blog posts sent to the main index (task ${task && task.taskUid ? task.taskUid : 'mock'})`);
  }
  return { count: docs.length, taskUid: task && task.taskUid ? task.taskUid : null };
}

module.exports = { postToDoc, indexBlogPosts };
