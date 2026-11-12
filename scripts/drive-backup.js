#!/usr/bin/env node
/**
 * The nightly off-site backup. A 4 GB VPS with one disk is one `rm -rf` away
 * from zero: everything this site has learned — feed histories, the books
 * mirror, the store, the built shelves — lives in data/ and in git, and both
 * live on the same box. This script copies them somewhere Google keeps them:
 *
 *   1. tar.gz of data/            (runtime state; gitignored, exists only here)
 *   2. `git bundle` of main       (the code, in one file, verified by git itself)
 *   3. upload both to the shared Drive folder, named by date
 *   4. prune: keep the newest KEEP backups per prefix
 *   5. write data/backup-last.json — the tile the admin panel reads
 *
 * Quiet by design: it runs from a systemd timer at low priority, and its only
 * console output is one line of journal per run. Never rejects: a night with
 * no network is recorded in backup-last.json, not crashed.
 *
 * Run by hand (same env the timer gets, via .env):
 *   node scripts/drive-backup.js [--dry]   --dry builds the archives, uploads nothing
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const gdrive = require('../src/gdrive.js');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'backup-last.json');
const KEY_PATH = process.env.GDRIVE_KEY_PATH || '/etc/tukuk-os/gdrive-key.json';
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '';
const KEEP = 14; // per prefix: two weeks of dailies at ~5 MB each is well inside 15 GB

const stamp = new Date().toISOString().slice(0, 10); // 2026-11-03
const tmpDir = path.join('/tmp', `tukuk-backup-${stamp}`);

function log(msg) {
  console.log(`[drive-backup] ${msg}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

/** 1+2: build the two archives. Throws only if there is genuinely nothing to back up. */
function buildArchives() {
  fs.mkdirSync(tmpDir, { recursive: true });
  const dataTar = path.join(tmpDir, `tukuk-data-${stamp}.tar.gz`);
  // -h follows nothing, excludes the backup's own state file and the transient
  // load samples: they are re-derivable and only bloat the archive.
  execFileSync('tar', ['czf', dataTar, '-C', ROOT,
    '--exclude=data/backup-last.json', '--exclude=data/load-snapshot.json',
    '--exclude=data/load-alerts.json', '--exclude=data/*.tmp', 'data'], { stdio: 'inherit' });
  const bundle = path.join(tmpDir, `tukuk-code-${stamp}.bundle`);
  execFileSync('git', ['-C', ROOT, 'bundle', 'create', bundle, 'main'], { stdio: 'inherit' });
  execFileSync('git', ['-C', ROOT, 'bundle', 'verify', bundle], { stdio: 'inherit' });
  return [dataTar, bundle];
}

function cleanup() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* /tmp cleans itself eventually */ }
}

function writeState(record) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    log(`state file unwritable: ${e.message}`);
  }
}

function previousState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

/** 4: newest-first pruning; a failure here must not lose the fresh uploads. */
async function prune(token) {
  if (!FOLDER_ID) return;
  try {
    const files = await gdrive.listRecent(token, FOLDER_ID, 200);
    const seen = { 'tukuk-data-': 0, 'tukuk-code-': 0 };
    for (const f of files) {
      const prefix = Object.keys(seen).find((p) => String(f.name || '').startsWith(p));
      if (!prefix) continue;
      seen[prefix] += 1;
      if (seen[prefix] <= KEEP) continue;
      await new Promise((resolve, reject) => {
        const req = require('https').request({
          hostname: 'www.googleapis.com',
          path: `/drive/v3/files/${encodeURIComponent(f.id)}`,
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', reject);
        req.end();
      });
      log(`pruned ${f.name}`);
    }
  } catch (e) {
    log(`prune skipped: ${e.message}`);
  }
}

(async () => {
  const dry = process.argv.includes('--dry');
  const state = { at: new Date().toISOString(), ok: false, dry, files: [], error: null };
  try {
    const archives = buildArchives();
    for (const file of archives) {
      const info = { name: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256(file) };
      state.files.push(info);
      log(`built ${info.name} (${Math.round(info.bytes / 1024)} KB, ${info.sha256})`);
    }
    if (dry) {
      state.ok = true;
      state.error = null;
      log('--dry: archives built, nothing uploaded');
    } else if (!fs.existsSync(KEY_PATH)) {
      state.error = `no key at ${KEY_PATH} — see deploy/install-drive-backup.sh`;
      log(state.error);
    } else if (!FOLDER_ID) {
      state.error = 'GDRIVE_FOLDER_ID unset — share a Drive folder with the bot and put its id in .env';
      log(state.error);
    } else {
      const token = await gdrive.accessToken(KEY_PATH);
      for (const entry of state.files) {
        const buf = fs.readFileSync(path.join(tmpDir, entry.name));
        const mime = entry.name.endsWith('.bundle') ? 'application/octet-stream' : 'application/gzip';
        const uploaded = await gdrive.upload(token, entry.name, FOLDER_ID, buf, mime);
        entry.driveId = uploaded.id;
        log(`uploaded ${entry.name} -> ${uploaded.id}`);
      }
      await prune(token);
      state.ok = true;
    }
  } catch (e) {
    state.error = String(e.message || e).slice(0, 300);
    log(`failed: ${state.error}`);
  } finally {
    cleanup();
  }
  state.sinceLastOk = previousState() && previousState().ok
    ? Math.round((Date.parse(state.at) - Date.parse(previousState().at)) / 1000)
    : null;
  writeState(state);
  process.exit(state.ok ? 0 : 1);
})();
