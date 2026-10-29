#!/usr/bin/env bash
# ==============================================================================
# ship-to-box.sh — push work from this dev box to the VPS and deploy it.
#
# WHY THIS EXISTS. The VPS cannot fetch from GitHub: its read-only deploy key is gone
# from /root/.ssh, so `origin` in /opt/tukuk-os is a git BUNDLE on the box's own disk
# (/home/tukuk/handover/code/tukuk-os-v2-main.bundle) that gets refreshed from here.
# Until now that was a spell repeated by hand out of scattered .artifacts/*.sh files —
# build a bundle, scp it, verify it, rotate it, sudo systemctl start, read the journal.
# This is that procedure, once, with the checks that were being skipped.
#
#   bash scripts/ship-to-box.sh                 # ship the current branch (main)
#   TUKUK_HOST=192.168.8.100 bash scripts/ship-to-box.sh
#   bash scripts/ship-to-box.sh --branch main --no-deploy   # stage only
#
# What it guarantees:
#   * the pushed commit is on GitHub first, so the bundle is never the only copy;
#   * the bundle is verified INSIDE the repo it will be merged into before it replaces
#     the file `origin` points at, and the previous bundle is kept as .pre-<sha>;
#   * the box's own HEAD is what gets diffed, so a re-run after a successful deploy is a
#     no-op instead of a failed journal assertion (nothing was merged, so nothing logged);
#   * the sudo password is read from the box's own 0600 file (/home/tukuk/.ssh/
#     initial-password.txt) on the box — never argv, never this machine, never printed;
#   * the deploy is not believed until /opt/tukuk-os reports the shipped sha.
#
# The update itself is the repo's own scripts/auto-update.sh via tukuk-update.service:
# fetch → merge --ff-only → (npm install if dependencies changed) → restart tukuk-os.
# It is fail-safe: a dirty tree aborts the merge rather than overwriting anything.
# ==============================================================================
set -euo pipefail

BRANCH="main"
DEPLOY=1
HOST="${TUKUK_HOST:-tukuk-vps}"          # ssh alias in ~/.ssh/config; falls back to any host
REPO_DIR="/opt/tukuk-os"
BUNDLE_ON_BOX="/home/tukuk/handover/code/tukuk-os-v2-${BRANCH}.bundle"
PWFILE="/home/tukuk/.ssh/initial-password.txt"
ZONE="${CLOUDFLARE_ZONE_NAME:-tukuk.org}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a name}"; BUNDLE_ON_BOX="/home/tukuk/handover/code/tukuk-os-v2-${BRANCH}.bundle"; shift 2 ;;
    --host) HOST="${2:?--host needs a target}"; shift 2 ;;
    --no-deploy) DEPLOY=0; shift ;;
    *) echo "ship-to-box: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

say() { printf '[ship] %s\n' "$*"; }
die() { echo "ship-to-box: $*" >&2; exit 1; }

