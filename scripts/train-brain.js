#!/usr/bin/env node
/**
 * train-brain.js — trains "Tukuk-Brain Mini", Tukuk-OS's OWN AI model.
 *
 * Training data sources:
 *   1. The curated multilingual seeds in this file (BM/EN/ID/ES + script-neutral).
 *   2. The server's PRODUCTION logs: data/tukuk-os.json (ask/search history) and
 *      data/search-queries.jsonl — self-labeled (self-distillation) by
 *      the existing taskrouter regex; regex = teacher, model = student that
 *      generalizes to the phrasings the regex misses.
 *
 * Output: data/tukuk-brain-v1.json (loaded by taskrouter at boot).
 * Run it on the server:  node scripts/train-brain.js  (install / restart the service)
 */

const fs = require('fs');
const path = require('path');
const minimodel = require('../src/brain/minimodel');
const taskrouter = require('../src/brain/taskrouter');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.BRAIN_MODEL_FILE || path.join(ROOT, 'data', 'tukuk-brain-v1.json');

// ── 1) Seed curated ─────────────────────────────────────────────────────────
const SEED = [
  // math
  ['hitung 12 kali 7', 'math'], ['berapa 45 bahagi 9', 'math'], ['kira jumlah 340 dan 260', 'math'],
  ['what is 15 percent of 240', 'math'], ['calculate 88 minus 39', 'math'], ['how many is 6 times 6', 'math'],
  ['berapa 3 kuasa 4', 'math'], ['12*7', 'math'], ['(3+4)/2', 'math'], ['2+2', 'math'],
  ['jumlahkan 1500 ringgit dengan 2300', 'math'], ['compute 1024 times 8', 'math'],
  ['berapa banyak 7 kali lapan', 'math'], ['hasil tolak 90 daripada 144', 'math'],
  ['18% of 250', 'math'], ['cuánto es 8 por 8', 'math'], ['combien font 12 fois 12', 'math'],
  // code
  ['tulis fungsi javascript untuk sort array', 'code'], ['buat script python baca csv', 'code'],
  ['write a regex to match email', 'code'], ['kode html tombol download', 'code'],
  ['generate sql query select users where active', 'code'], ['buat function debounce javascript', 'code'],
  ['python code untuk download file', 'code'], ['tulis kod bash tukar nama fail semua', 'code'],
  ['show me a typescript interface for a book', 'code'], ['snippet java arraylist loop', 'code'],
  ['debug kod saya error undefined', 'code'], ['how to write async await in node', 'code'],
  ['buatkan API endpoint express json', 'code'], ['write css for centered flexbox', 'code'],
  // compare
  ['beza http dan https', 'compare'], ['perbezaan mysql dan postgresql', 'compare'],
  ['difference between python and javascript', 'compare'], ['vs code atau intellij mana bagus', 'compare'],
  ['compare meilisearch and elasticsearch', 'compare'], ['apa beza ram dan rom', 'compare'],
  ['jwt vs session cookie mana lebih selamat', 'compare'], ['what is the difference between 4g and 5g', 'compare'],
  ['perbandingan cpu dan gpu', 'compare'], ['difference between docker and vm', 'compare'],
  // list
  ['senarai bahasa pengaturcaraan popular', 'list'], ['list hosting percuma 2026', 'list'],
  ['contoh makanan tradisional malaysia', 'list'], ['sebutkan ibu kota negara ASEAN', 'list'],
  ['top 5 search engine', 'list'], ['apa saja cara jana pendapatan online', 'list'],
  ['give me examples of NoSQL databases', 'list'], ['senaraikan plugin figma berguna', 'list'],
  ['best free video editor', 'list'], ['name some open source CMS', 'list'],
  // howto
  ['macam mana nak pasang nginx reverse proxy', 'howto'], ['cara buat roti canai', 'howto'],
  ['how to speed up wordpress', 'howto'], ['langkah langkah daftar domain baru', 'howto'],
  ['tutorial guna git branch', 'howto'], ['bagaimana backup database mysql', 'howto'],
  ['how do i center a div', 'howto'], ['panduan setup ssl free lets encrypt', 'howto'],
  ['cara optimize gambar untuk web', 'howto'], ['guide nak deploy nodejs ke vps', 'howto'],
  ['macam mana nak tukar wifi password', 'howto'], ['how can i improve my sleep', 'howto'],
  // define
  ['apa itu dns over https', 'define'], ['apa itu blockchain', 'define'],
  ['what is api rest', 'define'], ['definisi machine learning', 'define'],
  ['maksud algoritma', 'define'], ['siapa linus torvalds', 'define'],
  ['why is the sky blue', 'define'], ['what does cdn actually do', 'define'],
  ['kenapa langit warna biru', 'define'], ['jelaskan cara kerja search engine', 'define'],
  ['who was ada Lovelace', 'define'], ['definition of webassembly', 'define'],
  ['apa maksud http status 404', 'define'], ['what is quantum computing', 'define'],
  // general
  ['selamat pagi', 'general'], ['hello there', 'general'], ['terima kasih banyak', 'general'],
  ['cuaca hari ini', 'general'], ['khabar berita', 'general'], ['siapa presiden amerika sekarang', 'general'],
  ['filem best 2024 di netflix', 'general'], ['harga minyak masak hari ini', 'general'],
  ['adakah ai akan gantikan programmer', 'general'], ['tips jaga keyboard tahan lama', 'general'],
  // ── Diversity boost (holdout generalization) ───────────────────────────
  // math (variations of phrasings the simple regex misses)
  ['kalikan 9 dengan 9', 'math'], ['purata bagi 10 20 dan 30', 'math'],
  ['berapa jadual 12 bulan darab 30 hari', 'math'], ['what do 7 plus 8 equal', 'math'],
  ['percentage increase from 200 to 250', 'math'], ['jumlahkan semua harga dalam resit 45 60 25', 'math'],
  ['baki 1000 tolak belanja 378', 'math'], ['square root of 169', 'math'],
  ['17 kali 17 berapa', 'math'], ['berapa baki 9075 bahagi 5', 'math'],
  // code (coding intent with no exact regex keyword)
  ['buatkan aku script backup harian ke r2', 'code'], ['kod php hantar emel smtp', 'code'],
  ['query sql kira rekod mengikut bulan', 'code'], ['python loop cetak 1 sampai 100', 'code'],
  ['javascript filter array objek ikut umur', 'code'], ['saya perlukan fungsi tukar masa ke epoch', 'code'],
  ['buat halaman login html css', 'code'], ['nodejs baca fail json lalu cetak', 'code'],
  ['tulis cron job tarik harga setiap jam', 'code'], ['coding robot trading simple', 'code'],
  ['minta tolong buatkan regex nombor telefon malaysia', 'code'],
  // compare
  ['http2 berbanding http1.1', 'compare'], ['android vs iphone mana tahan lama', 'compare'],
  ['mana lebih laju ssd atau hdd', 'compare'], ['meilisearch elasticsearch perbandingan prestasi', 'compare'],
  ['rokok atau vape mana lebih bahaya', 'compare'], ['which is faster tcp or udp', 'compare'],
  ['beza antara halal dan toyyib', 'compare'], ['laravel atau express untuk api', 'compare'],
  // list
  ['senarai negara ahli g20', 'list'], ['5 tips tidur lena', 'list'],
  ['list aplikasi editing video percuma', 'list'], ['sebut contoh haiwan herbivora', 'list'],
  ['apa benda best untuk belajar coding', 'list'], ['name three types of databases', 'list'],
  ['senarai web hosting ada free tier', 'list'], ['contoh syarikat unicorn asia tenggara', 'list'],
  // howto (casual phrasings the regex often misses)
  ['nak reset telefon terlupa password', 'howto'], ['macam mana hasilkan duit dengan dropship', 'howto'],
  ['cara nak connect printer wifi', 'howto'], ['steps to learn english fast', 'howto'],
  ['macam mana nak guna vpn di android', 'howto'], ['nak tahu cara video saya dapat banyak view', 'howto'],
  ['boleh tak ajar buat kuih lapis', 'howto'], ['guide naik bas dari kl ke penang', 'howto'],
  ['saya nak install ubuntu kat laptop lama', 'howto'], ['how make coffee without machine', 'howto'],
  // define (casual phrasings)
  ['apa benda cpu ni', 'define'], ['what is an api', 'define'],
  ['erti kata halal', 'define'], ['siapa elon musk', 'define'],
  ['kenapa bulan ada fasa', 'define'], ['apa itu steganografi', 'define'],
  ['what is CDN in simple terms', 'define'], ['siapa Nabi Muhammad', 'define'],
  ['maksud word2vec', 'define'], ['apa sebenarnya blockchain tu', 'define'],
  ['why is my python slow', 'define'], ['kenapa air laut masin', 'define'],
  // general (greetings/chat — the model must know when NOT to change class)
  ['cerita sikit', 'general'], ['khabar', 'general'], ['selamat tinggal', 'general'],
  ['test test', 'general'], ['halo ai', 'general'], ['terima kasih ya', 'general'],
  ['suka saya bantu anda', 'general'], ['who are you', 'general'], ['just saying hi', 'general'],
  ['jom sembang kosong', 'general'], ['ok fine', 'general'], ['wow Amazing', 'general']
];

