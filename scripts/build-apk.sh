#!/usr/bin/env bash
# ==============================================================================
# build-apk.sh — Bina APK pembungkus WebView TANPA Gradle, untuk SATU apl.
#
#   bash scripts/build-apk.sh                    # default = T Chat (org.tukuk.chat)
#   APP_SLUG=calc APP_PKG=org.tukuk.calc APP_LABEL="Tukuk Calc" \
#   APP_URL=https://tukuk.org/apps/calc APP_ICON=apk/launcher/calc.png \
#   APP_MEDIA=0 APP_VC=1 APP_VN=1.0.0 BUILD_AAB=0 bash scripts/build-apk.sh
#
# Rantaian alat: aapt2 compile+link → javac → d8 (classes.dex) → zip → zipalign
#   → apksigner (sign + verify). AAB (untuk Play) hanya bila BUILD_AAB=1.
#
# Perlu Android SDK (build-tools + platform android.jar) + JDK; dijumpai automatik.
# Keluaran: public/downloads/<APP_SLUG>.apk  (+ .aab bila BUILD_AAB=1).
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Parameter apl (default = T Chat → binaan asal tak berubah) ──
APP_SLUG="${APP_SLUG:-chat}"
APP_PKG="${APP_PKG:-org.tukuk.chat}"
APP_LABEL="${APP_LABEL:-T Chat Beta}"
APP_URL="${APP_URL:-https://tukuk.org/apps/chat}"
APP_ICON="${APP_ICON:-public/icons/apps/chat-512.png}"
APP_MEDIA="${APP_MEDIA:-1}"          # 1 => tambah kebenaran kamera/mikrofon (WebRTC)
APP_VC="${APP_VC:-3}"
APP_VN="${APP_VN:-1.0.1}"
BUILD_AAB="${BUILD_AAB:-1}"
# pathPrefix untuk deep-link = laluan selepas origin, dengan satu slash awal.
# Buang query (# dan ?) — pathPrefix manifest tidak boleh mengandungi aksara itu
# (cth. arked /builder?tpl=x → START_URL penuh dipelihara, pathPrefix jadi /builder).
APP_PATH="/${APP_URL#*://}"; APP_PATH="/${APP_PATH#*/}"; APP_PATH="${APP_PATH%/}"
APP_PATH="${APP_PATH%%\?*}"; APP_PATH="${APP_PATH%%#*}"
PKG_DIR="${APP_PKG##*.}"              # segmen terakhir pakej → nama direktori src

# ── Cari SDK + JDK ──
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
[ -d "$SDK" ] || { echo "build-apk: Android SDK tak dijumpai di $SDK"; exit 1; }
BT="$(ls -1 "$SDK/build-tools" 2>/dev/null | sort -V | tail -1)"
[ -n "$BT" ] || { echo "build-apk: tiada build-tools dalam $SDK/build-tools"; exit 1; }
AAPT2="$SDK/build-tools/$BT/aapt2"; D8="$SDK/build-tools/$BT/d8"
ZIPALIGN="$SDK/build-tools/$BT/zipalign"; APKSIGNER="$SDK/build-tools/$BT/apksigner"
ZIP="$(command -v zip || echo "$SDK/build-tools/$BT/zip")"
PLATFORM="$SDK/platforms/$(ls -1 "$SDK/platforms" | sort -V | tail -1)/android.jar"
[ -f "$PLATFORM" ] || { echo "build-apk: tiada android.jar (platforms)"; exit 1; }
if command -v javac >/dev/null 2>&1; then JBIN="$(dirname "$(command -v javac)")"
elif [ -x /opt/android-studio/jbr/bin/javac ]; then JBIN=/opt/android-studio/jbr/bin
elif [ -x "$SDK/../jbr/bin/javac" ]; then JBIN="$SDK/../jbr/bin"
else echo "build-apk: javac tak dijumpai (pasang JDK atau Android Studio)"; exit 1; fi
JAVAC="$JBIN/javac"; KEYTOOL="$JBIN/keytool"
export PATH="$JBIN:$PATH"; export JAVA_HOME="$JBIN/.."
echo "build-apk: slug=$APP_SLUG pkg=$APP_PKG path=$APP_PATH media=$APP_MEDIA | SDK=$SDK bt=$BT"

KS=apk/tukuk-chat-release.jks; ALIAS=tukuk-chat; PASS=tukukchat; KEYPASS=""
DNAME="CN=Tukuk-OS, OU=T Chat, O=tukuk.org, L=Kuala Lumpur, C=MY"
[ -f apk/keystore.env ] && . apk/keystore.env
KEYPASS="${KEYPASS:-$PASS}"

# ── Sediakan pokok sumber PER-APL (salin apk/app → WORK, lalu patch) ──
WORK=apk/build-$APP_SLUG
rm -rf "$WORK"; mkdir -p "$WORK/gen" "$WORK/obj" "$WORK/dex" "$WORK/res" "$WORK/icon/mipmap"
SRC="$WORK/app"; cp -r apk/app "$SRC"

[ -f "$APP_ICON" ] || { echo "build-apk: ikon $APP_ICON tiada"; exit 1; }
cp "$APP_ICON" "$WORK/icon/mipmap/ic_launcher.png"

