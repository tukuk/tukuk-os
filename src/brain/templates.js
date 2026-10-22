'use strict';
/**
 * Tukuk Templates — a library of standalone HTML templates (1 prompt → ready to run).
 *
 * 49 PROVEN single-file games/apps: 44 recovered from git history
 * (the pivot commit `b0542e7` dropped them from public/apps) + 5 new canvas 3D games
 * (fps/racer/soccer/flight/basket). They are stored as INTERNAL assets in
 * `templates/` — NOT public/apps, so they do NOT appear in /store,
 * /sitemap.xml or the public nav (the AdSense pivot decision stands). Only examples
 * PUBLISHED to /a/<slug> are publicly reachable.
 *
 * PURE functions (detect/sanitize/personalize/extractHtml) can be unit-tested without
 * I/O; only `get()` touches disk (with an mtime cache). No network /
 * arbitrary code here.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// Theme tokens (matching public/theme.css dark) — injected after sanitisation so
// the 44/45 templates using var(--accent/--bg/...) keep their colours under the CSP
// sandbox at /a/<slug> (default-src 'none'; theme.css & theme.js are stripped).
const THEME_STYLE = '<style id="tk-theme">:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;'
  + '--text:#e6e9ef;--muted:#9aa3b2;--accent:#4c8dff;--accent-fill:#2a6edb;'
  + '--accent-glow:rgba(76,141,255,0.2);--mark:#ffd54a;--card:#181d2a;--code-bg:#12151c;'
  + '--gold:#ffd54a;--danger:#ff5555;--success:#4cd964;color-scheme:dark;}</style>';

// Registry: key = the file name inside templates/ (without .html). map EXCEPT (external Leaflet CDN
// → blocked by the sandbox CSP). hints = ms/en for detection (lowercase).
const REGISTRY = [
  // ── Apps / tools ──
  { key: 'notes', kind: 'app', genre: null, title: 'Notes', ic: '📝', hints: 'notes nota catat menulis text pad sticky memo' },
  { key: 'calc', kind: 'app', genre: null, title: 'Calculator', ic: '🧮', hints: 'calculator kira kalkulator math arithmetic numeric' },
  { key: 'todo', kind: 'app', genre: null, title: 'To-Do', ic: '✅', hints: 'todo task list senarai kerja tugas checklist' },
  { key: 'convert', kind: 'app', genre: null, title: 'Unit Converter', ic: '📐', hints: 'convert unit tukar united temperature length measure konversi' },
  { key: 'timer', kind: 'app', genre: null, title: 'Timer & Pomodoro', ic: '⏱️', hints: 'timer stopwatch pomodoro masa countdown tempoh jam' },
  { key: 'color', kind: 'app', genre: null, title: 'Color Picker', ic: '🎨', hints: 'color colour picker hex rgb palet warna contrast' },
  { key: 'password', kind: 'app', genre: null, title: 'Password Generator', ic: '🔐', hints: 'password generator kata laluan random randomize acak' },
  { key: 'text', kind: 'app', genre: null, title: 'Text Tools', ic: '🔡', hints: 'text tools word count case base64 uppercase huruf' },
  { key: 'linux', kind: 'app', genre: null, title: 'Linux Utils', ic: '🐧', hints: 'linux terminal shell command tools hash uuid chmod' },
  { key: 'netsec', kind: 'app', genre: null, title: 'Cyber Security', ic: '🛡️', hints: 'cyber security encryption hash ip whois dns osint phishing' },
  { key: 'pixel', kind: 'app', genre: null, title: 'Pixel Studio', ic: '🟩', hints: 'pixel art draw sprite lukis gambar studio' },
  { key: 'piano', kind: 'app', genre: null, title: 'Synth Piano', ic: '🎹', hints: 'piano keyboard music synth nota muzik playing' },
  { key: 'spiro', kind: 'app', genre: null, title: 'Spiro Mandala', ic: '🌀', hints: 'spiro spirograph mandala art spiral seni lukisan' },
  { key: 'orbit', kind: 'app', genre: null, title: 'Orbit Simulator', ic: '🪐', hints: 'orbit gravity planet space physics angkasa simulasi' },
  { key: 'fractal', kind: 'app', genre: null, title: 'Fractal Explorer', ic: '🔮', hints: 'fractal mandelbrot zoom math seni korok' },
  { key: 'drum', kind: 'app', genre: null, title: 'Rhythm Machine', ic: '🥁', hints: 'drum rhythm beat machine muzik rentak ketukan' },
  { key: 'bmi', kind: 'app', genre: null, title: 'BMI Check', ic: '⚖️', hints: 'bmi weight health index berat badan jisim' },
  { key: 'calendar', kind: 'app', genre: null, title: 'Calendar', ic: '📅', hints: 'calendar kalendar tarikh date month bulan' },
  { key: 'dice', kind: 'app', genre: null, title: 'Dice & Coin', ic: '🪙', hints: 'dice coin dadu syiling random flip undi' },
  { key: 'tip', kind: 'app', genre: null, title: 'Tip Split', ic: '💵', hints: 'tip split bill restaurant bil makan caj' }
];

const BY_KEY = new Map(REGISTRY.map((r) => [r.key, r]));

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Drop every external reference (the sandbox CSP would block it) + inject the theme tokens so
// var(--...) stays resolved. Returns self-contained HTML.
function sanitize(raw) {
  let out = String(raw || '');
  out = out.replace(/<script[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>\s*<\/script>/gi, ''); // <script src=...></script>
  out = out.replace(/<link\b[^>]*>/gi, '');    // all <link ...> (theme.css, canonical, icon, manifest)
  out = out.replace(/<base\b[^>]*>/gi, '');
  if (!/^\s*<!DOCTYPE/i.test(out)) out = '<!DOCTYPE html>\n' + out;
  // Remove an old token if present, then inject exactly once after <head>.
  out = out.replace(/<style id="tk-theme">[\s\S]*?<\/style>/gi, '');
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + THEME_STYLE);
  else out = THEME_STYLE + out;
  return out;
}

// Cache the sanitize result per file mtime so get() doesn't hit the disk on every call.
const cache = new Map(); // key → { mtime, html }
function get(key) {
  const meta = BY_KEY.get(String(key || ''));
  if (!meta) return null;
  const file = path.join(TEMPLATES_DIR, `${meta.key}.html`);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const hit = cache.get(meta.key);
  if (hit && hit.mtime === mtime) return hit.html;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const html = sanitize(raw);
  cache.set(meta.key, { mtime, html });
  return html;
}

// Match a free-text description → the best template (ms/en). Score = how many hints
// appear as FULL WORDS (not a substring inside another word — avoids
// "berbilang"→"bil"→tip). Loose prefixes (≥4 chars) cover singular/plural. Ties
// → a deterministic hash. null when no match is strong enough (score < 1).
function h32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function detect(goal) {
  const q = String(goal || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
  if (!q) return null;
  const words = q.split(/\s+/).filter(Boolean);
  const wset = new Set(words);
  let best = null, bestScore = 0;
  const leaders = [];
  for (const r of REGISTRY) {
    const hints = r.hints.split(/\s+/);
    let score = 0;
    for (const h of hints) {
      if (!h) continue;
      if (wset.has(h)) { score++; continue; } // full-word match
      if (h.length >= 4) { // loose prefix: "weathers"↔"weather", plurals
        for (const w of words) { if (w.length >= 4 && (w.startsWith(h) || h.startsWith(w))) { score += 0.5; break; } }
      }
    }
    if (score > bestScore) { bestScore = score; best = r; leaders.length = 0; leaders.push(r); }
    else if (score === bestScore && score > 0) leaders.push(r);
  }
  if (!best || bestScore < 1) return null;
  const chosen = leaders.length > 1 ? leaders[h32(q) % leaders.length] : best;
  return { key: chosen.key, kind: chosen.kind, genre: chosen.genre, title: chosen.title, ic: chosen.ic, score: bestScore };
}

// Pick the closest template as a fallback (no keyword match): rotate
// by a hash of the idea so the output stays stable & varied. `kindFilter` ('game'|'app'|'') .
function nearest(goal, kindFilter) {
  const pool = kindFilter ? REGISTRY.filter((r) => r.kind === kindFilter) : REGISTRY;
  if (!pool.length) return null;
  const r = pool[h32(String(goal || '') + (kindFilter || '')) % pool.length];
  return { key: r.key, kind: r.kind, genre: r.genre, title: r.title, ic: r.ic };
}

// Site branding: title + <h1> + accent. Conservative — only touches <title>, the first h1
// & adds a --accent override; the game structure is left alone.
function personalize(html, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  let out = String(html || '');
  const name = String(o.name || '').trim().slice(0, 40);
  if (name) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(name) + '</title>');
    out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '<h1>' + esc(name) + '</h1>');
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(o.accent || '').trim())) {
    const a = String(o.accent).trim();
    out = out.replace(/<\/head>/i, '<style>:root{--accent:' + a + ';}</style></head>');
  }
  return out;
}

// A short listing for the gallery/API (no HTML).
function list() {
  return REGISTRY.map((r) => ({ key: r.key, kind: r.kind, genre: r.genre, title: r.title, ic: r.ic }));
}

// Extract the full HTML document from model text (a ``` fence or <!DOCTYPE…</html>).
function extractHtml(text) {
  let s = String(text || '');
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const lower = s.toLowerCase();
  let start = lower.indexOf('<!doctype');
  if (start < 0) start = lower.indexOf('<html');
  if (start < 0) return null;
  const end = lower.lastIndexOf('</html>');
  const doc = end >= 0 ? s.slice(start, end + 7) : s.slice(start);
  return /<\s*(html|body|div|canvas|script|style)/i.test(doc) ? doc : null;
}

// The system prompt for the LLM branch: one complete HTML file, no external resources.
const LLM_SYS = [
  'You are an expert single-file web app/game generator. Reply with ONLY one complete HTML document, no prose before or after.',
  'The document MUST be fully self-contained: all CSS and JavaScript inline. NEVER reference any external resource (no http/https URLs, no <script src>, no <link rel=stylesheet>, no CDN, no fonts). It must run offline inside a strict sandbox.',
  'Always include: <!DOCTYPE html>, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, and a <title>. Use a clean dark UI (background #0f1115, text #e6e9ef, accent #4c8dff).',
  'Implement the user idea as a genuinely WORKING, playable or usable page with clear controls and on-screen feedback. Prefer canvas or DOM interaction. Add a way to restart/reset.',
  'Keep it focused and under about 320 lines. No explanatory comments inside the file. Reply ONLY with the HTML starting at <!DOCTYPE html>.'
].join(' ');

module.exports = { TEMPLATES_DIR, REGISTRY, THEME_STYLE, sanitize, get, detect, nearest, personalize, list, extractHtml, LLM_SYS, esc };
