'use strict';

/**
 * Query & hit safety gate — the single choke point for /search, /suggest and /ask.
 *
 * Why this exists: the production query log for the week of 2026-10-23 recorded
 * a search for "laura b candydoll" (CandyDoll is a known child-sexual-abuse-
 * material brand) that returned 29 hits from the scraped index. Serving results
 * for that class of query is criminal exposure in most jurisdictions and
 * indefensible in all of them, so two rules now hold:
 *
 *   1. A query made only of high-signal abuse terms is answered with an empty
 *      result set — no index call, no model call, no echo of the term.
 *   2. Every result list is re-filtered before it leaves the server, so a
 *      document whose title/URL matches those terms cannot surface through
 *      any other query either.
 *
 * The list is deliberately short: only terms with no legitimate use here.
 * Blocking ordinary vocabulary ("cp", "loli", "pedo") would break real research
 * queries and give a false sense of coverage — this is a legal backstop, not a
 * substitute for moderation of the index itself. Logging is redacted on purpose:
 * the server records that a query was blocked, never the query.
 */

const TERMS = [
  'candydoll',
  'jailbait',
  'lolicon',
  'shotacon',
  'child porn',
  'childporn'
];

/** Lowercase, strip punctuation, collapse spaces — one shape for phrase matching. */
function normalize(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when the query contains one of the abuse terms above (any position). */
function blockedQuery(query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return false;
  const joined = ` ${words.join(' ')} `;
  return TERMS.some((term) => joined.includes(` ${term} `));
}

/** True when a document's title or URL points at the same class of content. */
function blockedHit(hit) {
  if (!hit) return false;
  const haystack = ` ${normalize(hit.title)} ${normalize(hit.url || hit.slug || '')} `;
  return TERMS.some((term) => haystack.includes(` ${term} `));
}

/** Drop blocked documents from a hit list (defence in depth for the API surfaces). */
function filterHits(hits) {
  if (!Array.isArray(hits)) return hits;
  return hits.filter((hit) => !blockedHit(hit));
}

module.exports = { blockedQuery, blockedHit, filterHits, TERMS };
