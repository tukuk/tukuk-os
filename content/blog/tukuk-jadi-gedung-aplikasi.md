SLUG: tukuk-jadi-gedung-aplikasi
TITLE: Tukuk-OS Becomes Its Own App Store — APKPure Style
EXCERPT: Every app on Tukuk-OS can now be downloaded as a signed Android APK, straight from the server — no Google Play, no third-party store.
TAGS: tukuk, apk, app-store, android, pwa

## Why build your own app store?

Most people know APKPure or F-Droid as places to download Android apps that are not on Google Play. Our idea is similar, but for the Tukuk ecosystem: **why send users somewhere else**, when tukuk.org itself can be the store? So we built an app hub on the homepage that lists every Tukuk app — built-ins, arcade, Satu Kata, and community contributions — each with an **Install** button, an **⬇ APK** button, and a **🔒 Signed by Tukuk** badge.

## APKs generated on demand

This is the most interesting part: we do not pre-build 15 APKs and store them statically. The server **builds APKs on-demand**. When you press ⬇ APK on any card, `/api/apk/:id` will:

1. Identify the item from the store catalog (only valid ids — this is the security boundary so no external URL can be smuggled in).
2. Chain together the Android build tools actually installed on the server: `aapt2` to compile & link resources, `javac` for the WebView-wrapper Java code, `d8` to convert `.class` to `dex`, then `zip`, `zipalign`, and `apksigner`.
3. Save the result to `public/downloads/tukuk-<slug>.apk`. If it already exists it is served instantly (~0.5s); if not, it gets built (~5–8s).

The wrapper app itself is just one `WebView` that opens the live URL on tukuk.org. This means **the app's content can be updated over the web without you ever downloading a new APK** — the APK version stays, the content behind it is always fresh.

## One key, one identity

All APKs are signed with **the same Tukuk keystore**. Why it matters: when you upgrade, Android recognizes the same key and allows installing over the old version (a local update, not remove-and-reinstall). A consistent publisher identity also builds trust. What you should understand: this is a **self-signed** signature — valid for direct installation, but not "Google verified" (that only comes through the Play Store).

## PWA for iPhone instead

APKs are Android-only. For iPhone/iPad, every app also supports **PWA installation** (Progressive Web App) — you can "Add to Home Screen" and it opens like a native app with its own icon. So every one of our apps has two install doors: **APK for Android, PWA for everything else**. The app hub now lives at `https://tukuk.org/` — try pressing ⬇ APK on any app and watch it get built right in front of you.
