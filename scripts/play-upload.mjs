#!/usr/bin/env node
// play-upload.mjs — Hantar AAB + metadata T Chat ke Google Play (Internal testing)
// melalui Play Developer API. TIADA Ruby/fastlane diperlukan (projek ini Node).
//
// PRASYARAT (sekali sahaja, oleh anda):
//   1. Google Cloud → IAM & admin → Service Accounts → Create (contoh "play-ci").
//   2. Buka project itu → API & Services → Enable "Google Play Android Developer API".
//   3. Service Account → Keys → Add key → JSON → muat turun.
//   4. Simpan fail JSON itu sebagai  ./google-cloud-key.json  (sudah di-gitignore).
//   5. Play Console → Users and permissions → Invites new user → e-mel service
//      account (long string @<project>.iam.gserviceaccount.com) → grant
//      "Manage internal app testing" + view app information.
//   6. `npm install googleapis` (sekali), kemudian:
//        node scripts/play-upload.mjs
//
// Script ini: upload AAB → tetapkan track "internal" (status completed = rilis
// dalaman) → tampal tajuk/deskripsi EN+MS dari fastlane/metadata. Idempotent-ish
// (create edit → commit). Gagal awal dengan mesej jelas jika prasyarat tiada.
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
catch { die('googleapis belum dipasang — jalankan: npm install googleapis'); }
if (!fs.existsSync(KEY)) die(`tiada ${path.relative(ROOT, KEY)} — ikut prasyarat di kepala fail ini.`);
if (!fs.existsSync(AAB)) die(`tiada ${path.relative(ROOT, AAB)} — jalankan: bash scripts/build-apk.sh`);

const creds = JSON.parse(fs.readFileSync(KEY, 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const api = google.androidpublisher({ version: 'v3', auth });

// Baca teks metadata untuk satu bahasa (jangan hantar bahasa tanpa fail).
function listing(lang) {
  const dir = path.join(META, lang);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { return ''; } };
  const title = read('title.txt'), shortD = read('short_description.txt'), fullD = read('full_description.txt');
  if (!title && !fullD) return null;
  return { language: lang === 'en-US' ? 'en-US' : lang, fullDescription: fullD, title, shortDescription: shortD };
}

console.log(`▶ buka edit untuk ${PKG} …`);
const edit = (await api.edits.insert({ packageName: PKG, requestBody: {} })).data;
const id = edit.id;
try {
  console.log(`▶ muat naik AAB (${(fs.statSync(AAB).size / 1024).toFixed(0)} KB) …`);
  const up = await api.edits.bundles.upload({
    packageName: PKG, editId: id,
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(AAB) },
  });
  const versionCode = up.data.versionCode;
  console.log(`✓ AAB diterima — versionCode ${versionCode}`);

  // Metadata/listing untuk setiap bahasa yang wujud.
  for (const lang of fs.readdirSync(META).filter((d) => fs.existsSync(path.join(META, d, 'title.txt')))) {
    const l = listing(lang); if (!l) continue;
    await api.edits.listings.update({ packageName: PKG, editId: id, language: l.language, requestBody: l });
    console.log(`✓ listing ${l.language}: "${l.title}"`);
  }

  // Tetapkan track dengan versi AAB yang baru dimuat naik.
  await api.edits.tracks.update({
    packageName: PKG, editId: id, track: TRACK,
    requestBody: { track: TRACK, releases: [{ versionCodes: [String(versionCode)], status: STATUS }] },
  });
  console.log(`✓ track "${TRACK}" → status "${STATUS}" (versionCode ${versionCode})`);

  await api.edits.commit({ packageName: PKG, editId: id });
  console.log(`\n✅ Berjaya — keluaran di-commit ke Play (track ${TRACK}).`);
  console.log('   Seterusnya di Play Console: Uji & terbitkan → ' + TRACK + ' → salin pautan/QR penguji.');
} catch (e) {
  try { await api.edits.delete({ packageName: PKG, editId: id }); } catch { /* abaikan */ }
  const detail = e?.response?.data?.error?.message || e?.message || String(e);
  die('Gagal: ' + detail + '\n   (Pastikan service account diundang di Play Console dgn kebenaran internal testing.)');
}
