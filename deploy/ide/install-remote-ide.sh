#!/usr/bin/env bash
# install-remote-ide.sh — put the remote-IDE stack (deploy/ide/) onto this box.
#
#   sudo bash /opt/tukuk-os/deploy/ide/install-remote-ide.sh
#   sudo bash /opt/tukuk-os/deploy/ide/install-remote-ide.sh --set-vnc-pass   # just rotate
#                                                     the password, change nothing else
#
# WHAT IT DOES, in order, and why the order is fixed rather than cosmetic:
#   1. root check and the repo-file check — every step below installs FROM this directory,
#      so a partial checkout (git pull skipped) must be caught once, at the top, instead of
#      half-installing the stack and leaving systemd pointed at an ExecStart= path that does
#      not exist yet.
#   2. the apt packages — the binaries every unit execs. Nothing else in this script can
#      succeed without them.
#   3. /etc/tukuk-ide/env — NEVER overwritten if it already exists (see keep_existing): a
#      rebuilt box that re-runs this script must not silently lose a hand-tuned
#      IDE_GEOMETRY/IDE_MEM_MAX, and it must not reset IDE_PAUSE_UNITS back to the repo
#      default either. This is the one file in the whole install with user edits in it.
#   4. /etc/tukuk-ide/vnc.pass — required, refuses to finish the install without one (see
#      ensure_vnc_pass): an unauthenticated x11vnc is precisely the thing layer 3 exists to
#      prevent, and "it works, I'll set a password later" is how that later never comes.
#   5. the systemd units — daemon-reload only. Nothing here calls `systemctl enable` on
#      remote-ide.target or any of its members, because none of them have an [Install]
#      section and that absence is the design (see README.md). The idle timer is the single
#      exception and is enabled explicitly.
#   6. ide-ctl + the sudoers grant — the narrow door ide-session.sh calls through.
#   7. the nginx server block, then `nginx -t` BEFORE a reload, restoring the previous file
#      if it does not parse — same reason as install-on-box.sh for the play origin: a bad
#      config reloaded here takes down every other hostname on the :3000 listener too.
#
# It never starts anything. The operator decides when a 4 GB stack is affordable, with
# `ide-session.sh start`; this script only makes that possible.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ETC=/etc/tukuk-ide
UNITS=(remote-ide.target remote-ide-xvfb.service remote-ide-wm.service remote-ide-vnc.service
       remote-ide-web.service remote-ide-terminal.service remote-ide-studio.service
       remote-ide-idle-stop.service remote-ide-idle-stop.timer)
SBIN_IDE_CTL=/usr/local/sbin/ide-ctl
NGX_SRC="$REPO/deploy/nginx/tukuk-ide.conf"
NGX_CONF=/etc/nginx/conf.d/tukuk-ide.conf

step() { echo "[ide-install] $*"; }
die()  { echo "[ide-install] FATAL: $*" >&2; exit 1; }

