// Throwaway: read a /ask JSON body from stdin, print sources + answer for QA.
let d = '';
process.stdin.on('data', (c) => { d += c; });
process.stdin.on('end', () => {
  let j; try { j = JSON.parse(d); } catch (e) { console.log('raw:', d.slice(0, 240)); return; }
  console.log('mode=', j.mode, '| model=', j.model, '| tookMs=', j.tookMs, '| sources=', (j.sources || []).length);
  (j.sources || []).slice(0, 5).forEach((s, i) => console.log(`  src[${i}] ${String(s.title || '').slice(0, 60)} :: ${String(s.url || '').slice(0, 55)}`));
  console.log('ANSWER:', String(j.answer || '').slice(0, 300));
});
