'use strict';
/**
 * Tukuk Templates — perpustakaan templat HTML standalone (1 prompt → terus siap).
 *
 * 49 game/aplikasi single-file yang TERBUKTI: 44 dipulihkan daripada sejarah git
 * (commit pivot `b0542e7` membuangnya dari public/apps) + 5 game 3D canvas baru
 * (fps/racer/soccer/flight/basket). Disimpan sebagai ASET
 * DALAMAN di `templates/` — BUKAN public/apps, jadi ia TIDAK muncul di /store,
 * /sitemap.xml atau nav awam (keputusan pivot AdSense dikekalkan). Hanya contoh
 * yang DIENERBITKAN ke /a/<slug> boleh diakses umum.
 *
 * Fungsi MURNI (detect/sanitize/personalize/extractHtml) boleh diuji unit tanpa
 * I/O; `get()` sahaja yang baca cakera (dengan cache mtime). Tiada rangkaian /
 * arbitrary code di sini.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// Token tema (padan public/theme.css dark) — disuntik selepas sanitasi supaya
// 44/45 templat yang memakai var(--accent/--bg/...) kekal berwarna dalam CSP
// sandbox /a/<slug> (default-src 'none'; theme.css & theme.js dibuang).
const THEME_STYLE = '<style id="tk-theme">:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;'
  + '--text:#e6e9ef;--muted:#9aa3b2;--accent:#4c8dff;--accent-fill:#2a6edb;'
  + '--accent-glow:rgba(76,141,255,0.2);--mark:#ffd54a;--card:#181d2a;--code-bg:#12151c;'
  + '--gold:#ffd54a;--danger:#ff5555;--success:#4cd964;color-scheme:dark;}</style>';

// Registry: key = nama fail dalam templates/ (tanpa .html). map KECUALI (Leaflet CDN
// luar → disekat CSP sandbox). hints = ms/en untuk pengesanan (lowercase).
const REGISTRY = [
  // ── Game ──
  { key: 'tictactoe', kind: 'game', genre: 'board', title: 'Tic-Tac-Toe', ic: '❎', hints: 'tic tac toe tictactoe xoxo tiga salib kosong board' },
  { key: 'number2048', kind: 'game', genre: 'teki-teki', title: '2048', ic: '🧊', hints: '2048 tile tiles geser gabung merge sliding nombor' },
  { key: 'snake', kind: 'game', genre: 'arkad', title: 'Snake', ic: '🐍', hints: 'snake ular ulat makan tumbuh grow eat nokia' },
  { key: 'memory', kind: 'game', genre: 'teki-teki', title: 'Memory Match', ic: '🧠', hints: 'memory match padan padanan kad kartu ingat pair emoji flip' },
  { key: 'whack', kind: 'game', genre: 'refleks', title: 'Whack-a-Mole', ic: '🔨', hints: 'whack mole tikus tanah pukul tampar refleks hammered' },
  { key: 'breakout', kind: 'game', genre: 'arkad', title: 'Breakout', ic: '🧱', hints: 'breakout brick block peluru bola paddle pecah' },
  { key: 'invaders', kind: 'game', genre: 'penembakan', title: 'Space Invaders', ic: '👾', hints: 'invader alien space shooter angkasa lepas tembak extraterrestrial' },
  { key: 'pong', kind: 'game', genre: 'arkad', title: 'Pong', ic: '🏓', hints: 'pong paddle tennis table bola reget' },
  { key: 'flappy', kind: 'game', genre: 'refleks', title: 'Flappy Dash', ic: '🐦', hints: 'flappy bird pipes terbang burung sayap one tap' },
  { key: 'candy', kind: 'game', genre: 'teki-teki', title: 'Candy Blast', ic: '🍬', hints: 'candy sweets match 3 blast permen gula saga' },
  { key: 'subway', kind: 'game', genre: 'arkad', title: 'Subway Dash 3D', ic: '🚇', hints: 'subway surf runner dash lari train kereta bawah tanah endless 3d' },
  { key: 'slice', kind: 'game', genre: 'refleks', title: 'Fruit Slice', ic: '🍉', hints: 'slice fruit ninja buah potong irisan bomb' },
  { key: 'roadhop', kind: 'game', genre: 'santai', title: 'Road Hop', ic: '🐸', hints: 'road hop frog kodok cross traffic lintar lompat kata' },
  { key: 'bubble', kind: 'game', genre: 'teki-teki', title: 'Bubble Pop', ic: '🫧', hints: 'bubble shooter gelembung tembak warna pop' },
  { key: 'ludo', kind: 'game', genre: 'board', title: 'Ludo', ic: '🎲', hints: 'ludo board dadu dice empat player' },
  { key: 'solitaire', kind: 'game', genre: 'cards', title: 'Solitaire', ic: '🃏', hints: 'solitaire card kad klondike patience' },
  { key: 'blockdrop', kind: 'game', genre: 'teki-teki', title: 'Block Drop', ic: '🧩', hints: 'block drop tetris blok jatuh falling susun' },
  { key: 'mines', kind: 'game', genre: 'teki-teki', title: 'Minesweeper', ic: '💣', hints: 'minesweeper mines ranjau flag bendera kotak' },
  { key: 'connect4', kind: 'game', genre: 'board', title: 'Connect Four', ic: '🔴', hints: 'connect four quattro discs cakera empat baris' },
  { key: 'doodle', kind: 'game', genre: 'refleks', title: 'Doodle Jump', ic: '🦘', hints: 'doodle jump platform lompat memanjat spring' },
  { key: 'stack', kind: 'game', genre: 'santai', title: 'Stack Tower', ic: '🗼', hints: 'stack tower menara susun drop timba' },
  { key: 'simon', kind: 'game', genre: 'teki-teki', title: 'Simon Tones', ic: '🎼', hints: 'simon tones sequence warna ingatan echo' },
  { key: 'muncher', kind: 'game', genre: 'arkad', title: 'Maze Muncher', ic: '🟡', hints: 'pac man pacman maze ghost hantu labirin munch' },
  { key: 'puzzle15', kind: 'game', genre: 'teki-teki', title: 'Slide 15', ic: '🔢', hints: 'slide 15 fifteen sliding number puzzle nombor' },
  // ── Game 3D (self-contained canvas/WebGL-free — jalan dalam CSP sandbox) ──
  { key: 'fps3d', kind: 'game', genre: '3d', title: 'FPS Strike 3D', ic: '🔫', hints: 'fps counter strike shooting shooter tembak first person askar perang soldier gun senjata rifle zombie 3d' },
  { key: 'racer3d', kind: 'game', genre: 'kereta', title: 'Turbo Racer 3D', ic: '🏎️', hints: 'race racing lumba kereta car drive drift turbo speed rally pesaung overtake 3d' },
  { key: 'soccer3d', kind: 'game', genre: 'sukan', title: 'Penalty Shootout 3D', ic: '⚽', hints: 'soccer football bola penalty shootout sepakan penalti goal keeper penjaga gol futsal 3d' },
  { key: 'flight3d', kind: 'game', genre: '3d', title: 'Ring Flyer 3D', ic: '✈️', hints: 'plane airplane flight flying terbang pesawat kapal jet ring cincin pilot glide 3d' },
  { key: 'basket3d', kind: 'game', genre: 'sukan', title: 'Hoops 3D Shootout', ic: '🏀', hints: 'basket basketball keranjang hoops dunk shoot jaring bola jaring 3d' },
  // ── Aplikasi / alat ──
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

// Buang semua rujukan luar (CSP sandbox akan sekatnya) + suntik token tema supaya
// var(--...) tetap resolved. Kembalikan HTML self-contained.
function sanitize(raw) {
  let out = String(raw || '');
  out = out.replace(/<script[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>\s*<\/script>/gi, ''); // <script src=...></script>
  out = out.replace(/<link\b[^>]*>/gi, '');    // semua <link ...> (theme.css, canonical, icon, manifest)
  out = out.replace(/<base\b[^>]*>/gi, '');
  if (!/^\s*<!DOCTYPE/i.test(out)) out = '<!DOCTYPE html>\n' + out;
  // Buang token lama kalau ada, lalu suntik sekali selepas <head>.
  out = out.replace(/<style id="tk-theme">[\s\S]*?<\/style>/gi, '');
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + THEME_STYLE);
  else out = THEME_STYLE + out;
  return out;
}

// Cache hasil sanitize ikut mtime fail supaya setiap get() tak baca/bcacca cakera.
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

// Padankan huraian bebas → templat terbaik (ms/en). Skor = bilangan hint yang
// muncul SEBAGAI PERKATAAN penuh (bukan substr dalam perkataan lain — elak
// "berbilang"→"bil"→tip). Awalan longgar (≥4 aksara) cover singular/plural. Seri
// → hash deterministik. null bila tiada padanan cukup kuat (skor < 1).
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
      if (wset.has(h)) { score++; continue; } // padanan perkataan penuh
      if (h.length >= 4) { // awalan longgar: "weathers"↔"weather", plurals
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

// Pilih templat paling hampir untuk fallback (tiada padanan kata kunci): putar
// mengikut hash idea supaya output stabil & pelbagai. `kindFilter` ('game'|'app'|'') .
function nearest(goal, kindFilter) {
  const pool = kindFilter ? REGISTRY.filter((r) => r.kind === kindFilter) : REGISTRY;
  if (!pool.length) return null;
  const r = pool[h32(String(goal || '') + (kindFilter || '')) % pool.length];
  return { key: r.key, kind: r.kind, genre: r.genre, title: r.title, ic: r.ic };
}

// Suai tapak: tajuk + <h1> + aksen. Konservatif — hanya sentuh <title>, h1 pertama
// & tambah override --accent; struktur game tak disentuh.
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

// Senarai ringkas untuk galeri/API (tanpa HTML).
function list() {
  return REGISTRY.map((r) => ({ key: r.key, kind: r.kind, genre: r.genre, title: r.title, ic: r.ic }));
}

// Ekstrak dokumen HTML penuh daripada teks model (``` fence atau <!DOCTYPE…</html>).
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

// Arahan sistem untuk cabang LLM: satu fail HTML lengkap, tanpa sumber luar.
const LLM_SYS = [
  'You are an expert single-file web app/game generator. Reply with ONLY one complete HTML document, no prose before or after.',
  'The document MUST be fully self-contained: all CSS and JavaScript inline. NEVER reference any external resource (no http/https URLs, no <script src>, no <link rel=stylesheet>, no CDN, no fonts). It must run offline inside a strict sandbox.',
  'Always include: <!DOCTYPE html>, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, and a <title>. Use a clean dark UI (background #0f1115, text #e6e9ef, accent #4c8dff).',
  'Implement the user idea as a genuinely WORKING, playable or usable page with clear controls and on-screen feedback. Prefer canvas or DOM interaction. Add a way to restart/reset.',
  'Keep it focused and under about 320 lines. No explanatory comments inside the file. Reply ONLY with the HTML starting at <!DOCTYPE html>.'
].join(' ');

module.exports = { TEMPLATES_DIR, REGISTRY, THEME_STYLE, sanitize, get, detect, nearest, personalize, list, extractHtml, LLM_SYS, esc };
