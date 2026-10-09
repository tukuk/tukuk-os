#!/usr/bin/env node
/**
 * Tukuk-OS MCP Server (stdio).
 *
 * MCP = Model Context Protocol. Protokol ini membolehkan pelanggan AI
 * (Kilo, Claude Desktop, dll.) memanggil kebolehan Tukuk-OS sebagai "tools".
 *
 * Protokol: JSON-RPC 2.0 ke atas stdin/stdout. Setiap baris = satu requestsatu.
 *
 * Jalankan:
 *   node mcp/server.js
 *   tukuk-os mcp
 *
 * Fail config Kilo:
 *   ~/.config/kilo/kilo.jsonc
 *   { "mcp": { "tukuk-os": { "type": "local", "command": ["tukuk-os", "mcp"] } } }
 */

const readline = require('readline');
const config = require('../src/config');
const { client } = require('../src/meili');
const crawler = require('../src/crawler');
const rag = require('../src/brain/rag');
const brain = require('../src/brain/provider');
const knowledge = require('../src/brain/knowledge');
const net = require('../src/net');
const codegen = require('../src/brain/codegen');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'tukuk-os', version: '2.0.0' };
const index = client.index(config.indexName);

function logToStderr(...args) {
  process.stderr.write(`[tukuk-os-mcp] ${args.join(' ')}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function failure(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function text(value, extra = {}) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError: Boolean(extra.isError),
    ...(extra.structuredContent ? { structuredContent: extra.structuredContent } : {})
  };
}

// Panggil LLM aktif (cloud → Ollama) untuk memperkasa rancangan/kod. Pulangkan
// { text:null, kind:'none' } bila tiada LLM — pemanggil wajib urus mod templat.
async function llm(prompt, { system, temperature, numPredict } = {}) {
  try {
    const backend = await brain.activeBackend();
    if (backend.kind === 'cloud') {
      const out = await brain.generateCloud(backend, prompt, { system, temperature, maxTokens: numPredict });
      return { text: String(out?.response || '').trim(), model: out?._model || backend.model, kind: 'cloud' };
    }
    if (backend.kind === 'ollama') {
      const out = await brain.generate(prompt, { system, temperature, numPredict });
      return { text: String(out?.response || '').trim(), model: brain.currentModel(), kind: 'ollama' };
    }
    return { text: null, model: null, kind: 'none' };
  } catch (err) {
    return { text: null, model: null, kind: 'error', error: err.message };
  }
}

const TOOLS = [
  {
    name: 'tukuk_search',
    description:
      'Cari web melalui enjin Tukuk-OS. Sokong penapis host, bahasa, jenis, susunan, facet. ' +
      'Guna alat ini apabila pengguna tanya tentang topik yang mungkin ada dalam index.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Kata kunci carian' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        host: { type: 'string', description: 'Tapis satu domain' },
        lang: { type: 'string', description: 'Tapis bahasa, cth. ms, en' },
        sort: { type: 'string', enum: ['newest', 'oldest', 'longest', 'shortest'] }
      },
      required: ['q']
    }
  },
  {
    name: 'tukuk_ask',
    description:
      'Tanya soalan dalam Bahasa Melayu. Otak Tukuk-OS akan retrieve dokumen daripada index ' +
      'lalu jana jawapan yang bersumber. Sentiasa semak medan "sources".',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Soalan untuk dijawab' } },
      required: ['question']
    }
  },
  {
    name: 'tukuk_crawl',
    description: 'Rantau (crawl) satu URL dan indekskan kandungannya. Hormati robots.txt.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL untuk dirantau' } },
      required: ['url']
    }
  },
  {
    name: 'tukuk_stats',
    description: 'Statistik Tukuk-OS: bilangan dokumen, status otak, status internet, tetapan.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tukuk_knowledge',
    description: 'Dapatkan rekod pengetahuan kendiri tentang Tukuk-OS (laluan, konfigurasi, had).',
    inputSchema: {
      type: 'object',
      properties: { section: { type: 'string', description: 'Seksyen tertentu, cth. routes' } }
    }
  },
  {
    name: 'tukuk_offline_status',
    description: 'Status sambungan internet dan sama ada mod offline aktif.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tukuk_plan',
    description:
      'Hasilkan RANCANGAN berstruktur (senarai fail + langkah) untuk membina app/game/tool. '
      + 'Jenis: game|app|node|cli|html. Jika LLM (cloud/Ollama) aktif, plan turut diperkaya nota khusus matlamat.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Apa yang nak dibina' },
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'], description: 'Jenis projek (lalai: app)' }
      },
      required: ['goal']
    }
  },
  {
    name: 'tukuk_scaffold',
    description:
      'Jana KOD pemula yang benar-benar boleh jalan (templat disahkan `node --check`/`node --test`). '
      + 'Pulangkan fail + arahan menjalankan. LLM (jika ada) menambah serampang khusus matlamat.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'] },
        goal: { type: 'string', description: 'Konteks matlamat (pilihan)' }
      },
      required: ['kind']
    }
  },
  {
    name: 'tukuk_review',
    description:
      'Semak kod: sahkan sintaks (JS/MJS guna `node --check`) + nota gaya/keselamatan ringkas. lang: js|mjs|html|txt.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Kandungan kod yang hendak disemak' },
        lang: { type: 'string', enum: ['js', 'mjs', 'html', 'txt'], default: 'js' }
      },
      required: ['code']
    }
  },
  {
    name: 'tukuk_agent',
    description:
      'Agen Tukuk Code: satu pusingan plan -> scaffold -> review -> penambahbaikan LLM (jika aktif) '
      + 'bagi sesuatu matlamat. Pulangkan fail siap + laporan sintaks. Terbaik dengan LLM cloud/Ollama; '
      + 'tanpa LLM, tetap keluarkan templat yang berfungsi.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Matlamat projek' },
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'], description: 'Jenis (lalai: app)' }
      },
      required: ['goal']
    }
  }
];

async function handle(name, args = {}) {
  switch (name) {
    case 'tukuk_search': {
      const params = {
        limit: Math.min(Number(args.limit) || 10, 50),
        attributesToCrop: ['content'],
        cropLength: 30,
        attributesToHighlight: ['title', 'description'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>'
      };
      if (args.host) params.filter = `host = "${String(args.host).replace(/"/g, '')}"`;
      else if (args.lang) params.filter = `lang = "${String(args.lang).replace(/"/g, '')}"`;
      if (args.sort === 'newest') params.sort = ['crawledAt:desc'];
      else if (args.sort === 'longest') params.sort = ['wordCount:desc'];

      const found = await index.search(String(args.q || ''), params);
      const lines = found.hits.map((hit, position) => {
        const snippet = hit._formatted?.content
          ? hit._formatted.content.replace(/<\/?mark>/g, '')
          : hit.description || '';
        return `[${position + 1}] ${hit.title}\n    ${hit.url}\n    ${snippet.slice(0, 200)}`;
      });
      const header = `${found.estimatedTotalHits ?? found.hits.length} hasil untuk "${args.q}" (${found.processingTimeMs}ms)`;
      return text([header, ...lines].join('\n'), {
        structuredContent: {
          total: found.estimatedTotalHits ?? found.hits.length,
          hits: found.hits.map((hit) => ({
            url: hit.url, title: hit.title, siteName: hit.siteName, description: hit.description
          }))
        }
      });
    }

    case 'tukuk_ask': {
      const answer = await rag.ask(args.question);
      const sources = answer.sources.map((source) => `[${source.ref}] ${source.title} — ${source.url}`).join('\n');
      return text(
        [`${answer.answer}`, '', sources ? `SUMBER:\n${sources}` : 'SUMBER: (tiada)', '', `mod: ${answer.mode} | model: ${answer.model} | ${answer.tookMs}ms`].join('\n'),
        { structuredContent: { answer: answer.answer, mode: answer.mode, sources: answer.sources } }
      );
    }

    case 'tukuk_crawl': {
      crawler.setIndex(index);
      const [outcome] = await crawler.crawlBatch([String(args.url)]);
      if (outcome.status === 'failed') {
        return text(`Gagal merayau: ${outcome.error}`, { isError: true });
      }
      return text(`Status: ${outcome.status}\nURL: ${outcome.url || args.url}\nID: ${outcome.id || '-'}`);
    }

    case 'tukuk_stats': {
      const [stats, brainHealth, network] = await Promise.all([
        index.getStats(),
        brain.health(),
        net.check()
      ]);
      return text({
        documents: stats.numberOfDocuments,
        indexSize: stats.indexSize,
        brain: { online: brainHealth.online, model: brainHealth.model, models: brainHealth.models },
        network: network.status,
        crawler: crawler.snapshot(),
        mcp: { server: SERVER_INFO.name, version: SERVER_INFO.version, tools: TOOLS.length }
      });
    }

    case 'tukuk_knowledge': {
      if (args.section && knowledge.knowledge[args.section]) {
        return text(knowledge.knowledge[args.section]);
      }
      return text(knowledge.asPrompt());
    }

    case 'tukuk_offline_status':
      return text(await net.check());

    case 'tukuk_plan': {
      const kind = codegen.normalizeKind(args.kind);
      const plan = codegen.planFor(kind, args.goal);
      const gen = await llm(
        `Kamu perancang perisian. Matlamat: "${args.goal || ''}" (jenis ${kind}). ` +
        'Senaraikan 3-6 langkah TERPENTING & idea fail tambahan secara ringkas dalam Bahasa Melayu.',
        { numPredict: 220, temperature: 0.3 }
      );
      const body = [
        `RENCANA (${kind}) — ${plan.goal}`,
        'FAIL:',
        ...plan.files.map((f) => `  - ${f.path}: ${f.purpose}`),
        'LANGKAH:',
        ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`)
      ].join('\n');
      const note = gen.text ? `\n\nNOTA LLM (${gen.model}):\n${gen.text}` : '\n\n(tiada LLM aktif — rancangan templat sahaja)';
      return text(body + note, { structuredContent: plan });
    }

    case 'tukuk_scaffold': {
      const s = codegen.scaffoldFor(args.kind, args.goal);
      const gen = await llm(
        `Matlamat: "${args.goal || ''}" (jenis ${s.kind}). Beri 1-2 idea penambahbaikan konkrit ke atas templat. Bahasa Melayu, ringkas.`,
        { numPredict: 120, temperature: 0.4 }
      );
      const blocks = s.files.map((f) => `--- ${f.path} ---\n${f.contents}`).join('\n\n');
      const hint = gen.text ? `\n\nIDEA LLM (${gen.model}):\n${gen.text}` : '';
      return text(`JENIS: ${s.kind}\nJALANKAN: ${s.run}\n\n${blocks}${hint}`, {
        structuredContent: { kind: s.kind, run: s.run, files: s.files }
      });
    }

    case 'tukuk_review': {
      const r = await codegen.review(args.code, args.lang || 'js');
      const tips = r.hints && r.hints.length ? `\nPETUNJUK:\n- ${r.hints.join('\n- ')}` : '';
      if (r.ok) return text(`SINTAKS OK (${r.lang})${tips}`, { structuredContent: r });
      return text(`SINTAKS RALAT:\n${r.error}${tips}`, { isError: true, structuredContent: r });
    }

    case 'tukuk_agent': {
      const kind = codegen.normalizeKind(args.kind);
      const plan = codegen.planFor(kind, args.goal);
      const scaffold = codegen.scaffoldFor(kind, args.goal);
      const reviews = [];
      for (const f of scaffold.files) {
        const lang = /\.(m?js|cjs)$/i.test(f.path) ? 'js' : /\.html$/i.test(f.path) ? 'html' : 'txt';
        const rr = await codegen.review(f.contents, lang);
        reviews.push({ file: f.path, ok: rr.ok, error: rr.error || null });
      }
      const allOk = reviews.every((x) => x.ok);
      const gen = await llm(
        `Matlamat: "${args.goal || ''}". Jenis: ${kind}. Beri 2-4 cadangan penambahbaikan konkrit supaya scaffold lebih dekat dengan matlamat. Bahasa Melayu, ringkas.`,
        { numPredict: 180, temperature: 0.4 }
      );
      const blocks = scaffold.files.map((f) => `--- ${f.path} ---\n${f.contents}`).join('\n\n');
      const header = [
        `TUKUK CODE AGENT — ${kind}`,
        `MATLAMAT: ${plan.goal}`,
        `STATUS SINTAKS: ${allOk ? 'SEMUA FAIL OK' : 'ADA RALAT'}`,
        `LLM: ${gen.kind}${gen.model ? ' (' + gen.model + ')' : ''}`,
        '',
        'LANGKAH RANCANGAN:',
        ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`),
        '',
        gen.text ? `CADANGAN LLM:\n${gen.text}` : 'CADANGAN LLM: (tiada LLM aktif — templat dasar sahaja)',
        '',
        `JALANKAN: ${scaffold.run}`,
        '',
        blocks
      ].join('\n');
      return text(header, {
        structuredContent: {
          kind,
          goal: plan.goal,
          files: scaffold.files,
          reviews,
          llm: { kind: gen.kind, model: gen.model || null, suggestion: gen.text || null }
        }
      });
    }

    default:
      return text(`Alat tidak dikenali: ${name}`, { isError: true });
  }
}

