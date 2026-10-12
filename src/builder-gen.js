'use strict';
// Penjana auto Pembina (/builder): tukar SATU kata/huraian → app (widget + tema + game).
// Dua laluan: (1) AI bila brain tersedia (server.js guna provider.generateCloudRotation),
// (2) HEURISTIK deterministik — sentiasa jalan, tanpa AI/rangkaian. Fungsi di sini MURNI
// (tanpa I/O) supaya boleh diuji unit. server.js yang panggil LLM + gabung laluan.

// Types widget yang DIBENARKAN — padan tepat dengan `TYPES` dalam public/builder.html.
// Sebarang types lain dibuang semasa sanitasi (anti suntikan skrip/widget tak diketahui).
const KNOWN = new Set(['heading', 'text', 'button', 'image', 'input', 'counter', 'toggle', 'list', 'card', 'divider', 'spacer', 'faq', 'steps', 'quiz', 'ttt', 'memory', 'mole', 'rps', 'reaction', 'guess', 'br', 'fps', 'runner']);
const GAMES = ['ttt', 'memory', 'mole', 'rps', 'reaction', 'guess', 'br', 'fps', 'runner'];

const PALETTES = [
  { accent: '#f59e0b', bg: '#0f172a', fg: '#e2e8ff', dark: true },
  { accent: '#38bdf8', bg: '#0b132b', fg: '#dbeafe', dark: true },
  { accent: '#34d399', bg: '#04130f', fg: '#d1fae5', dark: true },
  { accent: '#fb7185', bg: '#1a0b14', fg: '#ffe4e6', dark: true },
  { accent: '#a78bfa', bg: '#12081f', fg: '#ede9fe', dark: true },
  { accent: '#4c8dff', bg: '#ffffff', fg: '#16181d', dark: false },
  { accent: '#ff8a3c', bg: '#ffffff', fg: '#16181d', dark: false },
  { accent: '#30d158', bg: '#0b0f1a', fg: '#eaf0ff', dark: true }
];

// Kata kunci → genre game (pilih yang paling awal padan; kalau tiada, hash deterministik).
const GAME_HINTS = [
  [['lari', 'runner', 'jarak', 'kejar', 'hindar'], 'runner'],
  [['tembak', 'battle', 'royale', 'br', 'senjata', 'musuh', 'zombi'], 'br'],
  [['fps', '3d', 'first', 'penembak'], 'fps'],
  [['ingat', 'memory', 'padan', 'padanan', 'kad'], 'memory'],
  [['tikus', 'mole', 'pukul', 'tampar', 'keluar'], 'mole'],
  [['batu', 'kertas', 'gunting', 'rps', 'suit'], 'rps'],
  [['reaksi', 'reaction', 'refleks', 'laju', 'cepat'], 'reaction'],
  [['teka', 'guess', 'nombor', 'angka', 'angka'], 'guess'],
  [['xoxo', 'ttt', 'tic', 'tac', 'salib'], 'ttt']
];

function h32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function oneOf(v, opts, fb) { return opts.includes(v) ? v : fb; }
function clampNum(v, min, max, fb) { const n = Math.round(Number(v)); return isFinite(n) ? Math.min(max, Math.max(min, n)) : fb; }
function strArr(v, cap, len) { const a = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/\r?\n/) : []); return a.map((x) => String(x == null ? '' : x).trim().slice(0, len || 120)).filter(Boolean).slice(0, cap || 12); }

function pickGame(key) {
  for (const [words, g] of GAME_HINTS) { if (words.some((w) => key.includes(w))) return g; }
  return GAMES[h32(key) % GAMES.length];
}

