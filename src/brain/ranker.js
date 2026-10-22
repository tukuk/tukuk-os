/**
 * Optional PageRank-style authority boost for indexed documents.
 *
 * Runs a tiny iterative link-graph pass (only `ITERATIONS` rounds) over the current
 * corpus so documents that are referenced by many other indexed pages get a small
 * ranking bump on top of Meilisearch's BM25 score. The idea is deliberately modest:
 * this is a coarse authority signal, not a replacement for the neural reranker.
 *
 * Currently a helper module — /search applies it only when the crawler has actually
 * populated `doc.links` in the index; otherwise the graph is empty and every score
 * collapses back to a uniform baseline (safe no-op).
 */
const config = require('../config');

// Simple PageRank-like scoring based on link popularity
const scores = new Map();
const DAMPING = 0.85;      // classic Brin-Page damping factor
const ITERATIONS = 3;      // a few passes are enough for a stable order on a small corpus

/**
 * Compute PageRank over the given document set and cache the result in `scores`.
 * Only intra-corpus links count (a link to a URL that isn't in the corpus is ignored).
 * @param {Array<{url: string, links?: string[]}>} documents
 */
function computePageRank(documents) {
  const urls = documents.map(d => d.url);
  const outgoing = new Map();
  const incoming = new Map();

  // Initialize
  for (const url of urls) {
    outgoing.set(url, []);
    incoming.set(url, []);
    scores.set(url, 1 / urls.length);
  }

  // Build link graph
  for (const doc of documents) {
    const from = doc.url;
    for (const link of (doc.links || [])) {
      if (urls.includes(link)) {
        outgoing.get(from).push(link);
        incoming.get(link).push(from);
      }
    }
  }

  // Iterate PageRank
  for (let i = 0; i < ITERATIONS; i++) {
    const newScores = new Map();
    for (const url of urls) {
      let rank = (1 - DAMPING) / urls.length;
      for (const inLink of incoming.get(url)) {
        rank += DAMPING * scores.get(inLink) / outgoing.get(inLink).length;
      }
      newScores.set(url, rank);
    }
    for (const [url, score] of newScores) {
      scores.set(url, score);
    }
  }
}

/** Look up the cached PageRank for a URL (0 when the URL is not in the graph). */
function getPageRank(url) {
  return scores.get(url) || 0;
}

/** Convenience wrapper: recompute over the whole set and return copies with `pageRank` attached. */
function enrichDocuments(documents) {
  computePageRank(documents);
  return documents.map(doc => ({
    ...doc,
    pageRank: getPageRank(doc.url)
  }));
}

module.exports = { computePageRank, getPageRank, enrichDocuments };
