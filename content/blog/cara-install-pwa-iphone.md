SLUG: cara-install-pwa-iphone
TITLE: How to Install Tukuk Apps on iPhone (PWA — No App Store)
EXCERPT: Web apps can become real apps on your home screen. Here is how "Add to Home Screen" works on iPhone and Android, and what you get after installing.
TAGS: pwa, iphone, ios, android, install, guide

## What is a PWA?

A **PWA (Progressive Web App)** is a website that can be *installed*. Tukuk supplies two ingredients: a **manifest** (name, icon, colors, full-screen mode) and a **service worker** (caches assets so the app feels fast and works offline partly). When you "install", the iPhone or Android simply creates a shortcut that opens the app in its own window — no browser bar, with its own icon on the home screen. It looks and feels like a normal app, but needs no download from the App Store.

## On iPhone / iPad (Safari)

1. Open your favorite app on `tukuk.org` through **Safari** (Chrome on iOS does not support installation).
2. Tap the **Share** icon (the square with an upward arrow) in the bottom bar.
3. Scroll and choose **Add to Home Screen** → **Add**.
4. Done — the app icon appears on your home screen. Tap it and it opens full-screen like a native app.

Tip: if you see an **Install App** prompt in the address bar, that is the shortcut — just tap it.

## On Android (Chrome)

Open `tukuk.org` in Chrome → the **⋮** menu → **Add to Home screen** / **Install app**. There is also an **Install** banner that sometimes appears automatically. Same result: an icon on the home screen, full-screen opening.

## What you get

The app runs full-screen with its Tukuk icon, feels fast because assets are stored on the device, and some functions remain available even when the connection drops. And the most practical part: **updates happen by themselves on the server side**. Unlike an APK that must be downloaded again, a PWA always shows the newest version as soon as you reopen it. For iPhone users who cannot install APKs, this is your main door into the Tukuk app store.
