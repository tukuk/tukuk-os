SLUG: webauthn-passkeys-explained
TITLE: Passkeys and WebAuthn: Why "No Password" Is Actually More Secure
EXCERPT: A passkey is not password-less login bolted onto the same weak idea — it is a different model where the secret never leaves your device and cannot be phished, replayed, or leaked from a server.
TAGS: security, webauthn, auth, passkeys

## The Thing Passwords Get Wrong

A password is a **shared secret**: you know it, and so does the server. That single fact causes almost every failure — databases get leaked and hashes cracked, users reuse them, helpdesk gets socially engineered, login pages get cloned and the typed string captured. The problem is structural, not about length or special characters.

A **passkey** flips the model. Instead of one secret both sides hold, there is a *key pair*: a private key that never leaves your device, and a public key the server stores. Authentication is a **challenge–response**, not a comparison.

## What Actually Happens at Login

1. The server sends a random, single-use `challenge` (plus its `rpId` and origin).
2. Your device signs that challenge with the private key, only after a local unlock (PIN, biometric, or the key itself).
3. The server verifies the signature against the stored public key.

No secret is transmitted — only a signature that is worthless once consumed. This is the **FIDO2 / WebAuthn** standard.

- **Phishing-resistant**, because the origin is baked into the ceremony: a fake site with a lookalike domain gets a different `rpId` and the browser refuses to sign.
- **Replay-proof**, because the `challenge` is used once.
- **Leak-proof on the server side**, because the database holds only public keys — useless to an attacker.

## The Gotchas People Hit

- **HTTPS is mandatory.** WebAuthn works only over a secure origin (or `localhost`). One mismatched scheme and the ceremony silently fails.
- **`rpId` is not just your domain.** It must match the exact relying-party domain the browser sees. If you test on `127.0.0.1:3000` but registered the key under `example.com`, it will reject — this trips up local development constantly.
- **Recovery is the real design problem.** Losing the device used to mean losing the account. The fix is a **residential key** that syncs across devices via your platform (iCloud Keychain / Google Password Manager), plus at least one fallback factor registered up front.
- **Enrolling and using are separate steps.** Registration creates the credential; authentication asserts it. Keep both flows explicit in your backend.

## Making It Work in Practice

- Verify the challenge server-side, store it, and delete it after one attempt.
- Allow **multiple credentials per account** (a phone, a laptop, a hardware key) — that is what "add a device" really means.
- Keep a **break-glass password or recovery code** path, documented, for lockout — and make it loud in logs.
- Bind the origin strictly. Behind a proxy or tunnel, forward the *real* host so the WebAuthn origin and your `rpId` agree.

Passkeys are the rare security win that is both stronger **and** simpler for users: no memorising, no resetting, nothing to steal. The hard part is not the crypto — it is the recovery and origin details most demos skip.
