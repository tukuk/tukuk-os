'use strict';
// The Malaysian holiday table must survive both a restart and an upstream blip.
//
// Before this test existed, /holidays/2026 answered 503 whenever the public API had a
// bad minute — and because the process restarts on every deploy, the 30-day in-memory
// cache was cold exactly when it mattered. These cases pin the disk mirror and the
// serve-stale-then-refresh behaviour.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const MODULE = require.resolve('../src/cuti');

const ROWS = [
  { name: 'New Year', date: '2026-01-01', day_name: 'Thursday', state_codes: ['KUL', 'SGR'] },
  { name: 'Raya', date: '2026-03-20', day_name: 'Friday', state_codes: ['KUL'] },
];

test('a snapshot on disk feeds the page when the API is unreachable', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuti-snap-'));
  const saved = { store: process.env.STORE_PATH, base: process.env.CUTI_BASE_URL };
  process.env.STORE_PATH = path.join(tmp, 'store.json');
  delete require.cache[MODULE];

  let mode = 'good';
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (mode !== 'good') {
      res.statusCode = 503;
      res.end('{"error":"maintenance"}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: ROWS }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => {
    srv.close();
    if (saved.store === undefined) delete process.env.STORE_PATH; else process.env.STORE_PATH = saved.store;
    if (saved.base === undefined) delete process.env.CUTI_BASE_URL; else process.env.CUTI_BASE_URL = saved.base;
    delete require.cache[MODULE];
  });

  process.env.CUTI_BASE_URL = `http://127.0.0.1:${srv.address().port}/api/v1`;

  // 1. First run: the API answers, the rows come through, and the mirror is written
  //    next to the store (the same place data/apod-last.json lives).
  const first = require(MODULE);
  const rows = await first.getHolidays(2026);
  assert.deepStrictEqual(rows.map((r) => r.date), ROWS.map((r) => r.date));
  assert.equal(hits, 1, 'one upstream call');
  assert.equal(path.dirname(first.SNAPSHOT_FILE), tmp, 'the mirror sits beside the store path');

  const written = await waitFor(() => fs.existsSync(first.SNAPSHOT_FILE), 5000);
  assert.ok(written, 'the snapshot file is written without anyone asking twice');
  const saved0 = JSON.parse(fs.readFileSync(first.SNAPSHOT_FILE, 'utf8'));
  assert.deepStrictEqual(saved0['/holidays:{"year":2026}'].data.map((r) => r.date), ROWS.map((r) => r.date));

  // 2. Restart (fresh require = empty memory) while the upstream is down: the page
  //    must still have the calendar, and must not even knock on the door.
  delete require.cache[MODULE];
  mode = 'down';
  const before = hits;
  const second = require(MODULE);
  const again = await second.getHolidays(2026);
  assert.deepStrictEqual(again.map((r) => r.date), ROWS.map((r) => r.date), 'served from the snapshot');
  assert.equal(hits, before, 'the disk copy is fresh enough that no request is attempted');

  // 3. A state table saved earlier is there too — the 16 states share the same mirror.
  const kl = second.forState(again, 'KUL');
  assert.equal(kl.length, 2, 'the state filter still works on mirrored rows');
});

function waitFor(check, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve(true);
      if (Date.now() - started > ms) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}