// Sanitasi satu widget: hanya props yang diketahui bagi types itu, dengan coercion ringan.
function clipWidget(t, w) {
  const out = { type: t };
  const s = (k, m) => { if (w[k] != null) out[k] = String(w[k]).trim().slice(0, m); };
  switch (t) {
    case 'heading': s('text', 120); out.level = clampNum(w.level, 1, 3, 2); out.align = oneOf(String(w.align), ['left', 'center', 'right'], 'left'); break;
    case 'text': s('text', 600); out.align = oneOf(String(w.align), ['left', 'center', 'right'], 'left'); break;
    case 'button': s('label', 40); s('href', 200); out.variant = oneOf(String(w.variant), ['primary', 'ghost'], 'primary'); out.fullWidth = Boolean(w.fullWidth); break;
    case 'image': s('src', 0); s('alt', 60); s('caption', 80); out.radius = clampNum(w.radius, 0, 50, 12); break; // src dipaksa kosong (tiada dataURL besar/luar)
    case 'input': s('label', 40); s('placeholder', 60); out.kind = oneOf(String(w.kind), ['text', 'number', 'email', 'tel', 'date'], 'text'); break;
    case 'counter': s('label', 40); out.value = clampNum(w.value, -100000, 100000, 0); out.step = clampNum(w.step, 1, 1000, 1); break;
    case 'toggle': s('label', 40); out.on = Boolean(w.on); break;
    case 'list': out.items = strArr(w.items, 12); out.allowAdd = w.allowAdd !== false; break;
    case 'card': s('title', 60); s('body', 400); break;
    case 'divider': break;
    case 'spacer': out.height = clampNum(w.height, 4, 200, 24); break;
    case 'faq': out.items = (Array.isArray(w.items) ? w.items : []).slice(0, 10).map((x) => ({ q: String((x && x.q) || '').slice(0, 120), a: String((x && x.a) || '').slice(0, 400) })).filter((x) => x.q); break;
    case 'steps': s('title', 60); out.items = strArr(w.items, 12); break;
    case 'quiz': s('q', 160); out.options = strArr(w.options, 6, 80); out.answer = clampNum(w.answer, 0, Math.max(0, out.options.length - 1), 0); break;
    case 'memory': out.pairs = clampNum(w.pairs, 2, 12, 6); break;
    case 'mole': out.duration = clampNum(w.duration, 5, 60, 20); break;
    case 'guess': out.max = clampNum(w.max, 1, 9999, 100); break;
    case 'br': out.enemies = clampNum(w.enemies, 1, 15, 5); out.zoneSpeed = clampNum(w.zoneSpeed, 5, 60, 10); out.mapSize = clampNum(w.mapSize, 200, 1400, 600); break;
    case 'fps': out.enemies = clampNum(w.enemies, 1, 10, 4); out.zoneSpeed = clampNum(w.zoneSpeed, 10, 60, 25); break;
    default: break; // ttt/rps/reaction/runner tiada props
  }
  return out;
}

// Sanitasi penuh output (AI atau heuristic) → bentuk {appName,theme,widgets} yang selamat.
function sanitizeApp(o) {
  const src = o && typeof o === 'object' ? o : {};
  const appName = String(src.appName || '').trim().slice(0, 40) || 'Aplikasi';
  const th = src.theme && typeof src.theme === 'object' ? src.theme : {};
  const theme = {};
  const col = (k) => { if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(th[k] || '').trim())) theme[k] = String(th[k]).trim(); };
  col('accent'); col('bg'); col('fg');
  if (typeof th.dark === 'boolean') theme.dark = th.dark;
  if (th.sub != null) theme.sub = String(th.sub).trim().slice(0, 80);
  if (th.desc != null) theme.desc = String(th.desc).trim().slice(0, 160);
  const raw = Array.isArray(src.widgets) ? src.widgets : [];
  const widgets = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const t = String(w.type || '').toLowerCase();
    if (!KNOWN.has(t)) continue;
    widgets.push(clipWidget(t, w));
    if (widgets.length >= 16) break;
  }
  return { appName, theme, widgets };
}

// Ekstrak objek JSON pertama daripada teks model (toleransi ``` fence + teks sekitar).
function parseGenJson(text) {
  let s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) { esc = false; } else if (c === '\\') { esc = true; } else if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// Bina deterministik tanpa AI — sentiasa hasilnya app lengkap + satu game.