# 1a) Java: pindah ke direktori pakej baru + patch package & START_URL.
rm -rf "$SRC/src/org/tukuk"/*; mkdir -p "$SRC/src/org/tukuk/$PKG_DIR"
sed -e "s#^package org.tukuk.chat;#package $APP_PKG;#" \
    -e "s#private static final String START_URL = \"[^\"]*\";#private static final String START_URL = \"$APP_URL\";#" \
    apk/app/src/org/tukuk/chat/MainActivity.java > "$SRC/src/org/tukuk/$PKG_DIR/MainActivity.java"

# 1b) strings.xml: label apl.
cat > "$SRC/res/values/strings.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">$APP_LABEL</string>
</resources>
EOF

# 1c) AndroidManifest.xml: pakej, versi, laluan deep-link, kebenaran media ikut perlu.
MEDIA_PERMS=""
if [ "$APP_MEDIA" = "1" ]; then
  MEDIA_PERMS='  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  <uses-feature android:name="android.hardware.camera" android:required="false" />
  <uses-feature android:name="android.hardware.microphone" android:required="false" />'
fi
cat > "$SRC/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<!-- $APP_LABEL — pembungkus WebView (membuka $APP_URL). Dibina aapt2/d8/apksigner. -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="$APP_PKG"
    android:versionCode="$APP_VC"
    android:versionName="$APP_VN">
  <uses-sdk android:minSdkVersion="23" android:targetSdkVersion="36" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
$MEDIA_PERMS
  <application
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:theme="@android:style/Theme.Material.NoActionBar"
      android:hardwareAccelerated="true"
      android:usesCleartextTraffic="false"
      android:allowBackup="true"
      android:supportsRtl="true">
    <activity
        android:name=".MainActivity"
        android:exported="true"
        android:launchMode="singleTask"
        android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|uiMode|density"
        android:windowSoftInputMode="adjustResize">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="tukuk.org" android:pathPrefix="$APP_PATH" />
      </intent-filter>
    </activity>
  </application>
</manifest>
EOF

# ── 2) aapt2 compile + link ──
"$AAPT2" compile --dir "$WORK/icon" -o "$WORK/res/ic.zip"
"$AAPT2" compile --dir "$SRC/res"   -o "$WORK/res/val.zip"
"$AAPT2" link -o "$WORK/base.apk" --manifest "$SRC/AndroidManifest.xml" -I "$PLATFORM" \
  "$WORK/res/ic.zip" "$WORK/res/val.zip" --auto-add-overlay

# ── 3) javac → d8 → suntik dex → align → sign ──
"$JAVAC" -source 11 -target 11 -classpath "$PLATFORM" -d "$WORK/obj" $(find "$SRC/src" -name '*.java')
"$D8" --min-api 23 --lib "$PLATFORM" --output "$WORK/dex" $(find "$WORK/obj" -name '*.class')
cp "$WORK/base.apk" "$WORK/app.unsigned.apk"
( cd "$WORK/dex" && "$ZIP" -q "$OLDPWD/$WORK/app.unsigned.apk" classes.dex )
"$ZIPALIGN" -f -p 4 "$WORK/app.unsigned.apk" "$WORK/app.aligned.apk"
[ -f "$KS" ] || "$KEYTOOL" -genkeypair -v -keystore "$KS" -storetype JKS -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 -storepass "$PASS" -keypass "$KEYPASS" -dname "$DNAME"
OUT="public/downloads/tukuk-$APP_SLUG.apk"
mkdir -p "$(dirname "$OUT")"
"$APKSIGNER" sign --ks "$KS" --ks-type JKS --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$PASS" --key-pass "pass:$KEYPASS" --out "$OUT" "$WORK/app.aligned.apk"
"$APKSIGNER" verify --print-certs "$OUT" >/dev/null
echo "build-apk: ✓ $OUT ($(du -h "$OUT" | cut -f1)) — $APP_LABEL v$APP_VN ($APP_VC)"

# ── 4) AAB (hanya bila dipinta, mis. T Chat untuk Play) ──
[ "$BUILD_AAB" = "1" ] || { exit 0; }
AAB="public/downloads/tukuk-$APP_SLUG.aab"
echo "build-apk: membina AAB…"
set +e
B="$WORK/bundle"; rm -rf "$B"; mkdir -p "$B/base/manifest" "$B/base/dex"
"$AAPT2" link --proto-format -o "$WORK/proto.zip" --manifest "$SRC/AndroidManifest.xml" -I "$PLATFORM" \
  "$WORK/res/ic.zip" "$WORK/res/val.zip" --auto-add-overlay
( cd "$B/base" && unzip -oq "$OLDPWD/$WORK/proto.zip" )
[ -f "$B/base/AndroidManifest.xml" ] && mv "$B/base/AndroidManifest.xml" "$B/base/manifest/AndroidManifest.xml"
cp "$WORK/dex/classes.dex" "$B/base/dex/classes.dex"
BV="${BUNDLETOOL_VERSION:-1.17.2}"; VLEN=${#BV}
{ printf '\012'; printf "\\$(printf '%03o' $((VLEN + 2)))"; printf '\022'; printf "\\$(printf '%03o' "$VLEN")"; printf '%s' "$BV"; } > "$B/BundleConfig.pb"
rm -f "$AAB"; ( cd "$B" && zip -qrXD "$OLDPWD/$AAB" base BundleConfig.pb )
MISS=""
for need in base/manifest/AndroidManifest.xml base/dex/classes.dex base/resources.pb BundleConfig.pb; do
  unzip -l "$AAB" 2>/dev/null | grep -q "[[:space:]]$need\$" || MISS="$MISS $need"
done
unzip -l "$AAB" 2>/dev/null | grep -q "base/res/" || MISS="$MISS base/res/"
if unzip -l "$AAB" 2>/dev/null | awk '{print $4}' | grep -qE '/$'; then MISS="$MISS [entri-direktori]"; fi
if [ -z "$MISS" ]; then
  echo "build-apk: ✓ $AAB ($(du -h "$AAB" | cut -f1)) — entri wajib lengkap."
else
  echo "build-apk: ⚠ $AAB RUGI entri:$MISS — JANGAN hantar ke Play."
fi
set -e
