// ═══ Tukuk App Router ════════════════════════════════════════════════════════
// Lapisan "tool use" untuk brain: memetakan soalan/permintaan pengguna kepada
// APLIKASI server yang paling tepat (utiliti, alat media, game, arked). Skor
// berasaskan kata kunci multibahasa (ms/id/en) — bebas model, deterministik,
// dan digate supaya cadangan hanya muncul bila benar-benar relevan.
//
// Sumber katalog: daftar TERTULIS di bawah (hanya fail yang wujud + laluan
// yang sah di server). Senarai Arked & utiliti utama sepadan dengan
// STORE_APP_META/STORE_ARCADE di server.js — test mengesekkannya.
'use strict';

// ── Katalog: [nama, url, ikon, tajuk, kata kunci (ms/id/en campur, lowercase)] ──
const UTILITIES = [
  ['notes', '/apps/notes', '📝', 'Notes', 'note notes catatan memo menulis write down reminder reminder list idea'],
  ['calc', '/apps/calc', '🧮', 'Calculator', 'calculate calculator kira hitung kalkulator arithmetic math maths'],
  ['todo', '/apps/todo', '✅', 'To-Do', 'todo to-do task tugasan senarai check list checklist kerja to do'],
  ['convert', '/apps/convert', '📐', 'Unit Converter', 'unit convert units ukur cm kg miles suhu temperature panjang berat'],
  ['timer', '/apps/timer', '⏱️', 'Timer & Pomodoro', 'timer stopwatch pomodoro countdown masa waktu fokus focus break rehat'],
  ['color', '/apps/color', '🎨', 'Color Picker', 'color colour warna hex rgb hsl palette pallet contrast picks picker'],
  ['password', '/apps/password', '🔐', 'Password Generator', 'password kata laluan passphrase rawak random generate kata sandi'],
  ['text', '/apps/text', '🔡', 'Text Tools', 'text word count base64 uppercase lowercase url encode sort dedupe case ubah huruf'],
  ['pixel', '/apps/pixel', '🟩', 'Pixel Studio', 'pixel art piksel draw lukis 16x16 sprite'],
  ['piano', '/apps/piano', '🎹', 'Synth Piano', 'piano piano key musical music main nota synth audio rekod'],
  ['spiro', '/apps/spiro', '🌀', 'Spiro Mandala', 'spirograph mandala spiral seni art lukisan'],
  ['orbit', '/apps/orbit', '🪐', 'Orbit Simulator', 'orbit planet gravity graviti simulasi angkasa space'],
  ['fractal', '/apps/fractal', '🔮', 'Fractal Explorer', 'fractal mandelbrot zoom seni art'],
  ['drum', '/apps/drum', '🥁', 'Rhythm Machine', 'drum beat rentak rhythm ketukan music muzik'],
  ['chat', '/apps/chat', '💬', 'T Chat', 'chat message mesej messenger call phone bilik room bersembang'],
];
const TOOLS = [
  ['converter', '/converter', '🎛️', 'Audio & Media Converter', 'convert mp3 wav ogg flac audio video tukar format extract audio tukar fail'],
  ['bg-remover', '/bg-remover', '🪄', 'Background Remover', 'background remove buang hapus latar belakang photo gambar cutout'],
  ['collage', '/collage', '🖼️', 'Photo Collage Maker', 'collage gabung gambar photos foto montage susun'],
  ['design', '/design', '🎨', 'Design Studio', 'design reka poster banner logo graphic'],
  ['builder', '/builder', '🏗️', 'Studio Builder', 'builder buat app game sendiri cipta create develop bina'],
  ['studio', '/studio', '🎬', 'Tukuk Studio', 'studio edit video audio project'],
  ['editor', '/editor', '✂️', 'Text & Code Editor', 'editor edit code teks tulis'],
  ['editor-video', '/editor-video', '🎞️', 'Video Editor', 'video edit potong trim gabung clip'],
  ['movie', '/movie', '🎥', 'Movie Player', 'movie filem watch nonton video player'],
  ['nasa', '/nasa', '🛰️', 'NASA APOD', 'nasa space photo astronomy angkasa planet bintang star'],
  ['store', '/store', '🛒', 'Tukuk Store', 'store apps download apk install aplikasi gedai kedai'],
  ['os', '/os', '📱', 'Tukuk OS (web phone)', 'phone android os sistem web home screen operating telefon perisian'],
  ['blog', '/blog', '📝', 'Blog & Articles', 'blog article artikel baca reading tulisan'],
  ['learn', '/learn', '🎓', 'Learn 0 → Hero', 'learn belajar course kelas curriculum tutorial beginner asas'],
  ['radio', '/cari?mode=radio', '📻', 'World Radio', 'radio stesen station dengar siaran live'],
  ['news', '/cari?mode=news', '📰', 'News Search', 'news berita headline terkini'],
  ['music', '/cari?mode=music', '🎵', 'Music Search', 'music song lagu muzik listen dengar'],
  ['games', '/store?genre=arkad', '🕹️', 'Arcade Games', 'game main gaming permainan'],
];
// Genre arkad → pautan penapis /store (sepadan label STORE_ARCADE/server).
const GENRE_HINTS = [
  ['teki-teki', '/store?genre=teki-teki', '🧩', 'Puzzle Games', 'puzzle teki teki-teki sudoku match 3 tetris jigsaw'],
  ['refleks', '/store?genre=refleks', '⚡', 'Reflex Games', 'reflex reaction laju pantas reflex'],
  ['board', '/store?genre=board', '🎲', 'Board Games', 'board ludo catur chess card kad solitaire domino'],
  ['penembakan', '/store?genre=penembakan', '👾', 'Shooter Games', 'shooter tembak shooting sniper fps invaders'],
  ['santai', '/store?genre=santai', '🌿', 'Casual Games', 'casual santai relax tenang runner hopping'],
];

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'i', 'my', 'me',
  'please', 'can', 'how', 'what', 'why', 'with', 'tolong', 'saya', 'nak', 'mahu', 'boleh', 'kah', 'yang',
  'satu', 'dua', 'ini', 'itu', 'dalam', 'dan', 'atau', 'untuk', 'macam', 'bagaimana', 'buat',
  'buatkan', 'bina', 'cari', 'mainkan', 'bukakan', 'kerjakan', 'sediakan']);

