#!/usr/bin/env node
'use strict';
// bench-edge-tier.js — Compare edge AI tiers on the server CPU:
//   A) LiteRT-LM   http://127.0.0.1:8090/v1  (model: gemma3-1b-it-int4)
//   B) Ollama      http://127.0.0.1:11434/v1 (model: qwen3:1.7b etc.)
// Both speak OpenAI-compatible, so the metrics are apple-to-apple:
//   - speed: output tokens / second (official usage; ~4 chars/token
//     estimate when the server sends no usage)
//   - first-token time (wall-clock) for a fixed prompt
//   - peak server-process RSS during inference (sampled from /proc)
// USE: node scripts/bench-edge-tier.js [--litert http://...] [--ollama http://...]
//      [--litert-model ID] [--ollama-model TAG] [--rounds 2]
// Run ONLY after the Tukuk Agent build finishes (avoid two CPU loads at once).

const PROMPT = 'Terangkan dalam 3 ayat ringkas: apakah sistem operasi dan apakah gunanya pada komputer lama.';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const CFG = {
  litertBase: arg('litert', 'http://127.0.0.1:8090'),
  ollamaBase: arg('ollama', 'http://127.0.0.1:11434'),
  litertModel: arg('litert-model', ''), // empty → auto-detect from /v1/models
  ollamaModel: arg('ollama-model', 'qwen3:1.7b'),
  rounds: Number(arg('rounds', 2)),
  maxTokens: 128,
};

/** Find the server process PID (partial name) for RSS sampling. */
function sampleRss(pattern) {
  try {
    const { execSync } = require('node:child_process');
    const out = execSync(
      "ps -eo rss,comm,args --no-headers | grep -F '" + pattern + "' | grep -v grep | awk '{s+=$1} END {print s+0}'"
    ).toString().trim();
    return Math.round(Number(out || 0) / 1024); // MB
  } catch { return 0; }
}

async function chatOnce(base, model, prompt) {
  const t0 = Date.now();
  const res = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: CFG.maxTokens, temperature: 0 }),
  });
  if (!res.ok) throw new Error(base + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
  const j = await res.json();
  const ms = Date.now() - t0;
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const tokens = (j.usage && j.usage.completion_tokens) || Math.max(1, Math.round(text.length / 4));
  return { ms, tokens, tps: (tokens / ms) * 1000, snippet: text.slice(0, 80).replace(/\s+/g, ' ') };
}

async function detectModel(base) {
  const res = await fetch(base + '/v1/models');
  if (!res.ok) throw new Error(base + '/v1/models → HTTP ' + res.status);
  const j = await res.json();
  const ids = (j.data || []).map((m) => m.id);
  if (!ids.length) throw new Error(base + ': no model in the registry (litert-lm import?)');
  return ids;
}

async function bench(label, base, model, procPattern) {
  console.log('\n── ' + label + ' (' + base + ', model=' + model + ') ──');
  let peak = 0;
  const tick = setInterval(() => { peak = Math.max(peak, sampleRss(procPattern)); }, 250);
  try {
    for (let i = 0; i < CFG.rounds; i++) {
      const r = await chatOnce(base, model, PROMPT);
      console.log('  round ' + (i + 1) + ': ' + r.tokens + ' tok in ' + r.ms + 'ms = ' + r.tps.toFixed(1) + ' tok/s');
      console.log('    → "' + r.snippet + '…"');
    }
  } finally {
    clearInterval(tick);
  }
  console.log('  peak process RSS: ' + peak + 'MB');
  return peak;
}

(async () => {
  const hasil = [];
  // LiteRT — the model list comes from the import registry.
  try {
    const ids = await detectModel(CFG.litertBase);
    const pick = CFG.litertModel || ids.find((id) => id.includes('gemma3')) || ids[0];
    const rss = await bench('LiteRT-LM', CFG.litertBase, pick, 'litert');
    hasil.push(['LiteRT-LM', pick, rss]);
  } catch (e) {
    console.log('\n⚠ LiteRT-LM was tested but failed: ' + e.message);
    console.log('   (make sure litert-lm serve is active on port 8090 — see scripts/setup-litert-pilot.sh)');
  }
  // Ollama (OpenAI-compatible on :11434/v1).
  try {
    const rss = await bench('Ollama', CFG.ollamaBase, CFG.ollamaModel, 'ollama');
    hasil.push(['Ollama', CFG.ollamaModel, rss]);
  } catch (e) {
    console.log('\n⚠ Ollama failed: ' + e.message + ' (pull first: ollama pull ' + CFG.ollamaModel + ')');
  }
  console.log('\n════ SUMMARY ════');
  for (const [nama, model, rss] of hasil) console.log('  ' + nama + ' [' + model + '] RSS=' + rss + 'MB');
  console.log('  The tok/s results are above; pick the tier with the highest tok/s whose RSS fits in 6.8GB.');
})().catch((e) => { console.error('✗ bench failed:', e.message); process.exit(1); });
