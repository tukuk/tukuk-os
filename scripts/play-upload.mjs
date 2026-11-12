#!/usr/bin/env node
// play-upload.mjs — Upload the T Chat AAB + metadata to Google Play (Internal testing)
// via the Play Developer API. NO Ruby/fastlane needed (this project is Node).
//
// PREREQUISITES (once, by you):
//   1. Google Cloud → IAM & admin → Service Accounts → Create (e.g. "play-ci").
//   2. Open that project → API & Services → Enable "Google Play Android Developer API".
//   3. Service Account → Keys → Add key → JSON → download.
//   4. Save that JSON file as  ./google-cloud-key.json  (already gitignored).
//   5. Play Console → Users and permissions → Invite new user → the service
//      account email (long string @<project>.iam.gserviceaccount.com) → grant
//      "Manage internal app testing" + view app information.
//   6. `npm install googleapis` (once), then:
//        node scripts/play-upload.mjs
//
// This script: upload the AAB → set the "internal" track (status completed = internal
// release) → paste the EN+MS title/description from fastlane/metadata. Idempotent-ish
// (create edit → commit). Fails early with a clear message if a prerequisite is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = path.join(ROOT, 'google-cloud-key.json');
const AAB = path.join(ROOT, 'public/downloads/tukuk-chat.aab');
const PKG = 'org.tukuk.chat';
const TRACK = process.env.PLAY_TRACK || 'internal';
const STATUS = process.env.PLAY_STATUS || 'completed'; // completed | draft | inProgress
const META = path.join(ROOT, 'fastlane/metadata/android');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
let google;
try { ({ google } = await import('googleapis')); }
catch { die('googleapis not installed yet — run: npm install googleapis'); }
if (!fs.existsSync(KEY) && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // No key file — we will try ADC (gcloud application-default login) below.
  console.log('· (no google-cloud-key.json — will use ADC if present)');
}
if (!fs.existsSync(AAB)) die(`no ${path.relative(ROOT, AAB)} — run: bash scripts/build-apk.sh`);

const SCOPES = ['https://www.googleapis.com/auth/androidpublisher'];
let auth;
if (fs.existsSync(KEY)) {
  auth = new google.auth.GoogleAuth({ credentials: JSON.parse(fs.readFileSync(KEY, 'utf8')), scopes: SCOPES });
  console.log('· auth: service account (google-cloud-key.json)');
} else {
  auth = new google.auth.GoogleAuth({ scopes: SCOPES }); // ADC: gcloud auth application-default login
  console.log('· auth: Application Default Credentials (your gcloud login)');
}
const api = google.androidpublisher({ version: 'v3', auth });

// Read the metadata text for one language (don't send a language without files).
function listing(lang) {
  const dir = path.join(META, lang);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { return ''; } };
  const title = read('title.txt'), shortD = read('short_description.txt'), fullD = read('full_description.txt');
  if (!title && !fullD) return null;
  return { language: lang === 'en-US' ? 'en-US' : lang, fullDescription: fullD, title, shortDescription: shortD };
}

console.log(`▶ open the edit page for ${PKG} …`);
const edit = (await api.edits.insert({ packageName: PKG, requestBody: {} })).data;
const id = edit.id;
try {
  console.log(`▶ uploading the AAB (${(fs.statSync(AAB).size / 1024).toFixed(0)} KB) …`);
  const up = await api.edits.bundles.upload({
    packageName: PKG, editId: id,
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(AAB) },
  });
  const versionCode = up.data.versionCode;
  console.log(`✓ AAB accepted — versionCode ${versionCode}`);

  // Metadata/listing for each language that exists.
  for (const lang of fs.readdirSync(META).filter((d) => fs.existsSync(path.join(META, d, 'title.txt')))) {
    const l = listing(lang); if (!l) continue;
    await api.edits.listings.update({ packageName: PKG, editId: id, language: l.language, requestBody: l });
    console.log(`✓ listing ${l.language}: "${l.title}"`);
  }

  // Set the track with the AAB version that was just uploaded.
  await api.edits.tracks.update({
    packageName: PKG, editId: id, track: TRACK,
    requestBody: { track: TRACK, releases: [{ versionCodes: [String(versionCode)], status: STATUS }] },
  });
  console.log(`✓ track "${TRACK}" → status "${STATUS}" (versionCode ${versionCode})`);

  await api.edits.commit({ packageName: PKG, editId: id });
  console.log(`\n✅ Success — the release is committed to Play (track ${TRACK}).`);
  console.log('   Next in Play Console: Test & release → ' + TRACK + ' → copy the tester link/QR.');
} catch (e) {
  try { await api.edits.delete({ packageName: PKG, editId: id }); } catch { /* ignore */ }
  const detail = e?.response?.data?.error?.message || e?.message || String(e);
  die('Failed: ' + detail + '\n   (ADC: run `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/androidpublisher`.\n    Service account: make sure it was invited in the Play Console with internal-testing permission.)');
}