// ── Pembina indeks: kata kunci → [entry] (sekali sahaja, dipanggil lazily) ──
const CATALOG = [...UTILITIES, ...TOOLS, ...GENRE_HINTS];
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  for (const e of CATALOG) for (const w of e[4].split(/\s+/)) if (w) {
    if (!INDEX.has(w)) INDEX.set(w, []);
    INDEX.get(w).push(e);
  }
  return INDEX;
}

/**
 * Padankan soalan dengan aplikasi server.
 * @param {string} query
 * @returns {{apps: Array<{name:string,url:string,ic:string,title:string,score:number}>}}
 */
function route(query) {
  const idx = index();
  const words = String(query || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const scores = new Map(); // name → {entry, score}
  for (const w of words) {
    for (const e of idx.get(w) || []) {
      const cur = scores.get(e[0]) || { e, score: 0 };
      cur.score += 1;
      scores.set(e[0], cur);
    }
  }
  // Longgar: padankan juga awalan 4+ aksara (ingular/plural, "converts"→"convert").
  for (const w of words) {
    if (w.length < 4) continue;
    for (const [kw, list] of idx) {
      if (kw.length >= 4 && (kw.startsWith(w) || w.startsWith(kw))) {
        for (const e of list) {
          const cur = scores.get(e[0]) || { e, score: 0 };
          cur.score += 0.5;
          scores.set(e[0], cur);
        }
      }
    }
  }
  const ranked = [...scores.values()]
    .map((s) => ({ name: s.e[0], url: s.e[1], ic: s.e[2], title: s.e[3], score: Math.round(s.score * 10) / 10 }))
    .sort((a, b) => b.score - a.score);
  // Gate: cukup kuat sahaja (1 padanan penuh ATAU 2 separuh) — kalau tak, kosong.
  const apps = ranked.filter((r) => r.score >= 1).slice(0, 3);
  return { apps };
}

module.exports = { route, CATALOG, UTILITIES, TOOLS };
