/**
 * Shared helpers: URL/ID hashing, entity decoding, HTML escaping, and the SSRF guard
 * every crawler call must go through.
 *
 * The most important function here is `assertPublicUrl` — it refuses non-http(s)
 * protocols, blocks hostnames that resolve to any private/loopback/link-local/multicast
 * range, and rejects `localhost` / `*.local` / `*.internal` names. Every crawl /
 * builder / agent fetch depends on it; without it a misbehaving seed could turn the
 * server into an internal-network scanner.
 *
 * `normalizeUrl` strips tracking query params (utm_*, fbclid, gclid, msclkid, ref, _ga)
 * and trailing slashes so hash-based dedupe stays stable across variants of the same
 * article. `documentId` derives a deterministic short SHA-256 id from the normalised URL
 * so re-crawling the same document does not create duplicate index entries.
 */
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

// IPv4 ranges that must never be reachable from a crawler request (RFC 1918 + CGN +
// loopback + link-local + multicast + reserved). Paired with an equivalent set of
// IPv6 checks inside `isPrivateAddress`.
const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

/** CIDR-membership test for IPv4 (bitwise compare, no external dependency). */
function v4InRange(ip, cidr, bits) {
  const toLong = (value) => value.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toLong(ip) & mask) === (toLong(cidr) & mask);
}

/** True for any loopback / private / link-local / multicast / reserved address. */
function isPrivateAddress(ip) {
  if (!net.isIP(ip)) return true;
  if (net.isIPv4(ip)) return BLOCKED_V4.some(([cidr, bits]) => v4InRange(ip, cidr, bits));
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

/**
 * SSRF guard: throw a `{statusCode:400}` Error unless the URL is http(s) and does not
 * resolve to a private address. Pass `{allowPrivate: true}` from trusted internal tools
 * (e.g. the /dev previewer reaching localhost); every externally-driven path must keep
 * the guard on.
 */
async function assertPublicUrl(rawUrl, { allowPrivate = false } = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https protocols are allowed'), { statusCode: 400 });
  }
  if (!url.hostname) {
    throw Object.assign(new Error('Invalid URL'), { statusCode: 400 });
  }

  if (allowPrivate) return url;

  if (net.isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw Object.assign(new Error('Internal network addresses are not allowed'), { statusCode: 400 });
    }
    return url;
  }

  if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) {
    throw Object.assign(new Error('Internal host names are not allowed'), { statusCode: 400 });
  }

  let records;
  try {
    records = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw Object.assign(new Error(`Could not resolve host name: ${url.hostname}`), { statusCode: 400 });
  }
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw Object.assign(new Error('Host name resolves to an internal address'), { statusCode: 400 });
  }
  return url;
}

/** Canonicalise a URL for hashing: drop hash, strip tracking params, sort query, trim slash. */
function normalizeUrl(raw, base) {
  const url = new URL(raw, base);
  url.hash = '';
  for (const param of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|msclkid|ref|_ga)/i.test(param)) url.searchParams.delete(param);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

/** Same-site check ignoring the `www.` prefix (used by crawler BFS to stay on one host). */
function sameSite(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const strip = (host) => host.replace(/^www\./, '');
    return strip(ua.hostname) === strip(ub.hostname);
  } catch {
    return false;
  }
}

/** Deterministic short id derived from a normalised URL — primary key for the index. */
function documentId(url) {
  const normalized = String(url).replace(/\/+$/, '').toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `u_${hash.slice(0, 24)}`;
}

/** SHA-1 of the given string — used as a cheap content-change detector. */
function contentHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

/** Truncate a string at the last whole word before `limit`, appending an ellipsis. */
function truncate(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

/** Decode the HTML/XML entities that leak through provider snippets. */
function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Serialise an error for the client without leaking stack / internal messages. */
function safeError(error) {
  if (!error) return 'Unknown error';
  const status = error.statusCode || error.status || error.response?.status;
  return {
    message: error.message || 'Unknown error',
    ...(status ? { status } : {})
  };
}

/** Escape a literal string for embedding inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escape HTML characters so user content (title/author/excerpt)
// cannot inject scripts (XSS) into templates.
//
// NOT IDEMPOTENT: `'` → `&#39;` → `&amp;#39;` on a second pass, and the browser then
// prints the entity as text. Escape each string exactly ONCE, at the point it enters the
// markup — never in a builder that hands the value to a template which escapes again. That
// is why the page shells (`*Doc` in server.js) are the single authority for `heroTitle`/
// `heroSub`: builders pass plain text, and markup belongs in `heroHtml`. Guarded by
// test/hero-escaping.test.js.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  assertPublicUrl,
  isPrivateAddress,
  normalizeUrl,
  sameSite,
  documentId,
  contentHash,
  truncate,
  decodeEntities,
  safeError,
  escapeHtml
};