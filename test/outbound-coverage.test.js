'use strict';
/*
 * Coverage rule for the outbound guard: no module may wait longer than ten seconds for somebody
 * else's computer without going through src/outbound.js.
 *
 * This test exists because the first pass at the guard missed three modules. The weight report
 * (scripts/weight-report.sh) printed `/wang/kadar  15.018 s  status=503` among the ten slowest
 * requests — the identical failure shape that motivated the guard for /muzik — and it was only
 * found because the numbers were finally in one place. A reviewer checking "did we guard muzik?"
 * would have missed it again, so the check is mechanical: every axios timeout above 10 s must
 * sit in a file that calls attachGuard.
 *
 * The threshold is not arbitrary. weather.js (10 s) and crawler.js (8 s) are the two modules that
 * stay outside the guard on purpose — they run their own outage policy (a 429 circuit breaker plus
 * a daily budget, and a politeness delay with a bounded worker pool) and neither appears in the
 * measured tail. Leaving them out is documented in src/outbound.js's header; keeping them under
 * the threshold is what makes this test need no exemption list.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const OVER_TEN = /timeout:\s*(\d{4,})/g;

test('every axios instance that can wait >10s is behind the outbound guard', () => {
  const offenders = [];
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'outbound.js')) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    if (!text.includes('axios.create')) continue;          // not an upstream client module
    let longest = 0;
    for (const m of text.matchAll(OVER_TEN)) longest = Math.max(longest, Number(m[1]));
    if (longest > 10000 && !text.includes('attachGuard')) offenders.push(`${file} (waits up to ${longest} ms)`);
  }
  assert.deepEqual(offenders, [], `these modules can hold a request over 10 s with no deadline,
cooldown or dedupe: ${offenders.join(', ')} — attach attachGuard(http, { name: ... }) or document
why the module must own its own outage policy (see weather.js).`);
});

test('the guard is registered for each module the survey blamed by name', () => {
  // The ten slowest requests in the 23 Oct window came from these four families. If one of these
  // names disappears from /health's `outbound` list, the guard for it was dropped by accident.
  const expected = ['wang', 'nasa-api', 'nasa-assets'];
  const { guardedStats } = require('../src/outbound');
  require('../src/wang'); require('../src/nasa');
  const names = guardedStats().map((s) => s.name);
  for (const n of expected) assert.ok(names.includes(n), `${n} is not guarded — /health would not list it`);
});