// `salt` memutar palet & genre game (varian/seed); `style` membias palet gelap/cerah.
const DARK = PALETTES.filter((p) => p.dark);
const LIGHT = PALETTES.filter((p) => !p.dark);
function poolFor(style) {
  const s = String(style || '').toLowerCase();
  if (/gelap|dark|black|neon|midnight|malam/.test(s)) return DARK;
  if (/cerah|light|putih|white|minimalis|minimal|clean|pastel/.test(s)) return LIGHT.length ? LIGHT : PALETTES;
  return PALETTES;
}
function buildOne(idea, salt, style) {
  const s = salt || 0;
  const clean = (String(idea || '').trim().replace(/\s+/g, ' ').slice(0, 40)) || 'Aplikasi';
  const key = clean.toLowerCase();
  const name = clean.charAt(0).toUpperCase() + clean.slice(1);
  const pool = poolFor(style);
  const pal = pool[(h32(key) + s) % pool.length];
  const baseGame = pickGame(key);
  const game = GAMES[(GAMES.indexOf(baseGame) + s + GAMES.length) % GAMES.length]; // salt 0 → padan kata kunci
  const widgets = [
    { type: 'heading', text: name, level: 2, align: 'center' },
    { type: 'text', text: `Semua tentang ${clean} — pantas, ringkas & menyeronokkan.`, align: 'center' },
    clipWidget(game, {}),
    { type: 'list', items: [`Contoh ${name}: satu`, 'Contoh: dua', 'Contoh: tiga'], allowAdd: true },
    { type: 'counter', label: `Kira ${name}`, value: 0, step: 1 },
    { type: 'button', label: `Kongsi ${name}`, href: 'https://tukuk.org', variant: 'primary', fullWidth: false }
  ];
  return sanitizeApp({
    appName: name,
    theme: { accent: pal.accent, bg: pal.bg, fg: pal.fg, dark: pal.dark, sub: `Dibina auto · ${name}`, desc: `Aplikasi ${clean} — dibina automatik dengan Tukuk Studio.` },
    widgets
  });
}
function heuristicBuild(idea, style) { return buildOne(idea, 0, style); }

// N calon heuristik berbeza (palet + game berputar). `offset` menggeser salt → "Jana semula" berbeza.
function heuristicVariants(idea, n, style, offset) {
  const count = Math.max(1, Math.min(6, Number(n) || 1));
  const base = Math.max(0, Math.floor(Number(offset) || 0));
  const out = [];
  for (let i = 0; i < count; i++) out.push(buildOne(idea, i + base, style));
  return out;
}

// Arahan sistem untuk LLM — paksa JSON sah sahaja + types yang dibenarkan.
const SYSTEM_PROMPT = [
  'Anda penjana aplikasi no-code. Balas HANYA dengan satu objek JSON, tanpa teks lain.',
  'Skema: {"appName":string(<=40),"theme":{"accent":"#rrggbb","bg":"#rrggbb","fg":"#rrggbb","dark":bool,"sub":string,"desc":string},"widgets":[...]}',
  'types widget dibenarkan: heading{text,level(1-3),align}, text{text,align}, button{label,href,variant,fullWidth}, image{alt,caption,radius}, input{label,placeholder,kind}, counter{label,value,step}, toggle{label,on}, list{items[],allowAdd}, card{title,body}, divider, spacer{height}, faq{items:[{q,a}]}, steps{title,items[]}, quiz{q,options[],answer}, dan GAME: ttt,memory{pairs},mole{duration},rps,reaction,guess{max},br{enemies,zoneSpeed,mapSize},fps{enemies,zoneSpeed},runner.',
  'MUST sertakan TEPAT SATU widget game yang sesuai dengan idea. align dalam left|center|right. Bahasa kandungan: Melayu.',
  '4-8 widget sahaja. Semua teks singkat. Tiada HTML/skrip mentah dalam nilai.'
].join(' ');

module.exports = { KNOWN, GAMES, SYSTEM_PROMPT, parseGenJson, sanitizeApp, heuristicBuild, heuristicVariants, buildOne, pickGame, clipWidget };
