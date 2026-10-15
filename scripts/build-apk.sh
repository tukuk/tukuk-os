#!/usr/bin/env bash
# ==============================================================================
# build-apk.sh — Bina APK T Chat (pembungkus WebView) TANPA Gradle.
#
#   bash scripts/build-apk.sh
#
# Rantaian alat Android yang sah:
#   aapt2 compile+link  →  javac  →  d8 (classes.dex)  →  zip masuk APK
#   →  zipalign  →  apksigner (sign + verify).
#
# Perlu: Android SDK (build-tools + platform android.jar) + JDK. Dijumpai
# automatik daripada ANDROID_HOME / ~/Android/Sdk + Android Studio JBR. Output:
#   public/downloads/tukuk-chat.apk  (di-host sebagai fail statik, dimuat pengguna).
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Cari SDK + JDK ──
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
[ -d "$SDK" ] || { echo "build-apk: Android SDK tak dijumpai di $SDK"; exit 1; }
BT="$(ls -1 "$SDK/build-tools" 2>/dev/null | sort -V | tail -1)"
[ -n "$BT" ] || { echo "build-apk: tiada build-tools dalam $SDK/build-tools"; exit 1; }
AAPT2="$SDK/build-tools/$BT/aapt2"
D8="$SDK/build-tools/$BT/d8"
ZIPALIGN="$SDK/build-tools/$BT/zipalign"
APKSIGNER="$SDK/build-tools/$BT/apksigner"
ZIP="$(command -v zip || echo "$SDK/build-tools/$BT/zip")"
PLATFORM="$SDK/platforms/$(ls -1 "$SDK/platforms" | sort -V | tail -1)/android.jar"
[ -f "$PLATFORM" ] || { echo "build-apk: tiada android.jar (platforms)"; exit 1; }

if command -v javac >/dev/null 2>&1; then JBIN="$(dirname "$(command -v javac)")"
elif [ -x /opt/android-studio/jbr/bin/javac ]; then JBIN=/opt/android-studio/jbr/bin
elif [ -x "$SDK/../jbr/bin/javac" ]; then JBIN="$SDK/../jbr/bin"
else echo "build-apk: javac tak dijumpai (pasang JDK atau Android Studio)"; exit 1; fi
JAVAC="$JBIN/javac"; KEYTOOL="$JBIN/keytool"
# d8/apksigner/zipalign ialah pembungkus shell yang memanggil `java` dari PATH.
export PATH="$JBIN:$PATH"
export JAVA_HOME="$JBIN/.."
echo "build-apk: SDK=$SDK build-tools=$BT javac=$JAVAC platform=$(basename "$(dirname "$PLATFORM")")"

SRC=apk/app
WORK=apk/build
KS=apk/tukuk-chat-release.jks          # kekunci edaran (self-signed); git-ignored
ALIAS=tukuk-chat
PASS=tukukchat
DNAME="CN=Tukuk-OS, OU=T Chat, O=tukuk.org, L=Kuala Lumpur, C=MY"
# Kata laluan + DN signing SEJATI disimpan di fail ini (git-ignored — rahsia,
# JANGAN di-commit). Sumberkan untuk menimpa nilai bawaan di atas.
if [ -f apk/keystore.env ]; then . apk/keystore.env; fi
ICON=public/icons/apps/chat-512.png    # ikon pelancaran (512×512)
OUT=public/downloads/tukuk-chat.apk

rm -rf "$WORK"
mkdir -p "$WORK/gen" "$WORK/obj" "$WORK/dex" "$WORK/res" "$WORK/icon/mipmap"
[ -f "$ICON" ] || { echo "build-apk: ikon $ICON tiada"; exit 1; }
cp "$ICON" "$WORK/icon/mipmap/ic_launcher.png"

# 1) Kompil + paut sumber (ikon + string + manifest) jadi APK asas tanpa dex.
"$AAPT2" compile --dir "$WORK/icon" -o "$WORK/res/ic.zip"
"$AAPT2" compile --dir "$SRC/res"   -o "$WORK/res/val.zip"
"$AAPT2" link -o "$WORK/base.apk" \
  --manifest "$SRC/AndroidManifest.xml" \
  -I "$PLATFORM" \
  "$WORK/res/ic.zip" "$WORK/res/val.zip" \
  --auto-add-overlay

# 2) Kompil Java lawan android.jar (tiada AndroidX → framework sahaja).
"$JAVAC" -source 11 -target 11 -classpath "$PLATFORM" -d "$WORK/obj" \
  $(find "$SRC/src" -name '*.java')

# 3) Tukar .class → classes.dex (d8, min-api 23).
"$D8" --min-api 23 --lib "$PLATFORM" --output "$WORK/dex" \
  $(find "$WORK/obj" -name '*.class')

# 4) Suntik classes.dex ke dalam APK asas, lalu zipalign + sign.
cp "$WORK/base.apk" "$WORK/app.unsigned.apk"
( cd "$WORK/dex" && "$ZIP" -q "$OLDPWD/$WORK/app.unsigned.apk" classes.dex )
"$ZIPALIGN" -f -p 4 "$WORK/app.unsigned.apk" "$WORK/app.aligned.apk"

[ -f "$KS" ] || "$KEYTOOL" -genkeypair -v -keystore "$KS" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "$DNAME"

mkdir -p "$(dirname "$OUT")"
"$APKSIGNER" sign --ks "$KS" --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$PASS" --key-pass "pass:$PASS" --out "$OUT" "$WORK/app.aligned.apk"
"$APKSIGNER" verify --print-certs "$OUT" >/dev/null

echo "build-apk: ✓ $OUT ($(du -h "$OUT" | cut -f1)) — dibina $(date -Is)"
