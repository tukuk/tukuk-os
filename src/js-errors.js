// js-errors.js — the visitor error log behind /api/js-error.
//
// public/theme.js sends up to eight reports per page load: uncaught errors, resources that
// failed to load, unhandled rejections. It is the only record of what a browser actually did
// on a page — the server log proves the HTML was sent, not that the script on it ran.
//
// The merge used to bump `count` and `lastAt` on the entry it found and then return without
// writing: the increment lived in a list that was thrown away immediately after. So every
// entry sat at count 1 with the timestamp of its FIRST sighting, and reading the file could
// not distinguish "it happened once, on 8 Oct" from "it happens on every visit" — which is
// exactly the question the log exists to answer.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { truncate } = require('./util');

const MAX = 300;
const DEFAULT_FILE = path.join(path.dirname(config.store.path), 'js-errors.json');

/** Read the log. A missing or unreadable file is an empty log, never an exception. */
function read(file = DEFAULT_FILE) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Write the log atomically (tmp + rename), as every other file under data/ is written. */
function write(list, file = DEFAULT_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(list.slice(0, MAX), null, 2));
  fs.renameSync(temporary, file);
}

/**
 * Record one report. An identical message+page bumps `count` and `lastAt` and moves to the
 * front, so an error that keeps happening survives the cap and a one-off ages out of it.
 * @param {{message?: string, page?: string, kind?: string, source?: string, line?: number, col?: number, ua?: string}} input
 * @returns {object|null} the entry as it now stands in the log, or null when there was no message
 */
function record(input, file = DEFAULT_FILE) {
  const source = input && typeof input === 'object' ? input : {};
  // Whitespace is not a message: it would create an entry nothing can be read or fixed from.
  const message = truncate(String(source.message || '').trim(), 400);
  if (!message) return null;
  const at = new Date().toISOString();
  const entry = {
    at,
    page: truncate(String(source.page || ''), 300),
    kind: truncate(String(source.kind || 'error'), 20),
    message,
    source: truncate(String(source.source || ''), 300),
    line: Number(source.line) || 0,
    col: Number(source.col) || 0,
    ua: truncate(String(source.ua || ''), 200)
  };

  const list = read(file);
  const index = list.findIndex((e) => e.message === entry.message && e.page === entry.page);
  let stored;
  if (index > -1) {
    stored = list.splice(index, 1)[0];
    stored.count = (Number(stored.count) || 1) + 1;
    stored.lastAt = at;
    list.unshift(stored);
  } else {
    stored = { ...entry, count: 1 };
    list.unshift(stored);
  }
  write(list, file);
  return stored;
}

module.exports = { MAX, DEFAULT_FILE, read, record };
