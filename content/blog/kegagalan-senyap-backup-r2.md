SLUG: kegagalan-senyap-backup-r2
TITLE: Silent Failure: How Our Backup Turned Out to Have Never Succeeded
EXCERPT: For months the snapshot system was confident it had "finished" while every upload to R2 failed silently. The cause: an API token with the wrong scope, and a script that never counted failures. The lesson: timer success is not proof of job success.
TAGS: backups, cloudflare, r2, devops, case study, tukuk-os

## All Green Lights, but Nothing Getting In

Tukuk-OS had a tidy-looking backup layer: a systemd timer every 4 hours ran `snapshot-r2.sh`, which copied pages and assets to Cloudflare R2. The `www.tukuk.org` worker reads that bucket to serve a mirror when the origin dies. `systemctl list-timers` showed LAST PASSED with *success* status every single time. The journal ended with a friendly line: `[snapshot] done. The www.tukuk.org mirror is fresh now.`

Then a small audit forced us to read the logs carefully — not the last line, but all of them. And there it was, dozens of lines:

```
  ! failed index.html
  ! failed llms.txt
  ! failed robots.txt
```

Every upload failed. *Every. Single. One.* Since the very beginning. Our "backup" mirror was actually a stale archive nobody had ever touched, and the script still exited with code 0 because the `put()` function printed warnings but never counted failures or `exit 1`.

## The Cause: a Token That Never Had the Key to That Room

The first mistake was human: when creating the Cloudflare API token for the tunnel, we also added DNS and Zone scopes — enough for everything tested at the time. But `wrangler r2 object put` needs **Account Settings: Read** (to identify the account) and **R2: Edit**. The token had neither.

Confirming that took one curl:

```
GET /accounts → {"result": [], "success": true}
```

Successful, but empty. A valid token, yet no accounts visible. R2? `Authentication error`. Hard proof, not guessing.

The irony: my laptop already had a working path — `wrangler` with an OAuth login, which could obviously write to R2. Only the VPS was holding a blind token.

## The Fix: Don't Repair the Token, Remove the Need for a Token

Rather than asking the user to create a new token with the right scopes (which can be forgotten, expire, or get pasted wrong), we shifted the architecture: a small `tukuk-backup` worker that **has** the R2 binding on the Cloudflare side, and the VPS only needs an HTTP POST with a bearer secret. The worker writes to the bucket — the VPS token is no longer involved at all.

```
curl -X POST -H "Authorization: Bearer $SECRET" \
     -H "x-content-type: application/gzip" \
     --data-binary @data.tar.gz \
     "$WORKER/?key=backups/tukuk-data-505.tar.gz"
```

Double win: the same channel is now used by the hourly data backup (`data/` → R2, 168-slot rotation = a full 7 days), and the restore script (`restore-data.sh`) was validated with a **real restore test**: download, unpack, `diff -rq` against live data — empty.

## Lessons You Can Reuse

1. **Timer status ≠ job status.** A systemd unit that `exit 0`s while ignoring every internal failure is the most convincing liar there is. Count failures, `exit 1` when non-zero — let the timer fail too so it becomes more visible.
2. **Test backups by restoring, not by writing.** A backup that has never passed a restore test is just a wish. We only felt certain when `diff` came back empty.
3. **Check token scopes before blaming the logs.** One `GET /accounts` returning an empty list exposed the token's weakness in a minute — far faster than digging through the journal.
4. **Put permissions where they cannot be forgotten.** The R2 binding on a worker will never "miss a scope" after a token rotation; an `.env` file will.

Sometimes the most "pro" thing you can do for a solo project is not adding a feature — but honestly checking that the feature you trusted all along actually ever worked.