# ------------------------------------------------------------- 1. preflight ----
[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
for f in ide.env ide-session.sh ide-check.sh ide-idle-stop.sh ide-ctl.sh sudoers-tukuk-ide; do
  [ -f "$HERE/$f" ] || die "missing $HERE/$f -- is this the real repo checkout, not a partial copy? git pull first."
done
for u in "${UNITS[@]}"; do
  [ -f "$HERE/$u" ] || die "missing $HERE/$u"
done
[ -f "$NGX_SRC" ] || die "missing $NGX_SRC"

if ! id -u tukuk >/dev/null 2>&1; then
  die "no 'tukuk' user on this box -- every unit here is User=tukuk and Studio must own ~/.gradle as that user, not root."
fi

# --------------------------------------------------------------- 2. packages ----
step "checking packages"
PKGS=()
command -v Xvfb       >/dev/null || PKGS+=(xvfb)
command -v openbox    >/dev/null || PKGS+=(openbox)
command -v x11vnc     >/dev/null || PKGS+=(x11vnc)
command -v websockify >/dev/null || PKGS+=(websockify)
command -v xterm      >/dev/null || PKGS+=(xterm)
[ -f /usr/share/novnc/vnc.html ] || PKGS+=(novnc)
if [ "${#PKGS[@]}" -gt 0 ]; then
  step "installing: ${PKGS[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || step "WARN: apt-get update failed -- continuing with whatever index is already there"
  apt-get install -y --no-install-recommends "${PKGS[@]}" || die "apt-get install failed for ${PKGS[*]}"
else
  step "all packages already present"
fi

# ----------------------------------------------------------- 3. env + secrets ----
mkdir -p "$ETC"
keep_existing() {
  local src=$1 dst=$2
  if [ -f "$dst" ]; then
    step "keeping existing $dst (not overwriting a hand-edited file); repo copy is at $src if it needs diffing"
  else
    install -m 0644 "$src" "$dst"
    step "installed $dst from $src"
  fi
}
keep_existing "$HERE/ide.env" "$ETC/env"

ensure_vnc_pass() {
  # force=1 (--set-vnc-pass) regenerates even when a file already exists; without that, a
  # rotation run would print "already exists, not touching it" and change nothing, which is
  # the opposite of the only reason anyone would re-run this script in that mode.
  local force=${1:-0}
  if [ "$force" != 1 ] && [ -f "$ETC/vnc.pass" ]; then
    step "$ETC/vnc.pass already exists -- not touching it (rotate explicitly with --set-vnc-pass)"
    return 0
  fi
  if [ ! -t 0 ]; then
    step "REQUIREMENT not met: $ETC/vnc.pass does not exist and there is no terminal to prompt on."
    step "Set it, then re-run this script (or just the --set-vnc-pass mode below):"
    step "  printf '%s' 'YOUR-VNC-PASSWORD' | x11vnc -storestdin $ETC/vnc.pass"
    return 1
  fi
  local p1 p2
  printf 'Choose a VNC password for ide.tukuk.org (this is layer 3 of three, not a formality): ' >&2
  read -rs p1 >&2; echo >&2
  printf 'Repeat it: ' >&2
  read -rs p2 >&2; echo >&2
  [ "$p1" = "$p2" ] || { step "passwords did not match"; return 1; }
  [ "${#p1}" -ge 8 ] || { step "VNC truncates a password past 8 characters anyway, but shorter than 8 here is just asking for a guess; pick something longer."; return 1; }
  printf '%s' "$p1" | x11vnc -storestdin "$ETC/vnc.pass" || { step "x11vnc -storestdin failed"; return 1; }
  p1='' p2=''
  step "wrote $ETC/vnc.pass"
  return 0
}
SET_PASS_ONLY=0
[ "${1:-}" = "--set-vnc-pass" ] && SET_PASS_ONLY=1
if ! ensure_vnc_pass "$SET_PASS_ONLY"; then
  step "The stack is NOT usable without a VNC password (remote-ide-vnc.service will refuse to"
  step "start, and everything else in the target depends on it). Packages and config above are"
  step "installed and correct; finish this install with:  sudo bash $0 --set-vnc-pass"
  exit 1
fi
chown root:tukuk "$ETC/vnc.pass"
chmod 640 "$ETC/vnc.pass"
step "$ETC/vnc.pass is mode 640, root:tukuk -- readable by x11vnc running as tukuk, not by other users"

if [ "$SET_PASS_ONLY" = 1 ]; then
  step "password set; nothing else was changed by this run."
  exit 0
fi

# ------------------------------------------------------- 4. systemd units ----
step "installing systemd units"
for u in "${UNITS[@]}"; do
  install -m 0644 "$HERE/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
step "installed ${#UNITS[@]} units. Deliberately NOT enabled at boot (no [Install] section in"
step "the .service files -- see README.md). systemctl enable remote-ide.target would FAIL here"
step "even if tried, and that failure is the point, not a bug."

# The one thing in this stack that CANNOT be a single source of truth: systemd discards a
# ${VAR} it meets in a MemoryMax=/CPUQuota= directive instead of expanding it -- silently,
# with only a journal warning, and the unit still starts, just with no cap at all. So
# remote-ide-studio.service hard-codes the numbers, and /etc/tukuk-ide/env remains the place
# an operator edits them for scripts (ide-session.sh's own memory gate reads IDE_MEM_MAX
# there). If the two ever disagree, the cgroup limit protecting tukuk.org is not the one the
# env file says it is. This check is the only thing standing between that drift and a quiet,
# confusing outage.
studio_unit=/etc/systemd/system/remote-ide-studio.service
env_mem=$(awk -F= '/^IDE_MEM_MAX=/ {print $2}' "$ETC/env")
env_cpu=$(awk -F= '/^IDE_CPU_QUOTA=/ {print $2}' "$ETC/env")
unit_mem=$(awk -F= '/^MemoryMax=/ {print $2}' "$studio_unit")
unit_cpu=$(awk -F= '/^CPUQuota=/ {print $2}' "$studio_unit")
if [ -n "$env_mem" ] && [ "$env_mem" != "$unit_mem" ]; then
  die "IDE_MEM_MAX in $ETC/env ($env_mem) does not match MemoryMax= in $studio_unit ($unit_mem) -- fix BOTH to the same value, this cap is what protects the live site from an IDE runaway."
fi
if [ -n "$env_cpu" ] && [ "$env_cpu" != "$unit_cpu" ]; then
  die "IDE_CPU_QUOTA in $ETC/env ($env_cpu) does not match CPUQuota= in $studio_unit ($unit_cpu) -- fix both together."
fi
[ -n "$env_mem" ] && step "env/unit agree: MemoryMax=$unit_mem CPUQuota=$unit_cpu"

if systemctl enable --now remote-ide-idle-stop.timer; then
  step "enabled remote-ide-idle-stop.timer -- the one unit that is safe and correct to run always"
else
  step "WARN: could not enable the idle timer; a session left open by accident will not be reclaimed automatically."
fi

# ----------------------------------------------------------- 5. ide-ctl ----
install -m 0755 "$HERE/ide-ctl.sh" "$SBIN_IDE_CTL"
step "installed $SBIN_IDE_CTL"
install -m 0440 "$HERE/sudoers-tukuk-ide" /etc/sudoers.d/tukuk-ide
visudo -c -f /etc/sudoers.d/tukuk-ide >/dev/null || die "visudo rejected /etc/sudoers.d/tukuk-ide"
step "installed /etc/sudoers.d/tukuk-ide (visudo clean)"

# Prove the grant end to end, exactly like install-on-box.sh does for the publisher: call
# ide-ctl as tukuk, with no tty and no password. "restart" on a unit that is not running is
# a harmless no-op that still has to pass ide-ctl's own allowlist check to reach systemctl.
GRANT_OUT=''
GRANT_OUT=$(sudo -u tukuk -n "$SBIN_IDE_CTL" restart remote-ide.target 2>&1 || true)
case "$GRANT_OUT" in
  *"not a remote-IDE unit"*) die "ide-ctl's own allowlist rejected its own unit -- this is a bug in $HERE/ide-ctl.sh, fix it before shipping" ;;
  *"Failed to restart remote-ide.target"*|*"no process"*|"") step "grant ok: tukuk can run $SBIN_IDE_CTL without a password (systemd's own reply is irrelevant here, the point is that ide-ctl ran at all)." ;;
  *) step "grant check returned something unexpected -- verify by hand:  sudo -u tukuk -n $SBIN_IDE_CTL restart remote-ide.target"
     step "got: $GRANT_OUT" ;;
