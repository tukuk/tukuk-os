# PLAY_PASTE.md — Google Play Release Copy-Paste Package (T Chat)

> One file for all Play Console forms text & answers. Open this in one
> window, Play Console in another, copy-paste. Do not store/commit any
> secret keys here.

App: **T Chat** · Package: **`org.tukuk.chat`** · Version: **2 (1.0.0)** · `targetSdk 36`
AAB: `public/downloads/tukuk-chat.aab` (valid — passes `bundletool validate` + `build-apks`)
Privacy policy (required): **https://tukuk.org/privacy**

---

## 1) Store listing — English (US)  *(default language)*

**App title (≤30)**
```
T Chat – Messenger & Calls
```

**Short description (≤80)**
```
Real messenger with video & voice calls, status, stories and works even on 2G.
```

**Full description (≤4000)**
```
T Chat is a real, multi-user messenger that runs fast on any connection — from fibre to a single bar of 2G.

WHAT YOU CAN DO
• Chat one-on-one, in groups, and in public rooms.
• Send text, photos, videos, voice messages and any file. Images are compressed on your device before upload so they send quickly.
• Video & voice calls, peer-to-peer over WebRTC, with caller identification (TukuCaller) that shows who is calling before you answer.
• Status — post a short emoji + text mood that expires on its own (30 minutes up to 7 days).
• Stories that last 24 hours, and a social feed with posts, reactions, reposts and comments.
• Reactions, replies, forwarding, message editing, in-chat search, read receipts and typing indicators.
• Friends list, blocking, and a permanent numeric Tukuk ID so contacts survive name changes.
• Big emoji stickers, polls, wallpapers, sounds and notification badges.

BUILT FOR SLOW NETWORKS
• Data-saver mode for 2G/3G/GPRS — no streaming, media loads only when you tap.
• Offline outbox: queued messages are resent automatically when you reconnect.
• Works as an installed app (PWA) with the session kept locally.

PRIVACY
Sign up with just a name and password — no phone number required. Your session uses a bearer token stored on your device, not cookies. You can delete your entire account and all its data from inside the app at any time.

This is the official T Chat companion app from tukuk.org. Feedback and questions are welcome via the contact page on tukuk.org.
```

**Release notes (what's new)**
```
First release on Google Play.
• DM, group and public-room messenger.
• WebRTC video/voice calls with TukuCaller caller ID.
• Status (mood) with TTL, 24-hour stories, social feed.
• 2G/3G data-saver mode + offline outbox.
• Target API 36 (Android 16), required for Play listing.
```

---

## 2) Store listing languages — English only

The site and the app are English-only by owner decision. Do **not** add
localized store listings (the former Malay `ms` fastlane metadata was
removed; all locales fall back to the `en-US` texts above).

---

## 3) Graphics (upload these files)

| Play slot | File |
|---|---|
| App icon (512×512) | `fastlane/metadata/android/en-US/images/icon/512.png` |
| Feature graphic (1024×500) | `fastlane/metadata/android/en-US/images/featureGraphic/feature.png` |
| Phone screenshots (≥2) | `fastlane/metadata/android/en-US/images/phoneScreenshots/screenshot-1.png` … `screenshot-4.png` |

---

## 4) Data Safety form — exact answers

- **Collect / share user data?** → *Collect* (needed for functionality). *Share with third parties?* → **No**.
- **Data types COLLECTED:**
  - Account name — yes
  - User messages / user-generated content (chat, post, story, comment) — yes
  - Photos & Videos — yes
  - Audio (voice messages) — yes
  - Files (shared documents) — yes
  - Tukuk ID (permanent numeric identifier) — yes
- **Data types NOT collected:** phone number, email, location, contacts, device/ad IDs, browsing history.
- **Collection purpose:** *App functionality* only. **Not** advertising, analytics, or tracking.
- **Encrypted in transit?** → **Yes** (HTTPS/TLS).
- **Can users request data deletion?** → **Yes** — full account + all data deleted from inside the app (⚙️ → Delete account).
- **Data deleted after service shutdown?** → Yes (account & data dropped upon deletion).

## 5) Content Rating (IARD) — guidance

The app lets **users share content seen by other users** (messages, images, videos, posts, stories). Answer honestly "Yes" to the user-generated-content questions. No graphic violence, sexual content, drugs, or gambling → typically publishes as **Everyone**. Play may ask for a **report/block mechanism** — we already have **block** + **delete** from inside the app.

## 6) App details (App details / policy)

- **Category:** Communication
- **Translations:** English (US) only
- **Privacy policy:** https://tukuk.org/privacy
- **Contact email / website:** use your developer account

---

## 7) Click-by-click checklist to RELEASE

### A. Complete app setup (REQUIRED before any track)
1. **Store presence → Main store listing** → paste §1 (EN), upload §3.
2. **Content rating** → fill the IARD (§5) → submit → wait for the result.
3. **Data safety** → fill §4 → save.
4. **Permissions / App details** → Communication category + privacy policy §6.

### B. INTERNAL testing (can do today — install on your own phones)
5. **Test & release → Internal testing → Create release** → drag `public/downloads/tukuk-chat.aab` → review & **Start rollout**.
6. **People with access** → *Testers group* add your own Google emails → copy the **link/QR** → open on a phone → **Install**. This is the first real smooth-rolling test (Play runs the same bundletool we verified).
7. **Play App Signing**: if prompted, opt in — use `apk/tukuk-chat-release.jks` (alias `tukuk-chat`) as the **upload key**. Google holds the real signing key.

### C. CLOSED testing (mandatory for Production)
8. **Closed testing → Create release** → upgrade the same AAB.
9. Collect **≥12 unique testers** active **≥14 consecutive days** (this is a timer — it cannot be shortcut; send the link to friends/family/tukuk.org users).

### D. PUBLICATION (Production)
10. After the closed-test criteria are met → **Production → Create release** → upgrade the AAB → fill the application form (questions about the closed test) → **Request rollout** → Google review → **Live on Google Play**.

---

## ⚠️ Two gates only YOU can pass (not code)
1. **Play Console operation** — your Google login, clicking the forms, uploading the AAB. I cannot log in on your behalf.
2. **Time & testers** — Production requires **≥12 testers × ≥14 days** of closed testing. This is Google's mandatory timer; no automation shortcut.

Everything that can be prepared from the code/repo side **is ready & verified**. The rest is Console actions + the 14-day timer above.
