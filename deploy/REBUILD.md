# Rebuilding the Tukuk-OS production box

Written 2026-10-28, the morning the VPS locked everyone out.

The incident, as measured (not guessed): the box answered ping on `192.168.8.101` with a
*locally administered* MAC (`16:04:1e:83:c4:3a`, i.e. a virtual/bond device, not the physical
NIC), **every** TCP port 1-10000 returned `Connection refused`, sshd and cockpit answered on no
address anywhere on the LAN, and `tukuk.org` / `www.tukuk.org` both returned Cloudflare **530**
(no tunnel connector). Nothing remote could get in; only the console could.

This document is the order of operations for a planned reinstall. It is deliberately boring and
deliberately gated: **Part D is the point of the whole file.**

---

## The one rule

> Do not format the disk until Part D's restore point has been downloaded, decrypted and listed.

`.gitignore` keeps `data/`, `/opt/tukuk-os/.env` and `apk/*.jks` out of git, so `git clone` +
`npm install` restores the **program**, not the **box**: users, passkeys, chat history and the
`/etc/cloudflared` credentials only come back from the off-site archives, whose retrievability is now
**proven rather than assumed** (Part D). What still lives
only on that disk is the delta written after the last archive, plus any uncommitted work in the game
repo — which is why one console visit is still worth making before the wipe.

---

## Part A — Get in at the console

Nothing here destroys data. Do it even if you intend to wipe: you need the current files to wipe
safely.

```bash
ip -br a; ip route; cat /etc/resolv.conf           # who holds .101, and is there a default route?
nmcli -f NAME,TYPE,DEVICE,STATE connection show     # the bond profile Cockpit created
networkctl list 2>/dev/null | head                  # networkd side, if netplan owns the config
systemctl status ssh cockpit.socket cloudflared nginx tukuk-os --no-pager -l | head -60
sudo firewall-cmd --state --get-active-zones 2>/dev/null; sudo ufw status verbose 2>/dev/null
sudo sshd -t                                        # prints the exact bad line if sshd_config broke
```

Bring SSH up, and only SSH:

```bash
sudo systemctl unmask ssh 2>/dev/null
sudo systemctl start ssh && systemctl is-active ssh
ss -ltnp | grep ':22'
```

- `is-active: active` but the laptop still gets `refused` → it is a **firewall zone**, not a dead
  service. `sudo ufw allow from 192.168.8.0/24 to any port 22 proto tcp` (or move the interface out
  of the `block`/`drop` zone in firewalld). Refused-with-RST means reject/absent listener; a silent
  hang means drop. Read the symptom, do not guess.