esac

# ------------------------------------------------------------- 6. nginx ----
if command -v nginx >/dev/null 2>&1; then
  PREV=''
  if [ -f "$NGX_CONF" ]; then
    PREV="$(mktemp)"
    cp "$NGX_CONF" "$PREV"
  fi
  cp "$NGX_SRC" "$NGX_CONF"
  if ! nginx -t >/dev/null 2>&1; then
    [ -n "$PREV" ] && mv -f "$PREV" "$NGX_CONF"
    step "FATAL: nginx -t rejected $NGX_CONF; the previous file is back and nginx was NOT reloaded."
    step "This also affects every other hostname on the :3000 listener, so it is worth the noise." >&2
    nginx -t || true
    exit 1
  fi
  rm -f "$PREV"
  systemctl reload nginx
  step "installed and reloaded: $NGX_CONF"
else
  step "WARN: nginx is not installed on this box -- skipping the edge step. ide.tukuk.org needs"
  step "$NGX_SRC installed into /etc/nginx/conf.d/ before the tunnel will reach the stack at all."
fi

step "install complete. Next steps, in order:"
step "  1. bash $HERE/ide-check.sh                  # everything above, verified"
step "  2. bash $HERE/ide-session.sh start           # as the tukuk user, not root"
step "  3. Cloudflare Access + ONE dashboard route for ide.tukuk.org on tunnel c1d8ea0f -- see"
step "     README.md, 'DASHBOARD SIDE': the current API token cannot do either one programmatically."
step "     Do not create a second tunnel for it; one connector carries every hostname."