# SSH here always with </dev/null. ssh consumes its stdin, so a helper that inherits an
# unread pipe swallows whatever the loop or the next command was about to read — the
# classic `while read … do ssh …` loop that runs once. Nothing of ours needs stdin, so
# it is closed explicitly, and the transfer is measured at the far end anyway, because a
# truncated bundle is still a file and scp has no opinion about whether you meant it.
box() { ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$HOST" "$@" </dev/null; }

# One command as root on the box. The password is read on the box, substituted by the
# REMOTE shell, and piped into `sudo -S` — it is never an argument here or there, never
# printed, and never leaves the machine. Deliberately no local variable holding it: the
# suite scans every set -u script under scripts/ for reads with no assignment, and a
# variable that only exists inside a quoted ssh command string is exactly such a read.
rootcmd() { box "printf '%s\n' \"\$(cat '$PWFILE')\" | sudo -S -p '' $1"; }

command -v git >/dev/null || die "git is not installed"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
cd "$(git rev-parse --show-toplevel)"

SHA="$(git rev-parse "$BRANCH")" || die "branch $BRANCH does not exist"
SHORT="$(git rev-parse --short "$BRANCH")"
say "shipping $BRANCH @ $SHORT ($(git log -1 --format=%s "$BRANCH"))"

# ── 1. GitHub first ────────────────────────────────────────────────────────────────
# The bundle is the delivery mechanism, not the backup: if this box is the only place the
# commit exists, a lost laptop takes the deploy with it.
BEHIND="$(git rev-list --count "origin/$BRANCH..$BRANCH" 2>/dev/null || echo '?')"
if [[ "$BEHIND" == "?" ]]; then
  say "origin/$BRANCH is unknown — fetching to find out"
  git fetch -q origin "$BRANCH" || die "cannot reach origin (offline?); refusing to ship"
  BEHIND="$(git rev-list --count "origin/$BRANCH..$BRANCH")"
fi
if [[ "$BEHIND" != "0" ]]; then
  say "$BEHIND commit(s) ahead of origin — pushing"
  git push -q origin "$BRANCH" || die "push failed; nothing was shipped"
fi
git branch -r --contains "$SHA" | grep -q "origin/$BRANCH" || die "$SHORT is not on origin/$BRANCH"
say "origin/$BRANCH has $SHORT"

# ── 2. where the box actually stands ────────────────────────────────────────────────
# Everything downstream is measured against this, not against this repo's reflog: the
# branch moved yesterday is not the same thing as the code that is running.
ONBOX="$(box "cd '$REPO_DIR' && git -c safe.directory='$REPO_DIR' rev-parse HEAD")" \
  || die "cannot read $REPO_DIR/HEAD on $HOST"
say "the box is at ${ONBOX:0:7}"
# auto-update.sh merges with --ff-only, which is a polite way of saying it gives up when
# the box has a commit that main does not. Find that out here rather than in a journal.
if git cat-file -e "$ONBOX" 2>/dev/null && ! git merge-base --is-ancestor "$ONBOX" "$SHA" 2>/dev/null; then
  die "the box has commits that $BRANCH does not — --ff-only would refuse; reconcile $REPO_DIR first"
fi

# ── 3. build + stage the bundle ─────────────────────────────────────────────────────
TMP="$(mktemp "${TMPDIR:-/tmp}/tukuk-ship.XXXXXX")"; trap 'rm -f "$TMP"' EXIT
git bundle create "$TMP" "$BRANCH" >/dev/null 2>&1 || die "git bundle failed"
git bundle verify "$TMP" >/dev/null 2>&1 || die "the bundle does not verify against this repo"
LOCAL_BYTES=$(stat -c %s "$TMP")
say "bundle ready: $LOCAL_BYTES bytes, complete history, tip $SHORT"

box "mkdir -p \"\$(dirname '$BUNDLE_ON_BOX')\"" || die "cannot prepare the handover directory on $HOST"
scp -q -o StrictHostKeyChecking=no "$TMP" "$HOST:$BUNDLE_ON_BOX.new" || die "scp failed"
REMOTE_BYTES="$(box "stat -c %s '$BUNDLE_ON_BOX.new' 2>/dev/null || echo 0")"
[[ "$REMOTE_BYTES" == "$LOCAL_BYTES" ]] || die "the bundle arrived as $REMOTE_BYTES bytes, expected $LOCAL_BYTES"
say "transferred: $REMOTE_BYTES bytes verified at the far end"

# Verify inside the real repo: a bundle can be well-formed and still un-mergeable here.
box "cd '$REPO_DIR' && git -c safe.directory='$REPO_DIR' bundle verify '$BUNDLE_ON_BOX.new'" >/dev/null \
  || die "the box cannot verify this bundle inside $REPO_DIR"

# A new tracked path that already exists on the box UNTRACKED makes `merge --ff-only`
# refuse the whole update (and the nightly timer dies silently with it). Diffed against
# $ONBOX — the code the box runs — so it catches exactly what this ship is adding.
# --untracked-files=all matters: the default collapses a directory to "?? build/" and a
# directory name never matches the file paths being added, so the check would find nothing.
NEW_PATHS="$(git diff --name-only --diff-filter=A "$ONBOX" "$BRANCH" 2>/dev/null || true)"
if [[ -n "$NEW_PATHS" ]]; then
  # Read-only probe as the unprivileged ssh user; if it cannot read the tree the ship
  # still goes ahead, because the journal assertion downstream catches a refused merge.
  UNTRACKED="$(box "cd '$REPO_DIR' && git -c safe.directory='$REPO_DIR' status --porcelain --untracked-files=all" \
    | sed -n 's/^?? //p' || true)"
  COLLIDING="$(printf '%s\n' "$NEW_PATHS" | grep -Fxf <(printf '%s\n' "$UNTRACKED") || true)"
  [[ -z "$COLLIDING" ]] || die "these paths are untracked on the box and would be overwritten: $(printf '%s' "$COLLIDING" | tr '\n' ' ')"
fi

# ── 4. rotate, install ──────────────────────────────────────────────────────────────
box "mv '$BUNDLE_ON_BOX' '$BUNDLE_ON_BOX.pre-$SHORT' 2>/dev/null || true
     chmod 600 '$BUNDLE_ON_BOX.new' && mv '$BUNDLE_ON_BOX.new' '$BUNDLE_ON_BOX'
     ls -l '$BUNDLE_ON_BOX'" >/dev/null || die "could not install the bundle on the box"
say "origin bundle now points at $SHORT (previous copy kept as .pre-$SHORT)"

[[ "$DEPLOY" == "1" ]] || { say "--no-deploy: staged only. Run: systemctl start tukuk-update.service"; exit 0; }

# Staging an already-live sha is a no-op, and saying so is better than starting a unit
# that will answer "Already up to date" and then fail its own journal assertion.
if [[ "$ONBOX" == "$SHA" ]]; then
  say "the box is already at $SHORT — bundle refreshed, nothing to deploy"
  exit 0
fi

# ── 5. deploy through the repo's own update unit ────────────────────────────────────
say "starting tukuk-update.service as root (password read from $PWFILE on the box)"
rootcmd "systemctl start tukuk-update.service" || die "could not start the update unit"

# The unit is Type=oneshot and auto-update.sh does a fetch + merge + restart, so the
# journal is the proof — but it lands a few seconds late. The last real ship (c9ed781 →
# 3da96fe, a ~40 MB bundle) took nine seconds end to end; this polls for up to forty and
# stops the moment the shipped sha shows up, so a slow merge is not called a failure.
JOURNAL=""
for _ in $(seq 1 20); do
  sleep 2
  JOURNAL="$(rootcmd "journalctl -u tukuk-update.service --since '-2 min' --no-pager | tail -25" || true)"
  printf '%s\n' "$JOURNAL" | grep -qF "$SHORT" && break
done
printf '%s\n' "$JOURNAL" | sed 's/^/[tukuk-update] /'
[[ -n "$JOURNAL" ]] || die "tukuk-update.service logged nothing — is the unit installed? (systemctl cat tukuk-update.service)"
printf '%s\n' "$JOURNAL" | grep -qE "merge-failed|working tree changed" && die "the merge was refused: the box's tree has diverged"
printf '%s\n' "$JOURNAL" | grep -qF "$SHA" || printf '%s\n' "$JOURNAL" | grep -qF "$SHORT" \
  || die "the update did not report $SHORT — check: systemctl status tukuk-update.service"

# ── 6. confirm the running process is the shipped code ──────────────────────────────
LIVE="$(box "cd '$REPO_DIR' && git -c safe.directory='$REPO_DIR' rev-parse HEAD")"
[[ "$LIVE" == "$SHA" ]] || die "$REPO_DIR is at $LIVE, not $SHA"
say "repo on the box: $LIVE"
HEALTH="$(box "curl -s --max-time 10 http://127.0.0.1:3000/health" || true)"
printf '%s\n' "$HEALTH" | grep -q '"status":"ok"' || say "WARNING: /health did not answer ok — check: systemctl status tukuk-os"
# The box keeps its own record of every update — stage, result, the two commits — and
# publishes it on /health (src/update-status.js, written by scripts/auto-update.sh). It
# exists because "nothing happened" and "the timer died in March" look identical from
# outside, so a deploy that only checks git HEAD is checking the wrong thing: the record
# proves the service actually restarted onto this commit. A WARNING, not a death, because
# the nightly timer can legitimately overtake this record minutes after a ship.
if printf '%s\n' "$HEALTH" | grep -qF "\"to\":\"$SHA\""; then
  # `[^}]*` and not `.*`: the record has no nested object, and a greedy match on a
  # single-line JSON response would happily print the rest of /health too.
  say "update record agrees: $(printf '%s\n' "$HEALTH" | grep -o '"update":{[^}]*}' | head -1)"
else
  say "WARNING: /health does not report an update to $SHORT — the tree is right, but read"
  say "         https://$ZONE/health's update block before calling this shipped."
fi
say "public site: https://$ZONE/ — HTML is served through the edge with s-maxage=300, so an
        audit run in the next few minutes can still measure the PREVIOUS deploy. Purge with
        deploy/purge-edge-cache.sh (needs a token with Zone:Cache Purge) or wait out the TTL."
say "shipped and deployed: $SHORT"