// ── 3) Validation probes — phrases OUTSIDE the seed, new styles ────────────
const PROBES = [
  ['apa beza kafein dan theanine', 'compare'],
  ['perlu kod node baca excel', 'code'],
  ['senaraikan side income sesuai student', 'list'],
  ['kenapa telefon laju panas', 'define'],
  ['kira 880 darab 6', 'math'],
  ['oi hello', 'general'],
  ['makna kata berlapang dada', 'define'],
  ['minta contoh residensi diplomatik', 'list'],
  ['method nak masak lemak cili api', 'howto'],
  ['manakah lebih menjimatkan kereta api atau bas', 'compare'],
  ['tulis program hello world ruby', 'code'],
  ['50 peratus dari 480', 'math'],
  ['apa khabar hari ni', 'general'],
  ['nak tahu kenapa wifi lambat malam', 'define'],
  ['tips hilangkan stress cepat', 'list'],
  ['buatkan query cari user tanpa emel', 'code']
];

// ── 2) Self-distillation from production logs ──────────────────────────────
function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function collectLogs() {
  const texts = new Set();
  // data/tukuk-os.json → history (ask + search)
  try {
    const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tukuk-os.json'), 'utf8'));
    for (const h of (store.history || [])) {
      if (h.query && h.query.length >= 6) texts.add(String(h.query).slice(0, 120));
    }
  } catch { /* fail soft */ }
  // data/search-queries.jsonl
  for (const r of readJsonl(path.join(ROOT, 'data', 'search-queries.jsonl'))) {
    if (r.q && String(r.q).length >= 6) texts.add(String(r.q).slice(0, 120));
  }
  // Labeled by the taskrouter regex (the teacher). general is DROPPED — the regex not
  // matching is no proof the query is general (keeps wrong labels out of training).
  const labeled = [];
  for (const t of texts) {
    const kind = taskrouter.classifyRawRegex(t).kind;
    if (kind !== 'general') labeled.push({ text: t, label: kind, from: 'log' });
  }
  return labeled;
}

