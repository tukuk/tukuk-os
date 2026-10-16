#!/usr/bin/env bash
# ==============================================================================
# build-store-apks.sh — Bina APK pembungkus untuk SETIAP apl dalam apk/catalog.json
# (tukuk.org sebagai gedung apl sendiri, gaya APKPure). Ia memanggil build-apk.sh
# dengan env per-apl. AAB hanya untuk T Chat (yang masuk Play).
#
#   bash scripts/build-store-apks.sh
#
# Perlu: node + sharp (ikon), Android SDK + JDK (build-apk.sh cari automatik).
# Jalankan scripts/gen-launcher-icons.js dahulu (atau ia dijalankan di sini).
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"

# 1) Pastikan ikon launcher wujud untuk apl tanpa PNG khas.
node scripts/gen-launcher-icons.js || { echo "build-store: penjanaan ikon gagal"; exit 1; }

# 2) Jana satu baris per-apl: slug|pkg|label|url|icon|media|vc|vn
ROWS="$(node -e '
const fs=require("fs"),p=require("path");
const apps=JSON.parse(fs.readFileSync("apk/catalog.json","utf8")).apps;
for(const a of apps){
  const special=p.join("public","icons","apps",a.slug+"-512.png");
  const icon=fs.existsSync(special)?special:p.join("apk","launcher",a.slug+".png");
  console.log([a.slug,a.pkg,a.label,a.url,icon,a.media?"1":"0",a.vc,a.vn].join("\t"));
}')";

ok=0; fail=0
while IFS=$'\t' read -r slug pkg label url icon media vc vn; do
  [ -z "$slug" ] && continue
  aab=0; [ "$slug" = "chat" ] && aab=1
  echo "───────── $slug ($pkg) media=$media aab=$aab ─────────"
  APP_SLUG="$slug" APP_PKG="$pkg" APP_LABEL="$label" APP_URL="$url" \
  APP_ICON="$icon" APP_MEDIA="$media" APP_VC="$vc" APP_VN="$vn" BUILD_AAB="$aab" \
    bash scripts/build-apk.sh | grep -E "✓|⚠|error|Error|GAGAL" || fail=$((fail+1))
  [ -f "public/downloads/tukuk-$slug.apk" ] && ok=$((ok+1)) || { echo "  ✗ $slug: APK Tiada!"; fail=$((fail+1)); }
done <<< "$ROWS"

echo "══════════════════════════════════════════"
echo "build-store: $ok APK berjaya, $fail masalah"
ls -1 public/downloads/tukuk-*.apk | sed 's#.*/##'
