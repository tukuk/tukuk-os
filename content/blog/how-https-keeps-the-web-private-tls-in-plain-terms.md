SLUG: how-https-keeps-the-web-private-tls-in-plain-terms
TITLE: How HTTPS Keeps the Web Private (TLS in Plain Terms)
EXCERPT: The padlock in your browser is the most-ignored security icon you use every day. Behind it is TLS, a handshake that lets two strangers over a hostile network agree on a secret in the open — and understanding it explains both why HTTPS is remarkable and why the padlock is not a guarantee you are safe.
TAGS: https, tls, security, privacy, technology

## The Problem HTTPS Solves

Plain HTTP sends everything — the page, your password, your cookie — as **readable text across the network**. Anyone on the path between you and the server (a café Wi-Fi operator, your ISP, a government, a hacker on the same network) can read it and, worse, can quietly *rewrite* what you receive, injecting ads or malware into a page that looked legitimate. **HTTPS** exists to fix exactly this over an untrusted network, and its job is threefold: keep the traffic **confidential** (encrypted), keep it **untampered** (integrity-checked), and confirm you are talking to the **real** server, not an impostor (authentication). Those three are delivered by the **TLS** protocol (Transport Layer Security, successor to SSL) layered underneath HTTP — hence "HTTPS." You already met one cousin of this problem in [DNS over HTTPS](https://tukuk.org/blog/dns-over-https-explained), which encrypts the *lookup* step that happens even before a connection.

## The Handshake: Agreeing on a Secret in the Open

The clever core of TLS is that two parties who have never met establish a shared secret while everyone listens. Roughly: your browser connects and the server presents its **certificate** — a file binding its domain name to a **public key**, digitally signed by a trusted **Certificate Authority (CA)**. The browser checks that the certificate is signed by a CA it trusts, that it is valid for the exact domain you typed, and that it has not expired or been revoked. Then the two run a **key-exchange** (modern TLS uses Diffie–Hellman, where each side contributes public maths that combine into the same secret value that never travels over the wire). Once both hold that shared secret, they switch to fast **symmetric encryption** for the rest of the session, with integrity checks on every message. So the "128-bit lock" you hear about isn't protecting the handshake — the handshake's whole point is to build that lock securely from scratch.

## Why Certificates Are the Hard Part

Encryption alone is not enough — an attacker could encrypt your traffic too, if they could *pretend* to be your bank. The defence is the certificate chain: a site proves it controls its domain because only the rightful owner (or someone they authorised) holds the matching **private key**, and a trusted CA vouches for that binding. This is why a self-signed certificate triggers a scary browser warning: nothing trusted has verified who the key belongs to. Free, automated CAs like **Let's Encrypt** made valid certificates available to everyone, which is a major reason the web flipped from mostly-HTTP to mostly-HTTPS. The trust model here is like any [key-or-token trade-off in API design](https://tukuk.org/blog/oauth-vs-api-keys-what-to-use-when): whoever controls the secret proves identity.

## What the Padlock Does Not Mean

A green padlock tells you the connection is encrypted and the domain is genuine. It tells you **nothing** about whether the site is honest. Scam and phishing sites routinely run HTTPS — indeed, fraudsters use the padlock to look legitimate. The padlock also does not mean your data isn't being harvested *by* that site, nor that a CA is infallible (history includes mis-issued and compromised certificates, which the web patches via revocation lists and short-lived certs). And on an HTTPS page the *network* can't read your traffic, but the endpoints — you and the server — obviously can. Treat the padlock as table stakes, not a moral certificate. Stronger guarantees come from features built on top: **HSTS** (which tells browsers to refuse an unencrypted downgrade in future), and the move toward **passkeys/WebAuthn**, where a phishing-resistant login uses the same trust principles at the authentication layer — covered in [our guide to passkeys](https://tukuk.org/blog/webauthn-passkeys-explained).

## The Whole Encrypted Web

Because TLS is fast, always-on and free to deploy, HTTPS is now the default for a huge share of the web rather than the exception it used to be for banking. The result is a quiet, largely invisible piece of infrastructure that makes online accounts, payments and private messaging possible on networks that were never trustworthy to begin with — and the reason a padlock feels normal rather than exotic.
