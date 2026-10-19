SLUG: send-sms-from-the-browser-no-phone-dialing
TITLE: Sending SMS From the Browser — Why an Internet-Free Channel Still Matters
EXCERPT: Every messaging app needs the internet. SMS does not — it rides the cellular voice network that reaches places data does not. Here is the case for a text channel that works when your data connection does not, and how Tukuk bridges the two.
TAGS: sms, messaging, offline, cellular, gateway, notifications

## The message that does not need Wi-Fi

WhatsApp, Telegram, Signal, iMessage — they all quietly require the same thing: a working data connection, and both sides already installed on the app. That is fine most of the time. It falls apart in the moments that matter: a recipient with no smartphone, an area with voice coverage but no mobile data, a network so congested that apps spin while a plain text still slips through. SMS is the universal fallback. It reaches any mobile number on Earth, needs nothing installed, and rides the cellular voice network that has coverage far beyond 4G/5G data.

The catch has always been *sending* SMS from the tools we actually use — a website, a script, an alert system. Traditionally that meant paying a per-message SMS-API provider.

## Bridging the web and the cell network

Tukuk takes a different route: pair a real Android phone to the system and let it act as the modem. The phone already has a SIM, already has signal, already can send and receive texts. So instead of buying message credit from an API reseller, an ordinary text becomes reachable from a browser or an automated job. The web side handles the interface and the logic; the paired handset handles the last hop over the cellular network. This is the two-way bridge behind the [SMS page](https://tukuk.org/sms) — outbound from a form or a scheduled job, inbound replies arriving back where they can be read and acted on.

## What that is genuinely good for

- **Reaching anyone, not just app users.** No download, no account, no smartphone required on the receiving end — just a phone number.
- **Alerts that survive a data outage.** Verification codes, delivery updates, and emergency pings go through when app-based push would not.
- **Low-tech automation.** A script can raise a human's attention with a text — the one notification format nobody uninstalls.

It is not a WhatsApp replacement for chatting with friends — for that, use [T Chat](https://tukuk.org/apps/chat) or any messenger. SMS is the safety net underneath: the channel that works when the modern ones cannot. You can see how the bridge is set up on the [SMS page](https://tukuk.org/sms), and the broader tool hub lives at [tukuk.org](https://tukuk.org).

## The honest limits

SMS is 160 characters per segment, plain text, and delivered over a network that is not end-to-end encrypted. Treat it as a *reach* tool, not a *confidentiality* tool: fine to say "your code is 4482" or "the van is outside", not for sending secrets. Its superpower is exactly its age — a protocol so universal that "no signal bars, no problem" is finally true.
