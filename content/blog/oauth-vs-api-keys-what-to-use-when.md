SLUG: oauth-vs-api-keys-what-to-use-when
TITLE: OAuth, API Keys, or a Shared Secret? Choosing Auth Without Overthinking
EXCERPT: These three are not interchangeable. Picking the wrong one is how you end up with a "simple" key that can act as any user, or an OAuth flow guarding a single service account.
TAGS: auth, oauth, api-keys, security

## The Three Things People Confuse

- **API key** — a static string that says *"this caller"*. Best for machine-to-machine, one identity, coarse scoping.
- **OAuth (access token)** — a short-lived token that says *"this user, granted these scopes, for a little while"*. Best when you act *on behalf of* someone.
- **Shared secret / HMAC signature** — proves a request was forged by a holder of the secret, without sending the secret. Best for webhooks and integrity.

The mistake is treating them as three sizes of the same jacket.

## When an API Key Is Right

You run a search index. Another server needs to push documents. There is no "user", the caller is fixed, and you want it dead simple. A key in an `Authorization: Bearer` header (never a query param — query strings leak into logs and referrers), scoped and rotatable, is fine.

Keys go wrong when: they never expire, everyone shares one, they sit in a URL, or they carry *more* privilege than the caller needs.

```bash
# good: header, scoped, rotatable
curl -H "Authorization: Bearer $TUKUK_WRITE_KEY" https://api.example.com/documents
```

## When You Actually Need OAuth

If a user says *"let this app read my stuff"*, and the app should never see the user's password — that is OAuth. The **authorization-code flow** (with **PKCE** for anything that can't keep a secret, like a browser or mobile app) hands you a scoped, expiring access token plus a refresh token. The cost is real: you now deal with redirects, token storage, rotation, and scope creep.

Do not build an OAuth *provider* unless you are an identity platform. Consuming one? Use a maintained library.

## Webhooks: Sign, Don't Just Send a Key

For a webhook, the receiving side must prove the call is genuinely from you. A plain key proves nothing if it leaks. **HMAC-sign the raw body** with a shared secret and send the signature in a header; the receiver recomputes it over the *exact bytes received* (order and whitespace matter) and rejects mismatches. Add a timestamp and a small replay window.

## The Boring Rules That Prevent Most Incidents

1. **Least scope.** A key that can do everything is an incident waiting for one leak.
2. **Rotate.** Anything static should have a rotation path that does not require a deploy.
3. **No secrets in URLs, git, or client bundles.** If it shipped to the browser, it is public.
4. **Expire and revoke.** Prefer tokens you can kill over strings you must hunt down.
5. **Log the identity, not the credential.** Record *which key/user* acted, never the secret itself.

Match the mechanism to the question you are really asking — *"who is calling?"* (key), *"on whose behalf, and how much?"* (OAuth), *"is this intact and truly from you?"* (HMAC). Once that click fits, the rest is hygiene.
