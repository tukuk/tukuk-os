#!/usr/bin/env node
/**
 * One-shot migration script that flips the bundled articles from their original Malay
 * slugs to the English slugs used today. Kept in the repo (rather than deleted after
 * the Oct 2026 translation pass) so a fresh clone / restored backup can re-apply the
 * migration deterministically.
 *
 * For every article we look up the old slug first, fall back to the new slug, and then
 * patch title/slug/excerpt/content/tags in place. A hard-coded `LEGACY_SLUGS` list at
 * the bottom handles articles that were translated without an `oldSlug` field.
 *
 * The final sweep reports any post still containing more than 5 common Malay stopword
 * hits so the operator can inspect leftovers manually. Never deletes anything — the
 * store only grows and re-homes.
 */
const store = require('./store');

const FILES = ['journey-a', 'journey-b', 'tukuk-a', 'tukuk-b', 'extra'];

// Legacy Malay → English slug pairs for articles that pre-date the `oldSlug` field.
// Also mirrored by `src/blog-redirects.js` at request time so 301s keep working even
// after this script has been run once.
const LEGACY_SLUGS = {
  'seo-on-page-menulis-kandungan-yang-disenangi-google': 'seo-on-page-content-google-loves',
  'redis-cache-pantas-untuk-aplikasi-web': 'redis-cache-for-fast-web-apps',
  'privasi-dalam-ai-lokal-tiada-data-hantar-ke-awan': 'local-ai-privacy-no-data-to-cloud',
  'panduan-nginx-reverse-proxy-dengan-cloudflare': 'nginx-reverse-proxy-cloudflare-guide',
  'inverted-index-struktur-data-di-sebalik-carian': 'inverted-index-behind-search',
  'http2-dan-http3-quic-panduan-ringkas': 'http2-and-http3-quic-brief-guide',
  'cloudflare-workers-serverless-di-edge': 'cloudflare-workers-serverless-at-edge',
  'cara-crawler-mengumpul-dokumen-untuk-indeks': 'how-crawlers-collect-documents-for-indexing',
  'analitik-web-tanpa-cookie-alternatif-google-analytics': 'cookieless-web-analytics-ga-alternatives',
  'kedaulatan-data-infrastruktur-carian-bebas': 'data-sovereignty-free-search-infrastructure',
  'optimasi-laman-web-seo-asas-dan-teknikal': 'web-optimization-basic-and-technical-seo',
  'memahami-pwa-progressive-web-app': 'understanding-progressive-web-apps',
  'panduan-keselamatan-siber-melindungi-privasi': 'cybersecurity-guide-protecting-your-privacy',
  'masa-depan-ai-enjin-carian-semantik-rag': 'future-of-ai-semantic-search-and-rag',
  'mengenal-meilisearch-enjin-carian-pantas': 'getting-to-know-meilisearch-fast-search-engine',
  'privasi-digital-carian-web-bebas': 'digital-privacy-and-free-web-search',
  'bagaimana-enjin-carian-moden-berfungsi': 'how-modern-search-engines-work',
  'membangun-backup-system-dengan-cloudflare': 'building-a-backup-system-with-cloudflare',
  'panduan-meilisearch-untuk-pemula': 'meilisearch-beginners-guide',
  'cara-tukuk-os-menjadi-enjin-carian-web-bebas': 'how-tukuk-os-became-a-free-web-search-engine'
};

/** Apply the migration: patch every post from the article modules, then handle legacy slugs. */
function run() {
  store.load();
  let updated = 0;
  const missing = [];

  for (const file of FILES) {
    for (const item of require(`./articles/${file}`)) {
      const post = store.getPostBySlug(item.oldSlug) || store.getPostBySlug(item.slug);
      if (!post) {
        missing.push(item.oldSlug || item.slug);
        continue;
      }
      store.updatePost(post.id, {
        title: item.title,
        slug: item.slug,
        excerpt: item.excerpt,
        content: item.content,
        tags: item.tags,
        updatedAt: new Date().toISOString()
      });
      updated += 1;
    }
  }

  for (const [oldSlug, newSlug] of Object.entries(LEGACY_SLUGS)) {
    const post = store.getPostBySlug(oldSlug) || store.getPostBySlug(newSlug);
    if (!post) {
      missing.push(oldSlug);
      continue;
    }
    if (post.slug !== newSlug) {
      store.updatePost(post.id, { slug: newSlug, updatedAt: new Date().toISOString() });
      updated += 1;
    }
  }

  console.log(`[to-english] updated: ${updated}`);
  if (missing.length) console.log('[to-english] MISSING from the store:', missing.join(', '));
  console.log(`[to-english] total articles: ${store.getAllPosts(500).length}`);

  const malay = /\b(yang|untuk|dengan|tidak|daripada|kepada|ialah|sebagai|boleh|saya|anda)\b/i;
  let suspect = 0;
  for (const p of store.getAllPosts(500)) {
    const hits = (p.content.match(/\b(yang|dan|untuk|dengan|tidak|saya|anda|kepada|daripada|ialah|adalah|sebagai|boleh|telah|akan|serta|bagi|hanya|antara|kerana|masih|kini|segala|setiap|apabila|sebelum|selepas|membuat|menjadi|perlu|patut|seperti)\b/gi) || []).length;
    if (hits > 5) {
      suspect += 1;
      console.log('  STILL MALAY?:', p.slug, hits);
    }
  }
  console.log(`[to-english] suspicious Malay-language articles: ${suspect}`);
}

run();
process.exit(0);
