// Accessibility audit against the real pages, using axe-core over raw CDP (no puppeteer).
//
//   google-chrome --headless=new --remote-debugging-port=9333 \
//                 --user-data-dir=/tmp/cdp-a11y about:blank &
//   npm install --no-save axe-core@4        # the audit tool is not a runtime dependency
//   node scripts/a11y-audit.js https://tukuk.org/ https://tukuk.org/os ...
//
// Modes:
//   (default)   one block per page: each violation, its impact, node count, the first four
//               selectors and axe's own failure summary, then rule totals across all pages.
//   --rule=ID   every node behind one rule, with a snippet — for aiming a fix at the elements
//               the summary only samples.
//   --contrast  every colour-contrast node with the fg/bg axe measured, the ratio, the font
//               size and weight, so a palette change can be judged instead of guessed.
//
// Nothing is fixed here: this is the measurement the fixes are judged against, run before and
// after the same way.
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9333);
const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules/axe-core/axe.min.js'), 'utf8');
const args = process.argv.slice(2);
const RULE = (args.find((a) => a.startsWith('--rule=')) || '').slice(7) || null;
const CONTRAST = args.includes('--contrast');
const URLS = args.filter((a) => !a.startsWith('--'));
if (!URLS.length) URLS.push('https://tukuk.org/', 'https://tukuk.org/about', 'https://tukuk.org/privacy', 'https://tukuk.org/wiki');

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let s = ''; r.on('data', (d) => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ver = await getJson('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const handlers = {};
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method) (handlers[m.method] || []).forEach((h) => h(m.params));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const runOnly = RULE ? `runOnly: ['${RULE}']` : (CONTRAST ? "runOnly: ['color-contrast']" : '');
  const report = {};

  for (const url of URLS) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    const loaded = new Promise((res) => { handlers['Page.loadEventFired'] = [res]; });
    await send('Page.navigate', { url }, sessionId);
    await Promise.race([loaded, sleep(20000)]);
    await sleep(2500); // let client-rendered blocks (feeds, charts, ads) settle

    const expr = `(async () => {
      ${AXE}
      const r = await axe.run(document, { resultTypes: ['violations'], ${runOnly} });
      return JSON.stringify(r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
        all: v.nodes.map((n) => n.target.join(' ') + '  <<' + String(n.html).slice(0, 100) + '>>'),
        colors: v.nodes.map((n) => {
          const d = (n.any[0] && n.any[0].data) || {};
          return n.target.join(' ') + '  ' + (d.contrastRatio || '?') + ' < ' + (d.expectedContrastRatio || '?') +
            '  ' + (d.fgColor || '?') + ' on ' + (d.bgColor || '?') + '  ' + (d.fontSize || '?') + '/' + (d.fontWeight || '?') +
            '  <<' + String(n.html).slice(0, 100) + '>>';
        }),
        sample: (v.nodes[0] && v.nodes[0].failureSummary) || ''
      })).sort((a, b) => b.nodes - a.nodes));
    })()`;
    const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    const value = out.result && out.result.value;
    report[url] = value ? JSON.parse(value) : { error: JSON.stringify(out).slice(0, 400) };
    await send('Target.closeTarget', { targetId });
  }

  for (const [url, violations] of Object.entries(report)) {
    console.log(`\n=== ${url}`);
    if (!Array.isArray(violations)) { console.log('  no result:', JSON.stringify(violations)); continue; }
    if (!violations.length) { console.log('  clean'); continue; }
    for (const v of violations) {
      console.log(`  [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}`);
      if (CONTRAST) for (const line of v.colors) console.log(`     ${line}`);
      else if (RULE) for (const line of v.all) console.log(`     ${line}`);
      else {
        console.log(`     ${v.targets.join(' | ')}`);
        if (v.sample) console.log(`     ${String(v.sample).split('\n')[0].slice(0, 160)}`);
      }
    }
  }

  if (!RULE && !CONTRAST) {
    const ids = {};
    for (const v of Object.values(report)) if (Array.isArray(v)) for (const x of v) ids[x.id] = (ids[x.id] || 0) + x.nodes;
    console.log('\n=== rule totals across pages');
    if (!Object.keys(ids).length) console.log('  none');
    for (const [k, n] of Object.entries(ids).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
  }
  process.exit(0);
})().catch((e) => { console.error('a11y audit failed:', e.message); process.exit(1); });
