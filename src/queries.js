/**
 * Search-query log and derived analytics.
 *
 * Every /search and /ask hit is appended to a JSONL file under `data/search-queries.jsonl`
 * and mirrored into a bounded in-memory ring so the trending/related/did-you-mean widgets
 * never have to re-read the file at request time. File grows are capped by size (2 MB) —
 * when the threshold is crossed the file is renamed to `.old` and a fresh log starts.
 *
 * Time window: only the last 7 days are considered "live". Older records stay on disk
 * (cheap history) but are excluded from every aggregation so seasonal spikes decay naturally.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'search-queries.jsonl');
const MAX_BYTES = 2 * 1024 * 1024;         // rotate the JSONL file once it crosses 2 MB
const MEM_MAX = 3000;                       // in-memory ring buffer cap
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;  // rolling 7-day analytics window

// Common English stopwords — used by `related()` to avoid matching every query to every
// other query through high-frequency words like "the"/"what"/"how".
const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'from', 'are',
  'was', 'were', 'how', 'why', 'what', 'when', 'who', 'where', 'does', 'did',
  'can', 'could', 'would', 'should', 'will', 'not', 'but', 'his', 'her', 'its'
]);

/** Live in-memory view of recent queries (loaded at boot, extended at runtime). */
let mem = [];

/**
 * Trim and normalise a raw query string so it can be compared / grouped consistently.
 * Lowercases, collapses whitespace, caps length at 200 chars to keep the log bounded.
 * @param {unknown} q
 * @returns {string}
 */
function normalize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Read the tail of the JSONL log and warm the in-memory ring.
 * Reads the last 2 MB when the file exceeds 8 MB — enough history for trending,
 * without loading megabytes of stale lines on every cold start.
 * @returns {number} count of records loaded into memory
 */
function loadRecent() {
  try {
    if (!fs.existsSync(FILE)) return 0;
    const st = fs.statSync(FILE);
    let text;
    if (st.size <= 8 * 1024 * 1024) {
      text = fs.readFileSync(FILE, 'utf8');
    } else {
      const len = Math.min(st.size, 2 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(FILE, 'r');
      try {
        fs.readSync(fd, buf, 0, len, st.size - len);
      } finally {
        fs.closeSync(fd);
      }
      text = buf.toString('utf8');
    }
    const cutoff = Date.now() - WINDOW_MS;
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.q === 'string' && rec.t >= cutoff) out.push(rec);
      } catch {
        // Malformed JSON line (partial write after a crash) — skip silently. The file is
        // append-only, so any damaged tail is eventually rotated away by the size cap.
      }
    }
    mem = out.slice(-MEM_MAX);
    return mem.length;
  } catch {
    return 0;
  }
}

/**
 * Append one query to the ring buffer and to the on-disk JSONL log.
 * Rotate the file (rename to `.old`) whenever it exceeds MAX_BYTES so it never grows
 * unbounded. Write failures are swallowed — analytics must never block a live search.
 * @param {string} query
 * @param {{hits?: number}} [meta]
 */
function logQuery(query, { hits = 0 } = {}) {
  const q = normalize(query);
  if (!q) return;
  const rec = { t: Date.now(), q, hits };
  mem.push(rec);
  if (mem.length > MEM_MAX) mem.shift();
  fs.appendFile(FILE, `${JSON.stringify(rec)}\n`, (err) => {
    if (err) return;
    fs.stat(FILE, (e, st) => {
      if (!e && st.size > MAX_BYTES) fs.rename(FILE, `${FILE}.old`, () => {});
    });
  });
}

/**
 * All in-memory records that fall inside the rolling 7-day window.
 * @returns {Array<{t: number, q: string, hits: number}>}
 */
function recent() {
  const cutoff = Date.now() - WINDOW_MS;
  return mem.filter((r) => r.t >= cutoff);
}

/**
 * Most-repeated queries inside the window, tie-broken by recency.
 * Only counts >= 2 are surfaced so a single user asking once does not create a "trend".
 * @param {{limit?: number}} [opts]
 * @returns {Array<{q: string, count: number, last: number}>}
 */
function trending({ limit = 10 } = {}) {
  const counts = new Map();
  for (const r of recent()) {
    if (r.q.length < 2) continue;
    const e = counts.get(r.q) || { q: r.q, count: 0, last: 0 };
    e.count += 1;
    if (r.t > e.last) e.last = r.t;
    counts.set(r.q, e);
  }
  return [...counts.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit);
}

/**
 * Queries that co-occur with the current one, scored by token overlap × frequency.
 * Stopwords and 1–2 char tokens are skipped so the ranking reflects meaningful content.
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {string[]} candidate related queries, best first
 */
function related(query, { limit = 5 } = {}) {
  const cur = normalize(query);
  if (!cur) return [];
  const curTokens = new Set(
    cur.split(' ').filter((t) => t.length >= 3 && !STOP.has(t))
  );
  if (curTokens.size === 0) return [];
  const scores = new Map();
  for (const r of recent()) {
    if (r.q === cur) continue;
    const overlap = r.q.split(' ').filter((t) => curTokens.has(t)).length;
    if (overlap === 0) continue;
    const e = scores.get(r.q) || { q: r.q, count: 0, score: 0 };
    e.count += 1;
    e.score = e.count * overlap;
    scores.set(r.q, e);
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit)
    .map((e) => e.q);
}

/**
 * Iterative Levenshtein distance with a single rolling row (O(n·m) time, O(min(n,m)) memory).
 * Used by `didYouMean` to find the closest high-frequency query within a small edit distance.
 * @param {string} a @param {string} b @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Spelling-correction suggestion: pick the most frequent in-window query that lies within
 * a length-scaled edit distance. Short queries get a stricter threshold so random noise
 * like "abc" → "abd" is not offered as a correction.
 * @param {string} query @returns {string|null}
 */
function didYouMean(query) {
  const cur = normalize(query);
  if (cur.length < 4) return null;
  const pool = new Map();
  for (const r of recent()) {
    if (r.q === cur || r.q.length < 3) continue;
    pool.set(r.q, (pool.get(r.q) || 0) + 1);
  }
  const maxD = cur.length <= 6 ? 1 : cur.length <= 12 ? 2 : 3;
  let best = null;
  for (const [cand, count] of pool.entries()) {
    if (Math.abs(cand.length - cur.length) > maxD) continue;
    const d = levenshtein(cur, cand);
    if (d === 0 || d > maxD) continue;
    if (!best || d < best.d || (d === best.d && count > best.count)) {
      best = { q: cand, d, count };
    }
  }
  return best ? best.q : null;
}

/**
 * Diagnostic snapshot for /dev — how much history is in memory, where it lives on disk,
 * and the length of the rolling window.
 * @returns {{entries: number, file: string, windowDays: number}}
 */
function stats() {
  return { entries: mem.length, file: FILE, windowDays: WINDOW_MS / 86400000 };
}

module.exports = { logQuery, loadRecent, trending, related, didYouMean, stats };
