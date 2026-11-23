#!/usr/bin/env node
/**
 * Tukuk-OS MCP Server (stdio).
 *
 * MCP = Model Context Protocol. This protocol lets AI clients
 * (Kilo, Claude Desktop, etc.) call Tukuk-OS capabilities as "tools".
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout. Each line = one request.
 *
 * Run:
 *   node mcp/server.js
 *   tukuk-os mcp
 *
 * Config file for Kilo:
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
const nasa = require('../src/nasa');

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

// Call the active LLM (cloud → Ollama) to enrich plans/code. Returns
// { text:null, kind:'none' } when no LLM exists — callers must handle template mode.
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
      'Search the web through the Tukuk-OS engine. Supports host, language, type, sort and facet filters. ' +
      'Use this tool when the user asks about topics that may exist in the index.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search keywords' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        host: { type: 'string', description: 'Filter to one domain' },
        lang: { type: 'string', description: 'Filter by language, e.g. en' },
        sort: { type: 'string', enum: ['newest', 'oldest', 'longest', 'shortest'] }
      },
      required: ['q']
    }
  },
  {
    name: 'tukuk_ask',
    description:
      'Ask a question in English. The Tukuk-OS brain retrieves documents from the index ' +
      'then generates a sourced answer. Always check the "sources" field.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Question to answer' } },
      required: ['question']
    }
  },
  {
    name: 'tukuk_crawl',
    description: 'Crawl one URL and index its content. Respects robots.txt.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to crawl' } },
      required: ['url']
    }
  },
  {
    name: 'tukuk_stats',
    description: 'Tukuk-OS statistics: document count, brain status, internet status, settings.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tukuk_knowledge',
    description: 'Get the self-knowledge record about Tukuk-OS (routes, configuration, limits).',
    inputSchema: {
      type: 'object',
      properties: { section: { type: 'string', description: 'Specific section, e.g. routes' } }
    }
  },
  {
    name: 'tukuk_offline_status',
    description: 'Internet connection status and whether offline mode is active.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tukuk_plan',
    description:
      'Produce a structured PLAN (file list + steps) for building an app/game/tool. '
      + 'Kinds: game|app|node|cli|html. If an LLM (cloud/Ollama) is active, the plan is enriched with goal-specific notes.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What to build' },
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'], description: 'Project kind (default: app)' }
      },
      required: ['goal']
    }
  },
  {
    name: 'tukuk_scaffold',
    description:
      'Generate runnable starter CODE (templates validated with `node --check`/`node --test`). '
      + 'Returns files + run instructions. An LLM (if available) adds goal-specific polish.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'] },
        goal: { type: 'string', description: 'Goal context (optional)' }
      },
      required: ['kind']
    }
  },
  {
    name: 'tukuk_review',
    description:
      'Review code: verify syntax (JS/MJS via `node --check`) + brief style/security notes. lang: js|mjs|html|txt.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code content to review' },
        lang: { type: 'string', enum: ['js', 'mjs', 'html', 'txt'], default: 'js' }
      },
      required: ['code']
    }
  },
  {
    name: 'tukuk_agent',
    description:
      'Tukuk Code agent: one round of plan -> scaffold -> review -> LLM improvements (if active) '
      + 'for a goal. Returns ready files + a syntax report. Best with a cloud/Ollama LLM; '
      + 'without an LLM it still outputs working templates.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Project goal' },
        kind: { type: 'string', enum: ['game', 'app', 'node', 'cli', 'html'], description: 'Kind (default: app)' }
      },
      required: ['goal']
    }
  },
  {
    name: 'tukuk_nasa',
    description:
      'NASA live data + local archive database. topic=apod (the image of the day / a past date; ' +
      'falls back to the local archive automatically when the NASA API is down), asteroids (NeoWs feed), mars (rover photos), ' +
      'crew (who is in space right now), epic (Earth photos), solar (flares & CMEs), ' +
      'search (the NASA media library), archive (search the local DB), stats (archive size).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['apod', 'asteroids', 'mars', 'crew', 'epic', 'solar', 'search', 'archive', 'stats'] },
        date: { type: 'string', description: 'YYYY-MM-DD (apod)' },
        start: { type: 'string', description: 'start date YYYY-MM-DD (asteroids)' },
        end: { type: 'string', description: 'end date YYYY-MM-DD (asteroids)' },
        rover: { type: 'string', description: 'curiosity|perseverance (mars)' },
        sol: { type: 'integer', description: 'Martian day number (mars)' },
        q: { type: 'string', description: 'query (search/archive)' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['topic']
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
      const header = `${found.estimatedTotalHits ?? found.hits.length} results for "${args.q}" (${found.processingTimeMs}ms)`;
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
        [`${answer.answer}`, '', sources ? `SOURCES:\n${sources}` : 'SOURCES: (none)', '', `mode: ${answer.mode} | model: ${answer.model} | ${answer.tookMs}ms`].join('\n'),
        { structuredContent: { answer: answer.answer, mode: answer.mode, sources: answer.sources } }
      );
    }

    case 'tukuk_crawl': {
      crawler.setIndex(index);
      const [outcome] = await crawler.crawlBatch([String(args.url)]);
      if (outcome.status === 'failed') {
        return text(`Crawl failed: ${outcome.error}`, { isError: true });
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
        `You are a software planner. Goal: "${args.goal || ''}" (kind ${kind}). ` +
        'List the 3-6 MOST IMPORTANT steps & extra file ideas concisely in English.',
        { numPredict: 220, temperature: 0.3 }
      );
      const body = [
        `PLAN (${kind}) — ${plan.goal}`,
        'FILES:',
        ...plan.files.map((f) => `  - ${f.path}: ${f.purpose}`),
        'STEPS:',
        ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`)
      ].join('\n');
      const note = gen.text ? `\n\nLLM NOTE (${gen.model}):\n${gen.text}` : '\n\n(no active LLM — template plan only)';
      return text(body + note, { structuredContent: plan });
    }

    case 'tukuk_scaffold': {
      const s = codegen.scaffoldFor(args.kind, args.goal);
      const gen = await llm(
        `Goal: "${args.goal || ''}" (kind ${s.kind}). Give 1-2 concrete improvement ideas for the template. English, concise.`,
        { numPredict: 120, temperature: 0.4 }
      );
      const blocks = s.files.map((f) => `--- ${f.path} ---\n${f.contents}`).join('\n\n');
      const hint = gen.text ? `\n\nLLM IDEAS (${gen.model}):\n${gen.text}` : '';
      return text(`KIND: ${s.kind}\nRUN: ${s.run}\n\n${blocks}${hint}`, {
        structuredContent: { kind: s.kind, run: s.run, files: s.files }
      });
    }

    case 'tukuk_review': {
      const r = await codegen.review(args.code, args.lang || 'js');
      const tips = r.hints && r.hints.length ? `\nHINTS:\n- ${r.hints.join('\n- ')}` : '';
      if (r.ok) return text(`SYNTAX OK (${r.lang})${tips}`, { structuredContent: r });
      return text(`SYNTAX ERROR:\n${r.error}${tips}`, { isError: true, structuredContent: r });
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
        `Goal: "${args.goal || ''}". Kind: ${kind}. Give 2-4 concrete improvement suggestions so the scaffold gets closer to the goal. English, concise.`,
        { numPredict: 180, temperature: 0.4 }
      );
      const blocks = scaffold.files.map((f) => `--- ${f.path} ---\n${f.contents}`).join('\n\n');
      const header = [
        `TUKUK CODE AGENT — ${kind}`,
        `GOAL: ${plan.goal}`,
        `SYNTAX STATUS: ${allOk ? 'ALL FILES OK' : 'ERRORS FOUND'}`,
        `LLM: ${gen.kind}${gen.model ? ' (' + gen.model + ')' : ''}`,
        '',
        'PLAN STEPS:',
        ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`),
        '',
        gen.text ? `LLM SUGGESTIONS:\n${gen.text}` : 'LLM SUGGESTIONS: (no active LLM — basic templates only)',
        '',
        `RUN: ${scaffold.run}`,
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

    case 'tukuk_nasa': {
      const topic = String(args.topic || 'apod');
      const limit = Math.min(Number(args.limit) || 10, 100);
      if (topic === 'apod') {
        const data = await nasa.getAPOD({ date: args.date });
        return text(`APOD ${data.date} — ${data.title}\n${(data.explanation || '').slice(0, 1200)}\nMedia: ${data.url}${data.fromArchive ? '\n(from the local archive — the NASA API is down)' : ''}`, { structuredContent: data });
      }
      if (topic === 'asteroids') {
        const data = await nasa.getNearEarthObjects({ startDate: args.start, endDate: args.end });
        return text(`${data.element_count} near-Earth objects (${data.start_date} → ${data.end_date}, source ${data.source})`, { structuredContent: { ...data, asteroids: (data.asteroids || []).slice(0, limit) } });
      }
      if (topic === 'mars') {
        const data = await nasa.getMarsPhotos({ rover: args.rover, sol: args.sol });
        return text(`${data.totalPhotos} photos from ${data.rover} (source ${data.source})`, { structuredContent: { ...data, photos: (data.photos || []).slice(0, limit) } });
      }
      if (topic === 'crew') {
        const data = await nasa.getCrew();
        const nama = (data.people || []).map((p) => `${p.name} (${p.craft})`).join(', ');
        return text(`${data.inSpace} humans in space right now: ${nama}${data.stale ? ' (last known copy)' : ''}`, { structuredContent: data });
      }
      if (topic === 'epic') {
        const data = await nasa.getEPIC({ date: args.date });
        return text(`${(data || []).length} newest EPIC Earth images`, { structuredContent: (data || []).slice(0, limit) });
      }
      if (topic === 'solar') {
        const data = await nasa.getSolarActivity({ days: args.limit ? Number(args.limit) * 7 : undefined });
        return text(JSON.stringify(data, null, 2).slice(0, 3000), { structuredContent: data });
      }
      if (topic === 'search') {
        const data = await nasa.searchNASAMedia(String(args.q || ''), { mediaType: 'image' });
        const lines = data.items.slice(0, limit).map((m, i) => `[${i + 1}] ${m.title}\n    ${m.asset_url}`);
        return text([`${data.total} results for "${args.q}":`, ...lines].join('\n'), { structuredContent: data });
      }
      if (topic === 'archive') {
        // The local archive DB — fast, no NASA API call.
        const items = nasa.store.listApod({ limit, q: args.q });
        const lines = items.map((e, i) => `[${i + 1}] ${e.date} — ${e.title}`);
        return text([`${items.length} APOD archive entries${args.q ? ` for "${args.q}"` : ''}:`, ...lines].join('\n'), { structuredContent: { items } });
      }
      if (topic === 'stats') {
        return text(JSON.stringify(nasa.store.stats(), null, 2), { structuredContent: nasa.store.stats() });
      }
      return text(`Unknown NASA topic: ${topic}`, { isError: true });
    }

    default:
      return text(`Unknown tool: ${name}`, { isError: true });
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
      return result(id, text(`Error: ${error.message}`, { isError: true }));
    }
  }

  if (id === undefined) return undefined;

  if (method === 'ping') return result(id, {});

  return failure(id, -32601, `Unsupported method: ${method}`);
}

function main() {
  logToStderr(`started — version ${SERVER_INFO.version}, ${TOOLS.length} tools`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closing = false;

  async function finish(message) {
    try {
      await dispatch(message);
    } catch (error) {
      logToStderr('error:', error.message);
      if (message.id !== undefined) failure(message.id, -32603, error.message);
    } finally {
      pending -= 1;
      // Do not exit until all requests are done.
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
      return failure(null, -32700, 'Invalid JSON');
    }

    pending += 1;
    finish(message);
  });

  // Wait for in-flight requests before closing.
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