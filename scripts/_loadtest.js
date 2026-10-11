// Throwaway bounded-concurrency probe for the chat (/ask) path.
// Fires N grounded /ask at once against localhost while heart-beating /search.
// NOT a flood — just enough to expose the Ollama single-slot serialization.
const http = require('http');

function get(path, timeoutMs) {
  return new Promise((resolve) => {
    const t = Date.now();
    const req = http.get({ host: '127.0.0.1', port: 3000, path, timeout: timeoutMs }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) {}
        resolve({ status: r.statusCode, ms: Date.now() - t, j });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', ms: Date.now() - t }); });
    req.on('error', (e) => resolve({ status: 'ERR', ms: Date.now() - t, err: e.message }));
  });
}

const qs = [
  'apa itu enjin carian web',
  'apa itu DNS',
  'apa itu cloudflare worker',
  'apa itu sqlite',
  'apa itu http2',
  'apa itu redis cache',
];

(async () => {
  const searchTimes = [];
  const hb = setInterval(async () => {
    const r = await get('/search?q=kopi', 10000);
    searchTimes.push(r.ms);
  }, 3000);

  const t0 = Date.now();
  const results = await Promise.all(qs.map((q) => get('/ask?q=' + encodeURIComponent(q), 120000)));
  clearInterval(hb);

  console.log(`wall_ms=${Date.now() - t0}`);
  let gen = 0, ext = 0;
  results.forEach((r, i) => {
    const j = r.j || {};
    const method = j.method || '?';
    if (method === 'llm') gen++; else ext++;
    console.log(`[${i}] "${qs[i]}" status=${r.status} appTookMs=${j.tookMs} model=${j.model} mode=${j.mode} method=${method}`);
  });
  console.log(`generated=${gen} extractive_fallback=${ext}`);
  console.log(`search_heartbeat_ms=${searchTimes.join(',')}`);
})();
