#!/usr/bin/env node
'use strict';
// check-shell-vars.js — find the bug class `bash -n` cannot see: a variable READ under `set -u`
// that the script never assigns. Two real rebuilds on a fresh box were killed by exactly this
// (`CFGRID`, then `CFID` for `CFGID`), and in both cases the script died mid-restore, leaving the
// server half-built with a plausible-looking log.
//
// Deliberately approximate: it strips comments naively and does not parse functions, so it is a
// linter for one narrow class, not a shellcheck replacement. `${NAME:-default}` reads are treated
// as optional and never flagged, because by definition they cannot be fatal. Quoted heredoc bodies
// are blanked (bash performs no expansion there, so `$GODOT_HEAD_INCLUDE` inside `python3 <<'PY'`
// is a Python string, not a shell read). Unquoted heredocs are kept, because they DO expand, and
// so are multi-line `node -e '...'` programs only from the closing quote onward.
const fs = require('node:fs');

// Values bash or the calling environment legitimately provides.
const ENV_NAMES = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'HOSTNAME', 'PWD', 'OLDPWD', 'EUID', 'UID', 'IFS',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'EDITOR', 'PAGER', 'NODE_ENV', 'NODE_OPTIONS',
  'COLUMNS', 'LINES', 'BASH_SOURCE', 'BASH_EXECUTION_STRING', 'FUNCNAME', 'RANDOM', 'SECONDS',
  'LINENO', 'PIPESTATUS', 'REPLY', 'OPTIND', 'OPTARG', 'BASHOPTS', 'SHELLOPTS', 'PPID', 'PS4',
  'SSH_TTY', 'SSH_CONNECTION', 'SUDO_USER', 'SUDO_UID', 'SUDO_GID', 'MAIL', 'SHLVL', '_',
  // operators and callers hand these to the install scripts on purpose
  'TUKUK_AUTO_SETUP', 'TUKUK_SETUP_RUNNING', 'TUKUK_INSTALL_DIR', 'IDENTITY_KEY_FILE',
  'INSTALL_GAME', 'STATION_BREAK_DIR', 'GODOT_BIN', 'WEB_BUILD_LOG', 'WEB_HEAD',
  'TUKUK_GAME_BUNDLE', 'TUKUK_PLAY_DIR', 'ALLOW_BIG_PACK', 'SKIP_EDGE_CHECK', 'SKIP_LOCAL_CHECK',
  'FORCE_NET', 'FORCE_DATA', 'CF_TUNNEL_TOKEN', 'CF_TUNNEL_ID', 'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID', 'MEILI_MASTER_KEY', 'MEILI_HOST', 'R2_BUCKET', 'BACKUP_WORKER_URL',
  'BACKUP_UPLOAD_SECRET', 'GIT_BRANCH', 'NPM_CONFIG_PREFIX', 'npm_config_', 'CI',
  // R2 S3 credentials, read by the backup/restore scripts when wrangler is the upload path
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
]);

// Return a line-aligned copy of `lines` with everything bash does NOT expand replaced by empty
// strings (or trimmed), so those `$TOKENS` are invisible to the scan while every reported line
// number stays truthful.
function blankNonShellText(lines) {
  const out = [];
  let delim = null;
  let quote = false; // inside a multi-line single-quoted program passed to an interpreter
  const INTERP = /\b(?:node|python3?|perl|awk|sed|jq|bash|sh)\s+(?:-\S+\s+)*'/;
  for (const raw of lines) {
    if (delim !== null) {
      out.push('');
      if (raw.replace(/^\t+/, '') === delim) delim = null;
      continue;
    }
    if (quote) {
      // Everything up to and including the closing quote is literal; the tail is shell again.
      const at = raw.indexOf("'");
      if (at === -1) { out.push(''); continue; }
      quote = false;
      out.push(raw.slice(at + 1));
      continue;
    }
    out.push(raw);
    const m = raw.match(/<<-?\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/);
    if (m) { delim = m[1]; continue; }
    // `node -e '` style programs span several lines and are full of `$x` that bash never sees.
    // Only this narrow shape is trusted, because counting apostrophes in prose would misfire.
    if (INTERP.test(raw) && (raw.match(/'/g) || []).length % 2 === 1) {
      const at = raw.lastIndexOf("'");
      out[out.length - 1] = raw.slice(0, at);
      quote = true;
    }
  }
  return out;
}

function scan(text) {
  const assigned = new Set();
  const reads = new Map();
  const lines = text.split('\n');
  const scannable = blankNonShellText(lines);
  scannable.forEach((raw, i) => {
    const no = i + 1;
    if (/^\s*#/.test(raw)) return;
    const line = raw.replace(/(?<!["\\])#(?![^"']*["'][^"']*$).*$/, '');
    // assignments, loop variables, and read targets
    for (const m of line.matchAll(/(?:^|[\s;(:=])((?:export |local |readonly |declare |typeset )?)([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      assigned.add(m[2]);
    }
    // declarations without a value: `local -a files`, `local f`, `declare -rx PATHS`, `export FOO`
    for (const m of line.matchAll(/\b(?:local|declare|typeset|export|readonly)\s+(?:-\S+\s+)*([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      assigned.add(m[1]);
    }
    // `mapfile -t URLS < <(...)` and `readarray -O 0 LINES` fill the named array
    for (const m of line.matchAll(/\b(?:mapfile|readarray)\s+(?:-\S+\s+)*([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      assigned.add(m[1]);
    }
    for (const m of line.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) assigned.add(m[1]);
    for (const m of line.matchAll(/\bselect\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) assigned.add(m[1]);
    // `read -r slug pkg label url` assigns EVERY target, not just the first
    for (const m of line.matchAll(/\bread\s+(?:-\S+\s+)*((?:[A-Za-z_][A-Za-z0-9_]*\s+)*[A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      for (const n of m[1].split(/\s+/)) assigned.add(n);
    }
    // reads: $NAME and ${NAME...}. Skip the ones that carry a default, which cannot be unbound.
    // Single-quoted spans are removed first: bash expands nothing inside them, so `$NF` in an awk
    // program is an awk field count, not a shell read of a variable the script forgot to set.
    const readScope = line.replace(/'[^']*'/g, "''");
    for (const m of readScope.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[-=?+])?/g)) {
      const name = m[1];
      const optional = /:\-|:=|\?\+|:\+/.test(m[0].slice(name.length + 1));
      if (optional) continue;
      if (!reads.has(name)) reads.set(name, no);
    }
  });
  const out = [];
  for (const [name, at] of reads) {
    if (assigned.has(name) || ENV_NAMES.has(name)) continue;
    out.push({ name, at });
  }
  return out;
}

module.exports = { scan };

if (require.main === module) {
  let bad = 0;
  for (const file of process.argv.slice(2)) {
    const found = scan(fs.readFileSync(file, 'utf8'));
    if (!found.length) { console.log(`OK   ${file}`); continue; }
    bad++;
    console.log(`VARS ${file}`);
    for (const f of found) console.log(`       $${f.name} read at line ${f.at} with no assignment and no default`);
  }
  process.exit(bad ? 1 : 0);
}