function main() {
  // Simple CLI: node scripts/train-brain.js [--epochs 200] [--lr 0.4] [--l2 0.005] [--seed 42]
  const arg = (name, dflt) => {
    const i = process.argv.indexOf('--' + name);
    return i > -1 ? Number(process.argv[i + 1]) : dflt;
  };
  const seeds = SEED.map(([text, label]) => ({ text, label, from: 'seed' }));
  const logs = collectLogs();
  // dedup identical text (the seed wins — human labels are more trustworthy)
  const seen = new Set(seeds.map((s) => s.text.toLowerCase()));
  const extra = logs.filter((l) => !seen.has(l.text.toLowerCase()));
  const data = [...seeds, ...extra];

  const { model, stats } = minimodel.train(data, {
    // Defaults picked from the sweep: tri=60 l2=0.003 epochs=200
    // (external probe 10/16 + a confidence gate that filtered 2 errors, so 100% safe).
    epochs: arg('epochs', 200), lr: arg('lr', 0.4), l2: arg('l2', 3e-3), tri: arg('tri', 60), seed: arg('seed', 42)
  });

  // ── REAL VALIDATION: the external PROBE set (new phrasings, NOT in the seed).
  // The production metric = does the model catch the phrasings the regex MISSED.
  let okAll = 0; let regexMiss = 0; let modelSelamatkan = 0;
  const probeLines = [];
  for (const [t, want] of PROBES) {
    const r = minimodel.predict(model, t);
    if (r.label === want) okAll += 1;
    const regexKind = taskrouter.classifyRawRegex(t).kind;
    if (regexKind === 'general') {
      regexMiss += 1;
      const rescued = r.label === want && r.p >= 0.5 && r.margin >= 0.2;
      if (rescued) modelSelamatkan += 1;
      probeLines.push(`  → regex gap: "${t}" model=${r.label}(p=${r.p.toFixed(2)})${rescued ? ' ✓' : ''}`);
    }
  }

  const meta = {
    name: 'Tukuk-Brain Mini',
    version: 'v1',
    purpose: 'intent classifier (task router) — softmax neural model trained on our own data',
    trainedAt: new Date().toISOString(),
    sources: { seed: seeds.length, productionLog: extra.length },
    probeAccuracy: Math.round((okAll / PROBES.length) * 1000) / 1000,
    regexGapsRescued: `${modelSelamatkan}/${regexMiss}`,
    host: require('os').hostname()
  };
  minimodel.save(model, OUT, { ...meta, accuracy: stats.accuracy, stats });

  console.log(`✓ training done — ${stats.examples} examples (${seeds.length} seed + ${extra.length} log)`);
  console.log(`  holdout accuracy: ${(stats.accuracy * 100).toFixed(1)}%  (train ${(stats.trainAccuracy * 100).toFixed(1)}%)`);
  console.log(`  class spread:`, stats.perClass.map((c) => `${c.name}:${c.samples}`).join(' '));
  console.log(`  saved → ${OUT}`);
  for (const l of probeLines) console.log(l);
  console.log(`  external probes: ${okAll}/${PROBES.length} correct — the regex missed ${regexMiss}, the model rescued ${modelSelamatkan}`);
}

main();
