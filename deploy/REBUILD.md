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

`.gitignore` keeps `/opt/tukuk-os/.env`, `apk/*.jks` and `apk/keystore.env` out of git (lines 6, 7,
64, 65), so `git clone` + `npm install` alone cannot rebuild the box. The off-site archives close
that gap, and their retrievability is now **proven rather than assumed** (Part D). What still lives
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
| `/home/tukuk/station-break/` | the Godot game. In git on branch `game` **only if committed** — run `git -C ~/station-break status --porcelain | wc -l` first | partial |
| `/root/.ssh/`, `/home/tukuk/.ssh/`, `/home/tukuk/askpass.sh` | deploy keys and the HTTPS push helper | no |

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
  without the upload secret. **Delete it when the rebuild passes Part I:**
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

The repo is **private**, so a fresh clone over HTTPS fails. Two supported paths:
`sudo bash scripts/install-from-usb.sh`, or add a GitHub key for the new box, then
`git clone git@github.com:fevian448/tukuk-os-v2.git /opt/tukuk-os`.

```bash
sudo bash scripts/setup-all.sh        # idempotent: .env from deploy/env.defaults, packages, ZRAM,
                                      # sysctl, Node, nginx front, meilisearch, cloudflared token mode,
                                      # tukuk-os + update/watchdog/snapshot/agent units
bash scripts/setup-all.sh --help 2>/dev/null || true
```

`setup-all.sh` does **not** cover these, so they are manual and each has a live test:

- `.env`: restore the real one from Part C (`env.defaults` holds placeholders only, so a blank
  `CF_TUNNEL_TOKEN`/`ADMIN_PASSWORD` here silently degrades the box).
- `deploy/nginx/tukuk-play.conf` → `/etc/nginx/conf.d/`, then `sudo nginx -t && sudo systemctl reload nginx`.
  This file now carries the **`.pck.zip` alias location** that makes the 476 MB Godot pack
  edge-cacheable; without it every visitor streams the pack off this VPS. Verify at the edge, not
  locally — Cloudflare Free caches by URL extension, so `.pck`/`.wasm` are `DYNAMIC` no matter what
  we send, while `.zip` goes `MISS → HIT`:
  ```bash
  V=$(grep -o 'pck[0-9a-f]\{12\}' /var/www/tukuk-play/index.html | head -1)
  curl -4 -s -D- -o /dev/null "https://play.tukuk.org/index.pck.zip?v=$V" | grep -i cf-cache-status
  ```
- Godot HD build: in the game repo, `sudo -u tukuk -H bash tools/build-web.sh --deploy` (it injects
  `mainPack` and hard-fails if the pack would not be cached).
- Backup units — all already in git, just install and enable them:
  `deploy/tukuk-data-backup.{service,timer}`, `deploy/tukuk-identity-backup.{service,timer}`,
  `deploy/tukuk-content-backup.*`, `deploy/meili-backup.*`, `deploy/chat-backup.*`,
  `deploy/tukuk-os-watchdog.*`, `deploy/tukuk-snapshot.*`.
- `scripts/backup-b2.sh` + `deploy/tukuk-backup-b2.{service,timer}`: install only after
  `B2_ACCOUNT_ID`/`B2_APPLICATION_KEY`/`B2_BUCKET` are in `.env`, one real upload has run, and its
  remote MD5 has been read back. The script refuses a source archive older than 25 h.

## Part H — Cockpit, LAN only

```bash
sudo apt-get install -y cockpit cockpit-network
sudo systemctl enable --now cockpit.socket
ss -ltnp | grep 9090                                   # must be *:9090
sudo ufw allow in on <iface> from 192.168.8.0/24 to any port 9090 proto tcp
```

From the laptop: `https://192.168.8.101:9090` (self-signed cert is Cockpit's default; click through
once, then generate the real cert with `sudo cockpit-certificate-ensure`).

Never put Cockpit behind a public tunnel hostname. It is a root shell with a password prompt, and
the tunnel would hand it an internet-facing address. If remote eyes on the box are genuinely needed,
the correct shape is Cloudflare Zero Trust Access in front of it (policy: your email + TOTP), not a
bare public hostname — that requires dashboard work and is not done by a script.

## Part I — Acceptance checklist

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

## Part J — Things that do not survive a wipe no matter what we back up

- **Passkey credentials** live in `data/tukuk-os.json` (see Part D), so they ride on the data
  archive. If that archive is lost, every user must re-register and admin passkeys are gone.
- **Legacy-connector provisioning** (`cert.pem`): without it, hostnames can only be added through
  the dashboard by hand.
- **Any APK signed with the old keystore** can only be updated by that keystore. Losing it does not
  break the site; it permanently breaks updates to the published apps.
