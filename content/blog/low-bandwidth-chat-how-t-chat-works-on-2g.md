SLUG: low-bandwidth-chat-how-t-chat-works-on-2g
TITLE: How T Chat Works on 2G — Engineering a Messenger for Weak Networks
EXCERPT: Most chat apps assume fast, always-on internet. T Chat assumes the opposite: a flickering 2G connection, a dying battery, and data you have to pay for per megabyte. Here is how it stays usable when the network is not.
TAGS: chat, low-bandwidth, 2g, offline, pwa, t-chat

## The problem most messengers ignore

Modern chat apps are built for people on LTE and Wi-Fi. They open a persistent socket, stream high-resolution images, download full message histories on launch, and sync presence constantly. On a fast connection that is invisible. On a rural 2G link — where latency is a second or more, bandwidth is measured in tens of kilobytes, and a dropped call means minutes of re-hunting for signal — the same design simply fails. The spinner never ends, the app never opens, and the data bill climbs for messages nobody read.

T Chat starts from a different premise: **assume the network is bad, and make "bad" work.**

## Small payloads, on purpose

The first lever is size. Every message round-trip is kept as lean as possible — plain, compact payloads instead of heavy metadata, and no automatic download of media you did not ask for. Images and voice notes load lazily, only when you tap them, because on 2G pulling a 2 MB photo just because it appeared in a thread is a waste you pay for twice: in time and in credit.

The UI follows the same rule. Assets are cached by a service worker so the app shell loads from the device after the first open, not over the wire every time. That is the difference between "the app opens instantly and only the new messages fetch" and "the whole thing re-downloads each launch".

## It queues when you are offline

Outbound messages do not vanish when signal drops. T Chat keeps them in an **offline queue** on the device and sends them the moment the connection returns — you can write in a basement, on a bus through a dead zone, or in airplane mode, and the message goes out on its own later. A receipt-style read indicator tells you what actually landed, so you know whether to wait or retry, instead of guessing.

Presence and polling are deliberately quiet too. The app avoids hammering the server with keep-alives that eat data on the hour; it fetches what is new, when you are actually looking.

## Why this matters beyond 2G

Weak networks are not only a developing-world problem. A crowded stadium, a rural highway, a basement apartment, a train tunnel — all are "2G-like" moments even on a flagship phone. Designing for the worst case makes the common case feel fast and cheap. That is the whole philosophy of the hub at [tukuk.org](https://tukuk.org): tools that stay useful when conditions are not ideal. To try it, open [T Chat](https://tukuk.org/apps/chat) or grab the app for your device from the [download page](https://tukuk.org/download). No account, no per-message cost, works on the network you actually have.
