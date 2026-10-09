// validate-in-node.mjs — buktikan runtime inferens reranker berjalan DI NODE
// pada CPU Tukuk (no-AVX2). Cuba model LOKAL (models/tukuk-reranker) dahulu,
// kemudian senarai calon AWAM (HF) sebagai sandaran. Cetak logit mentah + latensi.
//
// Jalan:  node validate-in-node.mjs           (cuba local, jatuh ke remote)
//         RK_LOCAL=0 node validate-in-node.mjs  (paksa remote sahaja)
const t0 = Date.now();
const { AutoTokenizer, AutoModelForSequenceClassification, env } =
  await import('@huggingface/transformers');

env.allowRemoteModels = true;   // dibenarkan HANYA utk ujian ini
env.allowLocalModels = true;

const LOCAL_DIR = new URL('../../models/tukuk-reranker/', import.meta.url).pathname;
const tryLocal = process.env.RK_LOCAL !== '0';

const REMOTE_CANDIDATES = [
  'cross-encoder/ms-marco-MiniLM-L-6-v2',
  'Xenova/ms-marco-MiniLM-L-6-v2'
];

let loaded = null;
let usedSource = null;
const errors = [];

const sources = tryLocal ? [LOCAL_DIR, ...REMOTE_CANDIDATES] : REMOTE_CANDIDATES;
for (const src of sources) {
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(src);
    const model = await AutoModelForSequenceClassification.from_pretrained(src);
    loaded = { tokenizer, model };
    usedSource = src;
    break;
  } catch (e) {
    errors.push(`${src}: ${String(e.message || e).split('\n')[0]}`);
  }
}

if (!loaded) {
  console.log('LOAD_FAIL');
  console.log(errors.join('\n'));
  process.exit(0);
}
console.log(`loaded=${usedSource} load_ms=${Date.now() - t0}`);

// Saniti relevansi: pasangan (query, passing) — dokumen BETUL mesti skor tinggi.
const q = 'how old is the planet earth';
const good = 'The Earth is estimated to be about 4.54 billion years old.';
const bad = 'Bananas are a good source of potassium and grow in tropical climates.';
const mixed = 'The planet Mars is the fourth planet from the Sun.';

const enc = await loaded.tokenizer([q, q, q], {
  text_pair: [good, bad, mixed],
  padding: true, truncation: true, max_length: 256
});
const t1 = Date.now();
const out = await loaded.model(enc);
const scoreMs = Date.now() - t1;
const data = Array.from(out.logits.data);
console.log(`score_ms(3 pairs)=${scoreMs} dims=${JSON.stringify(out.logits.dims)}`);
console.log(`  GOOD   logit=${data[0]?.toFixed(3)} (jangka paling tinggi)`);
console.log(`  BAD    logit=${data[1]?.toFixed(3)}`);
console.log(`  MIXED  logit=${data[2]?.toFixed(3)}`);
const pass = data[0] > data[1] && data[0] > data[2];
console.log(`VERDICT=${pass ? 'OK' : 'CHECK'} — reranker membezakan relevan vs tidak`);
