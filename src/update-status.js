'use strict';
// ── WHAT THE :07/:37 UPDATE ACTUALLY DID ───────────────────────────────────────
//
// The auto-update is invisible by design: a timer pulls, restarts, and says nothing.
// That silence is also the failure mode. On 24 Oct 2026 a `git fetch` wedged for 31
// hours inside the oneshot unit — no new commit, no restart, no error anyone could see
// — and the only reason it was found at all is that somebody was looking at a page that
// had started answering 503. "Nothing happened" and "the timer died in March" look
// exactly the same from outside.
//
// So scripts/auto-update.sh drops one small record of its last attempt into the data
// directory, and /health reports it. The fields are a fixed whitelist — stage, result,
// the two commits, how long it took and when. Nothing from the box's stderr is copied
// out, because /health is public and error text is where paths and hostnames leak.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = process.env.UPDATE_STATUS_PATH || path.join(path.dirname(config.store.path), 'update-status.json');

// The timer runs every 30 minutes; four hours without a record is a dead timer, not a
// slow cycle — a legitimate run writes one within its 10-minute fetch bound at latest.
const STALE_MS = 4 * 60 * 60 * 1000;

/** Trim to a printable token: a commit hash or a stage name, never free text. */
function token(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || !/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s.slice(0, maxLen);
}

/**
 * Read the last update record.
 * @param {string} [file] override for tests
 * @returns {{at:string|null,ok:boolean,stage:string|null,from:string|null,to:string|null,
 *            seconds:number|null,ageSeconds:number|null,stale:boolean}|null} null = never ran
 */
function read(file = FILE) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const at = typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at)) ? new Date(Date.parse(raw.at)).toISOString() : null;
  const ageMs = at ? Math.max(0, Date.now() - Date.parse(at)) : null;
  const seconds = Number(raw.seconds);
  return {
    at,
    ok: raw.ok === true,
    stage: token(raw.stage, 20),
    from: token(raw.from, 40),
    to: token(raw.to, 40),
    seconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    // No timestamp is as bad as an old one: the record exists, so the unit ran at
    // least once — but it cannot tell us when, and a status we cannot date is stale.
    stale: ageMs === null ? true : ageMs > STALE_MS,
  };
}

module.exports = { read, FILE, STALE_MS };