- sshd fails to start → `sudo sshd -t` names the line. One bad character in `/etc/ssh/sshd_config`
  (which Cockpit's file editor can write) keeps sshd from starting at all.

From the laptop: `sshpass -p '<pw>' ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no tukuk@192.168.8.101 hostname`

## Part B — What must leave the box

| path | why it cannot be re-created | verified off-box today? |
|---|---|---|
| `/opt/tukuk-os/.env` | gitignored. tunnel token+id, admin email/password hash, WebAuthn RP config, API_KEY, `BACKUP_WORKER_URL`, `BACKUP_UPLOAD_SECRET`, ad/analytics IDs | **yes** — 1 copy inside the identity archive (33 keys listed in Part D) |
| `/etc/cloudflared/` (`config.yml`, `cert.pem`, `*.json`) | `cert.pem` is what lets hostnames be provisioned without the dashboard (legacy connector). Token mode covers the named tunnel only if `CF_TUNNEL_TOKEN` is real | **yes** — `cert.pem` 1 + tunnel `*.json` 2 in the identity archive |
| `/var/backups/tukuk-*-latest` | newest local copy | **yes** — R2 holds the same files, see Part D |
| identity tooling: `scripts/backup-identity.sh`, `scripts/restore-identity.sh`, `scripts/backup-b2.sh`, `deploy/tukuk-identity-backup.{service,timer}`, `deploy/tukuk-backup-b2.{service,timer}` | the whole restore chain | **yes** — committed from the box in `cd18d7b` and `52a5e96`; nothing to extract |
| `apk/tukuk-chat-release.jks`, `apk/keystore.env` | gitignored; the laptop has a copy (md5 `589d30f8e7476d779c5a9d6d60b431b6`) — compare against the box before trusting either | laptop only |
| `/opt/tukuk-os/data/`, `generated/`, `meili_data/` | runtime stores: passkey credentials, chat accounts/counters, published items, books corpus, ip-to-country. Partly gitignored | data archive only |
| `/etc/ssh/ssh_host_*` | optional but nice: a new key means a warning on every client and breaks any known_hosts pin | **yes** — 6 files in the identity archive |
| `/opt/tukuk-os/game/` | the Godot game (was `~/station-break`; `scripts/consolidate-layout.sh` moved it inside the app folder). In git on branch `game` **only if committed** — run `git -C /opt/tukuk-os/game status --porcelain | wc -l` first | partial |
| `/root/.ssh/`, `/home/tukuk/.ssh/`, `/home/tukuk/askpass.sh` | deploy keys and the HTTPS push helper | no |

**One folder.** Everything above that is not `/etc` or `/root` now lives under
`/opt/tukuk-os`: the Builder in `apps/builder`, the published game in `apps/play`, the
model weights in `models/`, the Godot binary in `bin/` and the game source in `game/`.
`deploy/paths.sh` is the single place those paths are written down, and
`scripts/consolidate-layout.sh` is what put them there (it is idempotent, so a restored
box converges by running it). The old top-level locations are symlinks until
`consolidate-layout.sh --prune-links` runs, which is why a restore script written against
the old paths still works.

Not on this list because they are genuinely rebuildable: Node 22, nginx, Chrome, Meilisearch binary,
Ollama binary + models (re-download), Godot 4.7 + web export templates, the 476 MB `.pck`
(rebuild via the game repo), all site code (GitHub), the `www` snapshot (R2, 1.66 GB / 328 objects).

## Part C — Copy it out

USB (works with no network at all — this is why we keep it simple):

```bash
lsblk -o NAME,SIZE,MOUNTPOINT                      # find the stick, e.g. sdb1
sudo mount /dev/sdb1 /mnt
sudo tar czf /mnt/vps-handover-$(date +%F).tar.gz \
  /opt/tukuk-os/.env /etc/cloudflared /etc/ssh /etc/nginx /etc/netplan /etc/systemd/system/tukuk* \
  /var/backups/tukuk-data-latest.tar.gz /var/backups/tukuk-identity-latest.tar.gz.enc \
  /opt/tukuk-os/scripts/backup-identity.sh /opt/tukuk-os/scripts/restore-identity.sh \
  /opt/tukuk-os/apk/tukuk-chat-release.jks /opt/tukuk-os/apk/keystore.env \
  --warning=no-file-changed || true
md5sum /mnt/vps-handover-*.tar.gz | tee /mnt/vps-handover.md5
sync && sudo umount /mnt
```

Or, once SSH is alive, straight to the laptop (run **from the laptop**):

```bash
ssh -o PreferredAuthentications=password tukuk@192.168.8.101 \
  'sudo tar cz -P -f - /opt/tukuk-os/.env /etc/cloudflared /var/backups/tukuk-identity-latest.tar.gz.enc' \
  > ~/vps-handover.tar.gz
```

Do not skip the game repo or the data dir:

```bash
sudo tar czf /mnt/vps-data-$(date +%F).tar.gz /opt/tukuk-os/data /opt/tukuk-os/generated
sudo cp -a /var/backups/tukuk-*-latest* /mnt/
```

## Part D — Verify, then and only then wipe

Every line must print `OK`. A tar that "uploaded successfully" is not a backup until something has
read it back.

```bash
cd ~ && md5sum -c <(cat vps-handover.md5)                       # 1 transport integrity
tar tzf vps-handover.tar.gz | wc -l                             # 2 must be > 20
tar tzf vps-data-*.tar.gz | grep -c .                           # 3 must be > 100
gzip -t tukuk-data-latest.tar.gz && echo "OK data archive readable"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in tukuk-identity-latest.tar.gz.enc -pass file:~/.config/tukuk/backup-key \
  | tar tz | wc -l                                              # must be ~90, and must include
                                                                 # .env, cloudflared/, nginx/, netplan/
tar tzf vps-handover.tar.gz | grep -c 'backup-identity.sh'      # must be 1
md5sum apk/tukuk-chat-release.jks                                # must equal the laptop copy
```

Then run the drill that has already passed once, so the restored state is proven rather than hoped
for: `sudo bash scripts/restore-identity.sh --stage /tmp/drill` and check it reports the file count
and 0 mismatches, then `rm -rf /tmp/drill` (it stages decrypted secrets — never leave it on disk).

### The proven restore point (measured 2026-10-28, with the box dead)

Retrieved from R2, decrypted and listed from the laptop — not from the box:

| archive | key | size | verified contents |
|---|---|---|---|
| data | `backups/tukuk-data-207.tar.gz` (2026-10-27 07:10 UTC) | 18,398,889 B | `gzip -t` OK, 3,019 entries, 31 top-level stores incl. `data/tukuk-os.json`, `chat.json`, `comments.json`, `leaderboard.json` |
| identity | `backups/tukuk-identity-27.tar.gz.enc` | 137,760 B | decrypts with the escrow key, 252 entries: `cert.pem` 1, tunnel `*.json` 2, `/opt/tukuk-os/.env` 1 (33 keys), ssh host keys 6, netplan 4, `nginx/conf.d` 3, 18 `tukuk-*` systemd units |

Both are also copied to the laptop at `~/vps-handover-2026-10-28/` (`sha256sum` recorded in
`SHA256SUMS` there) so a second vendor failure cannot take the only copy.

Passkeys survive: `src/auth.js` reads them through `store.getSetting('passkeys')`, which persists in
`data/tukuk-os.json` — a file present in the data archive above. So existing credentials restore,
they do not need re-enrolling.

Two lessons worth keeping:

- **`wrangler r2 object get` is not a reliable proof of existence.** It reported "The specified key
  does not exist" for keys that a Worker with an R2 binding lists and downloads in the same account.
  Prove retrievability through a bound Worker (or the app's own read path), never through one CLI call.
- The audit Worker used to do this, `tukuk-r2-audit` (one small file, token-gated list + get on the
  `tukuk-fallback` bucket), is still deployed because the new box needs it to pull these archives
  without the upload secret. **Delete it when the rebuild passes Part J:**
  `npx wrangler delete --name tukuk-r2-audit`.

## Part E — Install the OS

Either path is fine; both are already in the repo.

- Hands-off: `sudo bash deploy/build-iso.sh` (needs xorriso + a ~2.5 GB base download — run it on a
  machine that is not the 2 GB VPS and not while it is serving), producing
  `tukuk-os-server-24.04.iso`; `dd` to USB; it autoinstalls from `deploy/autoinstall/user-data`.
- Manual: standard Ubuntu 24.04 Server, "OpenSSH server" + "unattended upgrades" checked.

Either way, before first reboot:

- `deploy/autoinstall/user-data` ships a default password (`tukuk123`) and `allow-pw: true`. Change
  it, or accept that both are documented in a git repo.
- Keep the hostname `tukuk-os` if you can: several systemd units and admin pages assume paths, not
  names, but the journald history and your own muscle memory do not.

## Part F — Network: do not repeat this incident

1. One physical NIC = one ethernet. **A bond needs two NICs and a switch that agrees on the mode.**
   With one NIC a bond adds a virtual layer whose only guarantees are the failure modes you have not
   tested.
2. Cockpit's *Network* page writes NetworkManager connections. On an Ubuntu server where
   `/etc/netplan` + networkd own the interfaces, that is a second writer of the same truth: the two
   disagree and you lose connectivity, exactly as happened here. Edit network config in **one** of
   the two, never both.
3. Use `sudo netplan try`, not `sudo netplan apply`. `try` rolls the config back automatically after
   120 s if you do not press Enter — which means a bad address or gateway cannot lock you out of
   SSH. Read the correct values out of the identity archive (`etc/netplan/*.yaml`) instead of
   retyping them from memory.
4. Set the static address, gateway `192.168.8.1` and a nameserver, then prove the two things that
   matter independently:
   ```bash
   ip route | grep default                                  # routing
   curl -sI --max-time 8 https://api.cloudflare.com | head -1   # outbound, past DNS too
   ```
5. Only after both pass: `sudo systemctl enable --now cloudflared` and wait for `tukuk.org` to stop
   answering 530.

## Part G — Bring the app up

The repo is **private** (both GitHub repos answer `404` to an unauthenticated request), so a fresh
clone over HTTPS fails and a clone over SSH needs a key the new box does not have yet. Three
supported paths, best first:

```bash
sudo git clone -b main /media/usb/code/tukuk-os-v2-main.bundle /opt/tukuk-os   # 1. no credentials needed
sudo bash scripts/install-from-usb.sh                                          # 2. directory copy
git clone git@github.com:tukuk/tukuk-os.git /opt/tukuk-os                      # 3. after adding a box key
```

Path 2 is the one that has bitten before: `install-from-usb.sh` rsyncs with `--exclude .git`, so the
box it produces has **no history and no remote**, and the daily `tukuk-update` timer (`git pull
--ff-only`) is dead from the first day — silently, because everything else works. Use a bundle, and
repoint its `origin` (step 5 below).

Everything after that is **one command**, and it is the command to run even when the box is
already half-built (it is idempotent, and it ends with a PASS/FAIL table instead of a promise):

```bash
sudo bash scripts/rebuild-from-offsite.sh
```

It runs `setup-all.sh`, finds the newest identity + data archives by **listing** the bucket through
the project's own backup gateway (`GET ?prefix=`), decrypts them, restores only the paths this
project owns, cuts nginx over in front of Node, enables every timer, and verifies what a visitor
can actually see. `FAILS>0` means exit 1 — a rebuild that "finished" while the site was down is the
failure this script exists to prevent.

### The handover set (every row measured 2026-10-28)

`~/vps-handover-2026-10-28/` is what has to be on the stick, so that the two prerequisites below
exist *before* the old disk is formatted rather than being chased afterwards over SSH:

| file | bytes | proof it is usable |
|---|---|---|
| `code/tukuk-os-v2-main.bundle` | ≈39.7 MB (exact figure lives in `SHA256SUMS` on the stick, not here — a byte count in a file the bundle carries goes stale on every commit) | `git bundle verify` → "records a complete history", `refs/heads/main` = the pushed HEAD |
| `code/station-break-game.bundle` | 869,119,994 | `git bundle verify` → complete history, `refs/heads/game`; 1,114 tracked files, 0 LFS pointers |
| `id.enc` | 137,760 | decrypts with `key/tukuk-backup-key` **alone**: `gzip -t` OK, 252 entries, 12 `etc/cloudflared/` files |
| `data.tar.gz` | 18,398,889 | `gzip -t` OK, 3,019 entries |
| `key/tukuk-backup-key` | 45 | the escrow key; nothing else decrypts `id.enc` |
| `key/tukuk-chat-release.jks` | 2,302 | md5 `589d30f8e7476d779c5a9d6d60b431b6` — compare against a released APK before trusting it |
| `key/keystore.env` | 614 | md5 `48c47bba542c…` |

A bundle rather than a directory copy for the same reason the clone is a problem: it needs no
GitHub credentials on a machine that has none yet, and it carries history.

**Regenerate it last, after the final push** — a bundle cut before the docs commit ships a stick
whose code tells you to run steps that commit added. Then re-run `sha256sum -c`:

```bash
git bundle create ~/vps-handover-2026-10-28/code/tukuk-os-v2-main.bundle refs/heads/main
git bundle verify ~/vps-handover-2026-10-28/code/tukuk-os-v2-main.bundle   # must say "complete history"
git clone -q -b main ~/vps-handover-2026-10-28/code/tukuk-os-v2-main.bundle /tmp/sticktest \
  && git -C /tmp/sticktest log --oneline -1 && rm -rf /tmp/sticktest        # must be the pushed HEAD
(cd ~/vps-handover-2026-10-28 && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum > SHA256SUMS \
  && sha256sum -c SHA256SUMS)                                              # every line OK
```

First boot, in order — the entire sequence, no other terminal work required:

```bash
sudo git clone -b main /media/usb/code/tukuk-os-v2-main.bundle /opt/tukuk-os
cd /opt/tukuk-os
sudo cp /media/usb/key/tukuk-backup-key /root/tukuk-backup-key && sudo chmod 600 /root/tukuk-backup-key
sudo FORCE_DATA=1 bash scripts/rebuild-from-offsite.sh
# only if play.tukuk.org has to be rebuilt as well (~1.3 GB of Godot + template downloads):
sudo INSTALL_GAME=1 TUKUK_GAME_BUNDLE=/media/usb/code/station-break-game.bundle bash scripts/setup-all.sh
# 5. once this box has a GitHub key, and only then, hand the remote back to GitHub:
sudo git -C /opt/tukuk-os remote set-url origin git@github.com:tukuk/tukuk-os.git
```

`FORCE_DATA=1` is on that line for a reason, and it is the one flag whose absence is invisible:
step 1 of the rebuild runs `setup-all.sh`, which installs **and starts** the app, and the app creates
`data/tukuk-os.json` on boot. By the time step 3 reaches the data archive, the guard that rightly
refuses to overwrite a live data dir sees a file the install itself made — so the units, `.env`,
cloudflared and ssh keys come back and the site's memory does not. Measured on this box 2026-10-28:
the plain run printed `data/ already present — not overwritten` and its own table then reported
`0 passkey(s), 0 user record(s)`. The refusal is correct for a box that has been serving for weeks;
on a box that was installed minutes ago it is the bug. The row now names the live counts so the
choice is made from numbers rather than from a guess.

Step 5 is not busywork: cloning from a bundle records `origin` as **the path of the stick** (proved
by `git remote -v` in a test clone of this very bundle), so the daily `tukuk-update` timer would go
on fetching a USB that is no longer in the machine — the box stays up and never takes another commit.
`rebuild-from-offsite.sh` prints that as a `NEXT` line in its final table rather than a failure, so it
cannot be missed and cannot stop the rebuild.

Step 4 is deliberately not part of `npm install`: a routine deploy must not spend half an
hour and a gigabyte on a page it never touches.

`rebuild-from-offsite.sh` refuses to start unless `$APP/package.json` and `/root/tukuk-backup-key`
both exist, and names which one is missing — the first two lines above are preconditions it checks,
not conventions.

Keep the stick's permissions asymmetric on purpose: directories `700`, files `600`. Applying `600`
to the directories as well makes their contents unlistable, which looks exactly like a wrong key
(`0 entries` back from `tar tz`) and sends you hunting for a backup problem that is only a mode bit.

### What each path really installs (measured against the live box's own file list)

| piece | plain `npm install` | + `rebuild-from-offsite.sh` |
|---|---|---|
| Node 22, ZRAM, sysctl, Meilisearch + unit | yes | yes |
| `tukuk-os`, watchdog, snapshot, chat-backup, auto-update | yes | yes |
| nginx front (public hostnames → `:3000` nginx → `:3001` Node) | yes — added; before this it was never installed | yes |
| `tukuk-play.conf` incl. the `.pck.zip` edge-cache alias | yes — added; `install-tukuk-front.sh` never copied it | yes |
| data/content/indexnow/load-governor/weight-report/builder timers | yes — added from `deploy/` | yes |
| Cockpit, LAN-only | yes — added (`cockpit.socket.d/40-lan-only.conf`, regenerated at boot by `cockpit-lan-socket.service`) | yes |
| ONE tunnel `tukuk.org`/`www`/`tchat`/`agent`/`play`/`build` (token mode) | yes — **but only if `deploy/env.secrets` is on the box**: `CF_TUNNEL_TOKEN` left `env.defaults` with the split, and `make-env.sh` exits 3 naming what is missing | yes (the archive's `.env` lands at step 3) |
| the private half `deploy/env.secrets` (tunnel token, API token, admin credential, agent token, upload secret) | **no** — gitignored on purpose, so no clone can carry it | **no** — put it on the handover stick; `install-from-usb.sh` refuses without it |
| ~~second tunnel~~ `play`/`tchat`/`build` — **retired**, they are routes on `c1d8ea0f` | n/a — nothing to restore | n/a — the routes live at the edge in the dashboard |
| `data/` — the site's memory (posts, history, stats, events, chat, counters; passkeys *would* live here) | **no** | **yes** (archive) with `FORCE_DATA=1` — see the first-boot note |
| passkey credentials | **no** | **no** — the archive itself held none: `settings.passkeys` is `[]` and `users` is `{}` in `data/tukuk-os.json` as backed up 2026-10-27 |
| ssh host keys, `/etc/hosts`, real `.env` | **no** | **no** netplan (deliberately) / **yes** for the rest |
| Godot HD build in `/opt/tukuk-os/apps/play` | **no** — opt-in with `INSTALL_GAME=1` (`[8f]`) | **no** — same gate; the script prints the exact command |
| Builder **source** in `/opt/tukuk-os/apps/builder` | **no** — `[8d-bis]` clones it and `tukuk/tukuk-builder` is not anonymously readable, so it warns and continues | **no** — same; bring it over with `scripts/deploy-builder.sh` from the laptop instead |
| APK keystore `apk/*.jks` | **no** | **no** — copy from the laptop, then compare md5 against a released APK |

Two traps this table is written to defuse:

- `deploy/tukuk-os.service` is the **developer** variant (`WorkingDirectory=/home/tukuk/tukuk-os`,
  `WantedBy=default.target`). The unit that runs is generated inline by `setup-all.sh`. Copying the
  `deploy/` file onto a server yields a service that cannot start, so `[8d]` deliberately skips it.
- `restore-identity.sh --apply` copies the **whole** `/etc`. On a fresh box that dumps ~100 foreign OS
  units (snapd, cloud-init, grub) into `/etc/systemd/system` and replaces `/etc/netplan` with the old
  machine's interface names. The rebuild script therefore restores selectively and leaves netplan in
  `etc-netplan-reference/` for a human to adapt with `netplan try`.

### The check `bash -n` cannot do, and what it cost

`set -u` makes a read of a variable the script never assigned **fatal at runtime**, and `bash -n`
accepts it because it is valid syntax. On this rebuild it happened twice in a row, in the same line:
`$CFGRID`, then — while "fixing" it — `$CFID` for the real name `CFGID`. Both deaths landed right
after the identity archive's `.env` was installed, so the netplan reference, the `data/` restore, the
front-proxy step, the timer enabling and the whole verify table never ran, while the log above them
looked like a normal successful install.

`node scripts/check-shell-vars.js scripts/rebuild-from-offsite.sh` prints any name that is read with
no assignment and no `${NAME:-default}`. `npm test` runs it over every `set -u` script under
`scripts/` and `deploy/` (`test/deploy-scripts-variables.test.js`), together with `bash -n`
for each file, and its first group proves the scanner is not vacuous by feeding it the exact shape of
the incident. It is approximate on purpose: it knows quoted heredocs and single-quoted awk/`node -e`
programs are not shell, so `$GODOT_HEAD_INCLUDE` and `$NF` do not become findings.

Two neighbours of the same class, both caught by hand on this rebuild and both pinned in that file:
a **function called above its own definition** (`store_shape` was used by the data guard before step 5
defined it — `command not found` inside `VAR=$(…)` is fatal under `set -e`), and an **awk program with
two adjacent regexes** (`'/:3001/:3000/{print $4}'`) that `bash -n` waved through and awk rejected,
so the FAIL row printed an empty detail and a cutover that had never happened looked like a mystery.

The general lesson for this box, stated where it will be read: **when a measurement and your own
reasoning disagree, the measurement wins.** The throwaway version of that scan flagged `CFID` after
the first "fix" and it was overruled as a false positive; the next run died on `CFID`.

### Two files, one `.env`

`deploy/env.defaults` is publishable. `deploy/env.secrets` is not in git. `scripts/make-env.sh` merges
them into `.env` (secrets last, so a stale placeholder in the public half can never shadow a real
value), and `setup-all.sh`, `install-from-usb.sh` and `rebuild-from-offsite.sh` all call that one
script instead of each keeping its own copy rule. The app never sees either file — `src/config.js` reads
`.env`, so nothing in the server code changed.

Why the split had to happen: the public half used to hold the tunnel token, the Cloudflare account API
token, the admin email+password, the agent bearer and the off-site upload secret. That is what kept the
repository private — and it is the wrong reason to keep a repository private, because every CI job,
every mirror and every "just make it public" decision has to be argued against it forever. A tunnel
token in particular is not a mild leak: the edge authenticates the **token**, so whoever holds it can
point `tukuk.org` at their own machine and the browser will never know the difference.

What a fresh box therefore needs, in order:

1. the code (bundle, clone, or USB copy);
2. `deploy/env.secrets` — the single out-of-band object. Copy it to `deploy/`, or keep it anywhere and
   run `TUKUK_SECRETS=/path/to/env.secrets sudo bash scripts/make-env.sh --force`;
3. `sudo bash scripts/setup-all.sh`.

For GitHub Actions the file is never read from disk: the workflows take the same values from the
repository's encrypted Secrets (Settings → Secrets and variables → Actions), which is what makes the
tukuk account usable as the CI/CD home without publishing a credential. `test/secret-hygiene.test.js`
fails the build if a live-shaped value reappears in any tracked file, and it also catches the shape a
`KEY=value` scanner misses: a key written as a JS fallback (`process.env.X || '<literal>'`), which is
exactly how the NASA and OpenWeather keys were sitting in `src/config.js`.

### Reading a tunnel token back when the connector refuses it

Both tunnels still exist at the edge (`status: down` only because the connector is off), and a
connector token is a **readable** value — `GET /cfd_tunnel/<uuid>/token` returned the same string on
repeated calls, so this does not rotate the credential the running box is using:

```bash
ACC=$(awk -F= '/^CLOUDFLARE_ACCOUNT_ID=/{print $2}' deploy/env.defaults)
APIT=$(awk -F= '/^CLOUDFLARE_API_TOKEN=/{print $2}' deploy/env.secrets)
curl -4 -s -H "Authorization: Bearer $APIT" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/cfd_tunnel/c1d8ea0f-b512-487b-b7e7-ad730c24da9e/token" \
  | sed 's/.*"result":"//; s/".*//'      # → paste as CF_TUNNEL_TOKEN into deploy/env.secrets, then make-env.sh --force
```

Measured 2026-10-28: the token then in `deploy/env.defaults` and the one in the dead box's
`/etc/cloudflared/config.yml` were identical to each other but **different** from what the edge
issues now — two credentials for the same tunnel UUID (`t` field decodes to `c1d8ea0f…` in both).
The edge-issued one is what `env.secrets` carries today, because "what the API returns today" beats
"what was in the file last autumn".

Also measured: the main tunnel's config has `source: "cloudflare"`, so **every** hostname
(`tukuk.org`/`www`/`dashboard`/`tchat`/`play`/`build`/`agent`) is stored **at the edge** — a rebuilt
box needs the token only, and its local `ingress:` block does not decide routing. That is exactly why
the second tunnel (`a3af5bb4`, `source: "local"`, credentials-file mode) is gone: it existed only to
bypass that limit, and it left one hostname group restorable *only* from the identity archive. Now
there is one connector, one token, and one place hostnames are added — the dashboard.

Still manual, by design (each has a live test, not a hope):

- The Builder's **source** does not come off the stick. `tukuk/tukuk-builder` is not readable
  anonymously, so `setup-all.sh`'s clone in `[8d-bis]` needs an identity a freshly formatted box
  does not have yet — it warns and carries on, and `build.tukuk.org` answers 502 until the source
  arrives. The path that involves GitHub not at all runs **on the laptop**:
  ```bash
  TUKUK_HOST=<box-ip> bash scripts/deploy-builder.sh   # rsyncs the fork's working copy → apps/builder,
  ```
  which installs and builds on the box, then restarts `tukuk-builder.service`. Check which is true
  before blaming the script: `git ls-remote https://github.com/tukuk/tukuk-builder.git` from anywhere
  with a browser session answers for the whole account — a repository that is merely private and one
  that has not been created yet both reply the same way.

- Godot HD build: `sudo INSTALL_GAME=1 TUKUK_GAME_BUNDLE=<stick>/code/station-break-game.bundle bash scripts/setup-all.sh`.
  That runs `deploy/godot/build-web.sh` (clone the game if `STATION_BREAK_DIR` is empty → splice
  `deploy/godot/web-head.html` into a copy of the engine's own HTML template → headless export →
  assert the overlay really landed) and then `deploy/godot/publish-tukuk-play.sh`, which enforces
  the CDN contract: refuses a pack over 512 MB, publishes `index.pck` also as `index.pck.zip`,
  rewrites `mainPack` to `index.pck.zip?v=pck<sha256-12>`, refuses to publish if that rewrite found
  nothing to change, and then proves `cf-cache-status: MISS → HIT` at the edge. Both halves are
  covered by `npm test` (`test/godot-rebuild.test.js`, 10 tests) — including the refusal paths,
  which is the part that used to be only a hope. `--deploy` may not publish with a hand-written
  `sudo cp`: the sudoers entry grants only the publisher, and copying by hand would skip the alias.
  Check at the edge, never locally: Cloudflare Free caches by URL extension, so `.pck`/`.wasm` stay
  `DYNAMIC` while `.zip` goes `MISS → HIT`:
  ```bash
  V=$(grep -o 'pck[0-9a-f]\{12\}' /opt/tukuk-os/apps/play/index.html | head -1)
  curl -4 -s -D- -o /dev/null "https://play.tukuk.org/index.pck.zip?v=$V" | grep -i cf-cache-status
  ```
- `scripts/backup-b2.sh` + `deploy/tukuk-backup-b2.{service,timer}`: install only after
  `B2_ACCOUNT_ID`/`B2_APPLICATION_KEY`/`B2_BUCKET` are in `.env`, one real upload has run, and its
  remote MD5 has been read back. The script refuses a source archive older than 25 h.

## Part H — Cockpit, LAN only

`setup-all.sh` installs and binds Cockpit itself, so this part is a **check**, not a task:

```bash
cat /etc/systemd/system/cockpit.socket.d/40-lan-only.conf   # ListenStream= cleared, then 127.0.0.1 + every LAN IP the box has now
ss -ltnp | grep 9090                                        # 127.0.0.1:9090 and <lan-ip>:9090, nothing on 0.0.0.0
curl -k -s -o /dev/null -w '%{http_code}\n' https://<lan-ip>:9090/login   # 200 (the login page), never 000
```

Then open `https://<lan-ip>:9090/` in a browser (self-signed cert, so accept it once) and log in with
the `tukuk` account. Plain `http://` on the LAN answers **301** to https; on loopback it serves 200
directly. Three responses are easy to misread, so they are listed measured from this box (Cockpit
360-1, 2026-10-28):

| request | answer | reads as |
|---|---|---|
| `GET https://<ip>:9090/login` | **200** | healthy — this IS the login page (`#login-user-input`) |
| `GET https://<ip>:9090/cockpit/login` | **401** | also healthy — the *package* endpoint, not the login page |
| `POST https://<ip>:9090/cockpit/login` with `-u user:pass` | **405** | not a broken console — this build rejects the POST, so a **login can only be proven in a browser** |

A **000** on the first row is the failure that matters: nothing is listening, which is what a stale
drop-in produces while `systemctl is-active cockpit.socket` still says `active`.

The drop-in clears Cockpit's default `0.0.0.0`/`::` listeners (systemd list-type options **append**,
so the empty `ListenStream=` line is required) and re-listens on the box's own LAN IPv4 plus
loopback. The address list is **never stored**: `deploy/cockpit-lan-socket.sh` (installed as
`/usr/local/sbin/cockpit-lan-socket`, run at boot by `cockpit-lan-socket.service` and from
`setup-all.sh`) rewrites the drop-in from `ip -4 addr` whenever the answer changes. Pinning the lease
seen at install time is what made the console unreachable on 28 Oct 2026: the drop-in still pointed at
`192.168.8.104` after the box had moved to `.100`/`.101`, so `systemctl is-active cockpit.socket` said
`active` while every LAN connection was refused. The unit carries `Before=cockpit.socket` on purpose:
`cockpit.socket` starts from `sockets.target`, which is earlier than the `multi-user.target` the
regenerator is wanted by, so without it the socket comes up on the previous boot's drop-in and the
console is dead for the first seconds after any lease change. Loopback stays in the list so
`ssh -L 9090:127.0.0.1:9090 tukuk@<host>` still reaches the console. No firewall rule is added by a
script: automating `ufw` over SSH is how a box gets locked out a second time.

Never put Cockpit behind a public tunnel hostname. It is a root shell with a password prompt, and
the tunnel would hand it an internet-facing address. If remote eyes on the box are genuinely needed,
the correct shape is Cloudflare Zero Trust Access in front of it (policy: your email + TOTP), not a
bare public hostname — that requires dashboard work and is not done by a script.

## Part I — Service accounts: nothing runs as root

`tukuk-os.service` and `meilisearch.service` both run as the system user **`tukuk-os`**, created by
`setup-all.sh` [3b]. This is not tidiness. `POST /api/admin/terminal` (`src/server.js`) runs whatever
shell command an admin types, as the user the web service happens to be. With no `User=` line that was
**root**: one stolen admin cookie, one new route that forgot `auth.requireAdmin`, or one gap in the
destructive-command list was a root shell on the box — no privilege escalation needed. Measured on the
old unit, 2026-10-28: `User=(root)`, `ProtectSystem=no`, `ProtectHome=no`, and all 41 capabilities in
`CapabilityBoundingSet`.

The split is deliberate:

| path | owner | who writes |
|---|---|---|
| `/opt/tukuk-os` (code, `.git`, `scripts/`, `public/` minus `downloads/`) | `root` | root timers, `git pull`, deploys |
| `data/`, `snapshots/`, `dumps/`, `meili_data/`, `content/blog/`, `public/downloads/` | `tukuk-os` | the app; **also** root timers (auto-update, backups) |
| `/opt/tukuk-os/.env` | `tukuk` 0600 + ACL `u:tukuk-os:r--` | nobody — read-only to the service |

That middle row is the trap. `auto-update.sh` (root) writes `data/update-status.json`, and the two-minute
`load-governor` writes `data/load-*.json`. A file created by root in an owned-by-`tukuk-os` directory is
group-**read-only** by default, so the app would silently stop persisting the moment one of those landed
— no error, just stale data, exactly like the frozen Meilisearch key. So the dirs are `g+s` (setgid, so
new files inherit the group) and carry a **default ACL** `d:g:tukuk-os:rwX`, and every unit that writes
there keeps working regardless of who created the file.

Check it, on any box:

```bash
systemctl show tukuk-os.service   -p User -p Group -p ProtectSystem -p ProtectHome -p ReadWritePaths
systemctl show meilisearch.service -p User -p Group -p ProtectSystem
ps -o user,args -p "$(systemctl show -p MainPID --value tukuk-os.service)"     # tukuk-os, not root

# the service may write its runtime dirs …
runuser -u tukuk-os -- sh -c 'touch /opt/tukuk-os/data/.w && rm /opt/tukuk-os/data/.w' && echo OK
# …and must NOT write its own code, or the next edit is persistent
runuser -u tukuk-os -- touch /opt/tukuk-os/scripts/.w    # Permission denied = correct

# no file in data/ may have lost group-write to a root timer
find /opt/tukuk-os/data -maxdepth 2 ! -perm -g+w | head
```

The app is started with `ProtectSystem=strict` + `ProtectHome=yes` + an empty `CapabilityBoundingSet`,
so the tree it serves is read-only to it even if a route is buggy. Consequences to know: the admin
terminal can no longer `systemctl restart` anything (use SSH, or wait for the hourly `tukuk-update`),
`/api/apk` cannot rebuild an APK unless the Android SDK is visible (there is no SDK on this box — only
the prebuilt files in `public/downloads/` are served), and an editor write to `content/blog/*.md` works
because that path is in `ReadWritePaths`.

Rollback is one file, and it puts root back:

```bash
bash /root/root4-rollback.sh      # restores /root/root4-backup/*.pre-deroot and restarts both units
```

## Part J — Acceptance checklist

All of these, in this order, before the box is called "back":

1. `curl -s http://127.0.0.1:3000/health` → `"status":"ok"`.
2. `https://tukuk.org/` → 200 (not 530), and `https://tukuk.org/cari?q=weather` returns results.
3. Admin login with the restored `.env` credentials; one passkey assertion succeeds (if it does not,
   the WebAuthn RP origin/ID in `.env` is wrong — passkeys are bound to origin, and a mismatch means
   every existing credential is unreachable, not broken).
4. Godot gate + boot: the headless CDP probe must show `packRequests=0` before the click and a real
   canvas size after; edge cache `MISS → HIT → HIT` on `.pck.zip`.
5. Timers enabled and firing: `systemctl list-timers 'tukuk-*'` shows next runs, not an empty table.
6. Backup producers run and upload; **then** the drill: restore to a temp stage and diff.
7. Off-site retrievability actually proven (Part D's open problem closed).
8. `git -C /opt/tukuk-os status --porcelain` empty and the box can push.
9. Re-check the two things that used to be silently broken: `run/main_scene` in the game project and
   the presence of the control-hint overlay.
10. `systemctl show -p User --value tukuk-os.service` → `tukuk-os` (empty means root), the same for
    `meilisearch.service`, and `find /opt/tukuk-os/data ! -perm -g+w` is empty (Part I).

## Part K — Things that do not survive a wipe no matter what we back up

- **Passkey credentials** live in `data/tukuk-os.json` (see Part D), so they ride on the data
  archive. If that archive is lost, every user must re-register and admin passkeys are gone.
- **Legacy-connector provisioning** (`cert.pem`): without it, hostnames can only be added through
  the dashboard by hand.
- **Any APK signed with the old keystore** can only be updated by that keystore. Losing it does not
  break the site; it permanently breaks updates to the published apps.

### What the wipe actually took, and where it stands now

The two files that produced the flagship game were **never committed to anything** — they lived in
`~/station-break/tools/` on the box, `~/station-break` is not a backed-up path, and the game repo
still shows neither (`git ls-tree -r refs/heads/game` → `project.godot`, `export_presets.cfg`, no
builder, no overlay). Measured and resolved 2026-10-28:

| artifact | status |
|---|---|
| `tools/build-web.sh` | **rescued** into git as `deploy/godot/build-web.sh` — a surviving working copy was found in `.artifacts/tmp-build-web.sh` |
| `web-head.html` (the boot readout) | **recovered** as `deploy/godot/web-head.html`: `.artifacts/tmp-web-head.html` (the pre-fix draft) plus `.artifacts/tmp-fix-overlay.py` (the exact patch, both anchors matched, 2/2 swaps applied). `node --check` clean, and `test/godot-rebuild.test.js` pins both repairs so a re-draft fails. |
| any *later* box revision of either | **lost** — unrecoverable, and unknowable: there is no manifest to diff against |
| `/opt/tukuk-os/apps/play` (the built game) | **lost** — but it is a build product; `INSTALL_GAME=1` regenerates it |
| writes after 2026-10-27 07:10 UTC | **lost** — that is the newest off-site data archive |

Because the overlay is only now in git, `build-web.sh` resolves it as `$WEB_HEAD` →
`<project>/web-head.html` → the copy committed beside the script, and hard-fails if none exists. The
game repo does not need to gain the file: the platform repo carries it. Its header comment names
`html/custom_html_shell`, not `html/head_include`, because Godot 4.7 **silently ignores**
`head_include` — verified against a scratch project — and a comment pointing at the dead key is how
the next reader ends up shipping a shell with no progress readout at all.