async function dispatch(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    });
  }

  if (method === 'notifications/initialized') return undefined;

  if (method === 'tools/list') {
    return result(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    if (id === undefined) return undefined;
    try {
      const payload = await handle(params?.name, params?.arguments);
      return result(id, payload);
    } catch (error) {
      return result(id, text(`Ralat: ${error.message}`, { isError: true }));
    }
  }

  if (id === undefined) return undefined;

  if (method === 'ping') return result(id, {});

  return failure(id, -32601, `Kaedah tidak disokong: ${method}`);
}

function main() {
  logToStderr(`dimulakan — versi ${SERVER_INFO.version}, ${TOOLS.length} alat`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closing = false;

  async function finish(message) {
    try {
      await dispatch(message);
    } catch (error) {
      logToStderr('ralat:', error.message);
      if (message.id !== undefined) failure(message.id, -32603, error.message);
    } finally {
      pending -= 1;
      // Jangan keluar sehingga semua request selesai.
      if (closing && pending === 0) process.exit(0);
    }
  }

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return failure(null, -32700, 'JSON tidak sah');
    }

    pending += 1;
    finish(message);
  });

  // Tunggu request yang sedang berjalan sebelum tutup.
  rl.on('close', () => {
    closing = true;
    if (pending === 0) process.exit(0);
  });

  process.on('SIGTERM', () => {
    closing = true;
    if (pending === 0) process.exit(0);
  });
  process.on('SIGINT', () => process.exit(0));
}

if (require.main === module) main();

module.exports = { TOOLS, handle, dispatch };