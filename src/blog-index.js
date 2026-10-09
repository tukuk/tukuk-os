const crypto = require('crypto');
const store = require('./store');

/**
 * Indekskan kandungan blog (store.posts) ke dalam korpus carian utama.
 *
 * Masalah: `scripts/import-posts.js` + `store.syncPostsFromContent()` memuatkan
 * content/blog/*.md ke dalam STORE (dihidangkan di /blog), tetapi TIDAK ada yang
 * menolaknya ke Meilisearch. `/search` dan grounding `/ask` hanya membaca
 * `halaman_web` (korpus berita crawl). Akibatnya panduan/blog kurasi — 'bm25',
 * 'cloudflare' — pulang 0 hits.
 *
 * Modul ini menjembatani jurang itu: tukar setiap post store kepada dokumen
 * berskema sama dengan `_populateInitialDocs` (meili.js), lalu updateDocuments
 * ke index utama. id deterministik (sha256(slug)) → idempotent; jalan berkali-kali
 * tak hasilkan duplikat.
 */

// Skema dokumen blog — sepadan dengan artikel seed di meili.js `_populateInitialDocs`.
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
 * Tolak semua post store ke index utama.
 * @param {object} index  Index Meilisearch (hybrid real+mock) daripada ensureIndex().
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
    logger.log(`[blog-index] ${docs.length} post blog dihantar ke indeks utama (task ${task && task.taskUid ? task.taskUid : 'mock'})`);
  }
  return { count: docs.length, taskUid: task && task.taskUid ? task.taskUid : null };
}

module.exports = { postToDoc, indexBlogPosts };
