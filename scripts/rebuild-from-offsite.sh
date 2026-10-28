#!/usr/bin/env bash
# ==============================================================================
# rebuild-from-offsite.sh — bring a brand-new box up to the live box's state.
#
#   sudo bash scripts/rebuild-from-offsite.sh
#
# One command after the code is on disk. It runs the normal setup, then pulls the
# two off-site archives (identity + data) out of R2, restores the parts of the old
# box that git cannot carry, turns on every service, and finishes with a PASS/FAIL
# table. Exit code is non-zero if anything a visitor can see is broken — because a
# rebuild that "finished" while the site was down is the exact failure this script
# exists to prevent.
#
# Two deliberate design rules, both learned the hard way:
#
# 1. NEVER source .env. It holds `WEBAUTHN_RP_NAME=Tukuk Passkey`, which bash
#    parses as "assign, then run `Passkey` as a command". Read keys with _env_get.
#
# 2. Restore selectively. `restore-identity.sh --apply` copies the whole /etc,
#    which on a fresh box dumps a hundred foreign OS units (snapd, cloud-init,
#    grub) over systemd and replaces /etc/netplan with interface names from
#    different hardware — the classic way to rebuild a server and then lose its
#    network. Only the paths this app owns get copied, and netplan waits for a
#    human with FORCE_NET=1.
# ==============================================================================
set -uo pipefail

APP="${TUKUK_INSTALL_DIR:-/opt/tukuk-os}"
ENV="$APP/.env"
KEYFILE="${IDENTITY_KEY_FILE:-/root/tukuk-backup-key}"
FAILS=0
log() { printf '\033[1;34m➜\033[0m %s\n' "$*"; }
good() { printf '  \033[0;32mPASS\033[0m %-30s %s\n' "$1" "${2:-}"; }
bad()  { printf '  \033[0;31mFAIL\033[0m %-30s %s\n' "$1" "${2:-}"; FAILS=$((FAILS+1)); }
note() { printf '  \033[1;33mNEXT\033[0m %-28s %s\n' "$1" "${2:-}"; }

_env_get() { [[ -r "$ENV" ]] && grep -E "^[[:space:]]*$1=" "$ENV" | tail -1 | cut -d= -f2- \
             | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' || true; }

# ── 0. preflight: refuse loudly rather than half-install ──────────────────────
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)." >&2; exit 1; }
[[ -f "$APP/package.json" ]] || { echo "code is not at $APP yet — clone or USB first (this repo is private)." >&2; exit 1; }
[[ -r "$KEYFILE" ]] || { echo "cannot read $KEYFILE — the archive is useless without the key. It rides on the handover stick as key/tukuk-backup-key (install -m 600 it to /root/tukuk-backup-key), or copy it from the laptop's ~/.config/tukuk/backup-key." >&2; exit 1; }
for t in curl git openssl tar node; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }; done

# Bootstrap .env exactly the way setup-all.sh does. The gate below READS .env, and a fresh clone
# has none (it is gitignored), so on a truly empty box -- the only box this script is written for --
# the one-command rebuild died at its own first check. Order matters more than cleverness here.
if [[ ! -f "$ENV" && -f "$APP/deploy/env.defaults" ]]; then
  cp "$APP/deploy/env.defaults" "$ENV" && chmod 600 "$ENV"
  echo "  .env bootstrapped from deploy/env.defaults (same rule setup-all.sh uses)"
fi

WURL="$(_env_get BACKUP_WORKER_URL)"; WSEC="$(_env_get BACKUP_UPLOAD_SECRET)"
[[ -n "$WURL" && -n "$WSEC" ]] || { echo "BACKUP_WORKER_URL / BACKUP_UPLOAD_SECRET empty in $ENV — deploy/env.defaults should carry them." >&2; exit 1; }

# ── 1. the ordinary bring-up (tuning, Node, Meilisearch, units, tunnel) ───────
log "[1/5] scripts/setup-all.sh (idempotent core install)"
bash "$APP/scripts/setup-all.sh" --from-server || echo "  setup-all exited non-zero; continuing to the verify table so nothing is hidden."

# ── 2. newest off-site archives, named by the bucket rather than guessed ─────
# The worker's GET with ?prefix= is a real listing, so the newest slot is a fact.
# (Probing guessed key names through a CLI proved unreliable: a key can exist and
# still report "does not exist", which reads like a lost backup.)
newest() { # newest() <prefix> -> key
  curl -fsS --max-time 60 -H "Authorization: Bearer $WSEC" "$WURL/?prefix=$1" 2>/dev/null \
  | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{ const o=JSON.parse(s).objects.map(x=>({k:x.key,t:Date.parse(x.uploaded||0),b:x.bytes}));
           o.sort((a,c)=>c.t-a.t); if(o[0]) console.log(o[0].k); }catch(e){}});'
}
log "[2/5] locating the newest off-site archives"
IDKEY="$(newest backups/tukuk-identity)"; DATAKEY="$(newest backups/tukuk-data)"
[[ -n "$IDKEY" ]] || { echo "no identity archive listed under backups/tukuk-identity — the R2 gateway may be down or the bucket renamed." >&2; exit 1; }
echo "  identity: $IDKEY   data: ${DATAKEY:-<none found>}"

TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
fetch() { curl -fsS --retry 3 --max-time 600 -H "Authorization: Bearer $WSEC" "$WURL/?key=$1" -o "$2" \
          || { echo "download failed for $1" >&2; return 1; }; }
fetch "$IDKEY" "$TMP/id.enc" || exit 1
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TMP/id.enc" -out "$TMP/id.tar.gz" -pass "file:$KEYFILE" \
  || { echo "decrypt failed — wrong key?" >&2; exit 1; }
gzip -t "$TMP/id.tar.gz" || { echo "identity archive is corrupt" >&2; exit 1; }
tar xzf "$TMP/id.tar.gz" -C "$TMP" || { echo "unpack failed" >&2; exit 1; }
echo "  identity unpacked: $(find "$TMP/etc" "$TMP/opt" "$TMP/home" -type f 2>/dev/null | wc -l) files"

# ── 3. selective restore: only what this project owns ────────────────────────
log "[3/5] restoring the paths git does not carry"
stage() { [[ -d "$TMP/$1" ]] && { mkdir -p "/$1"; cp -a "$TMP/$1/." "/$1/"; echo "  ✓ $1"; }; }
mkdir -p /etc/systemd/system
# unit files, ours only — never the OS ones that happened to sit in the same dir.
for u in "$TMP"/etc/systemd/system/tukuk-* "$TMP"/etc/systemd/system/cloudflared* \
         "$TMP"/etc/systemd/system/meili* "$TMP"/etc/systemd/system/chat-backup* \
         "$TMP"/etc/systemd/system/indexnow-* "$TMP"/etc/systemd/system/load-governor* \
         "$TMP"/etc/systemd/system/weight-report* "$TMP"/etc/systemd/system/builder-idle* \
         "$TMP"/etc/systemd/system/litert-lm.service; do
  [[ -f "$u" ]] && cp -a "$u" /etc/systemd/system/ && echo "  ✓ unit $(basename "$u")"
done
for d in "$TMP"/etc/systemd/system/*.d; do
  [[ -d "$d" ]] && { mkdir -p "/etc/systemd/system/$(basename "$d")"; cp -a "$d/." "/etc/systemd/system/$(basename "$d")/"; echo "  ✓ drop-in $(basename "$d")"; }
done
stage etc/nginx/conf.d
stage etc/cloudflared
stage etc/ssh                      # host keys: same identity, no client warnings
stage etc/hosts
stage home/tukuk/.cloudflared && chmod 600 /home/tukuk/.cloudflared/* 2>/dev/null
stage home/tukuk/.ssh && chmod 600 /home/tukuk/.ssh/authorized_keys 2>/dev/null
if [[ -f "$TMP/opt/tukuk-os/.env" ]]; then
  cp -a "$TMP/opt/tukuk-os/.env" "$ENV" && chmod 600 "$ENV" && echo "  ✓ .env (real keys, not the bundled defaults)"
  # Self-heal for the future: the working tunnel token lives in config.yml on the
  # restored box; mirror it into .env so a later box needs no archive at all.
  CFGTOK=$(grep -oE '^token: eyJ[^ ]*' /etc/cloudflared/config.yml 2>/dev/null | head -1 | cut -d' ' -f2)
  CFGID=$(grep -oE '^tunnel: [0-9a-f-]{36}' /etc/cloudflared/config.yml 2>/dev/null | head -1 | cut -d' ' -f2)
  if [[ -n "$CFGTOK" && -z "$(_env_get CF_TUNNEL_TOKEN)" ]]; then
    # The variable is CFID (the tunnel UUID read out of config.yml). It was written CFGRID here,
    # and `set -u` makes an unbound reference fatal -- which killed the rebuild halfway through
    # the restore, right after the .env landed. Names in a script that no longer stops at a
    # syntax check are exactly what a linter is for.
    grep -q '^CF_TUNNEL_ID=' "$ENV" && sed -i "s|^CF_TUNNEL_ID=.*|CF_TUNNEL_ID=$CFID|" "$ENV" || echo "CF_TUNNEL_ID=$CFID" >> "$ENV"
    echo "CF_TUNNEL_TOKEN=$CFGTOK" >> "$ENV"; chmod 600 "$ENV"
    echo "  ✓ CF_TUNNEL_TOKEN/ID captured from /etc/cloudflared/config.yml (stays out of git: .env is ignored)"
  fi
  # The restored .env is now the authority, but setup-all ran BEFORE it and wrote this server's
  # Meilisearch unit with the key it had at that moment — on an empty box that is a freshly
  # generated one. A unit key that disagrees with .env means Meilisearch answers 401 to every
  # search, which reads like a broken app rather than a key that arrived one step too late.
  MK="$(_env_get MEILI_MASTER_KEY)"
  MSVC=/etc/systemd/system/meilisearch.service
  if [[ -f "$MSVC" && -n "$MK" ]]; then
    UK=$(sed -n 's/.*--master-key \([^ ]*\).*/\1/p' "$MSVC" | head -1)
    if [[ "$UK" != "$MK" ]]; then
      if [[ "$MK" =~ ^[A-Za-z0-9_-]+$ ]]; then
        sed -i "s#--master-key [^ ]*#--master-key $MK#" "$MSVC"
        systemctl daemon-reload && systemctl restart meilisearch >/dev/null 2>&1
        echo "  ✓ meilisearch unit re-keyed to match the restored .env"
      else
        note "meilisearch key" "restored MEILI_MASTER_KEY has characters sed cannot take blindly — edit $MSVC by hand and restart meilisearch"
      fi
    fi
  fi
fi
if [[ -f "$TMP/etc/netplan/00-installer-config.yaml" ]]; then
  mkdir -p "$APP/etc-netplan-reference"; cp -a "$TMP/etc/netplan/." "$APP/etc-netplan-reference/"
  if [[ "${FORCE_NET:-0}" == "1" ]]; then cp -a "$TMP/etc/netplan/." /etc/netplan/ && echo "  ✓ netplan applied because FORCE_NET=1"
  else echo "  netplan NOT copied (different hardware = different interface names). Reference kept in $APP/etc-netplan-reference/; apply with sudo netplan try, never apply blind."; fi
fi

# data/ holds the runtime stores (passkeys in data/tukuk-os.json, chat, counters).
# Refusing to overwrite a live data dir is the point: a rebuild must not eat today's writes.
if [[ -n "$DATAKEY" ]]; then
  if [[ -f "$APP/data/tukuk-os.json" && "${FORCE_DATA:-0}" != "1" ]]; then
    echo "  data/ already present — not overwritten (FORCE_DATA=1 to restore anyway). $DATAKEY left off-site."
  else
    fetch "$DATAKEY" "$TMP/data.tar.gz" && gzip -t "$TMP/data.tar.gz" \
      && tar xzf "$TMP/data.tar.gz" -C "$APP" && echo "  ✓ data/ restored from $DATAKEY ($(tar tzf "$TMP/data.tar.gz" | wc -l) entries)"
  fi
fi

# ── 4. the front proxy: nginx on 3000, Node on 3001 (drop-in), tunnel to nginx ─
log "[4/5] nginx front + services"
command -v nginx >/dev/null || { apt-get install -y -qq nginx >/dev/null && echo "  ✓ nginx installed"; }
# The archive has already restored both halves of the front: /etc/nginx/conf.d (listen
# 127.0.0.1:3000) and tukuk-os.service.d/60-front-port.conf (Node → 3001). So this line
# measures the result instead of calling `cut` again — the installer refuses to cut a
# second time, and that refusal would read like a failure of the rebuild.
if ss -ltn 2>/dev/null | grep -q ':3000 ' && ss -ltn 2>/dev/null | grep -q ':3001 '; then
  echo "  ✓ front proxy in place: nginx :3000, Node :3001"
else
  echo "  front proxy NOT in place. Redo the staged way:"
  echo "    sudo bash deploy/nginx/install-tukuk-front.sh verify"
  echo "    sudo node scripts/nginx-front-check.js 8080 && sudo bash deploy/nginx/install-tukuk-front.sh cut"
fi
systemctl daemon-reload
for s in meilisearch tukuk-os cloudflared nginx cockpit.socket; do systemctl enable --now "$s" >/dev/null 2>&1 || true; done
systemctl restart cloudflared cloudflared-build >/dev/null 2>&1 || true
for t in tukuk-data-backup tukuk-identity-backup tukuk-content-backup meili-backup chat-backup tukuk-snapshot tukuk-os-watchdog tukuk-update indexnow-submit load-governor weight-report builder-idle-stop; do
  systemctl enable --now "$t.timer" >/dev/null 2>&1 || true
done

# ── 5. verify what a visitor can see, not what the script intended ───────────
log "[5/5] verification"
chk() { # chk <name> <expected> <actual>
  [[ "$3" == "$2" ]] && good "$1" "$3" || bad "$1" "expected $2, got $3"; }
code() { curl -4 -k -sS -o /dev/null -w '%{http_code}' --max-time 25 "$1" 2>/dev/null || echo 000; }
# -k on the cockpit line below: Cockpit serves a self-signed cert, and a rejected
# handshake would read as "Cockpit is down" when it is actually up.
chk "app healthy (3000 front)" 200 "$(code http://127.0.0.1:3000/health)"
chk "meilisearch up"           200 "$(code http://127.0.0.1:7700/health)"
chk "tukuk.org through edge"    200 "$(code https://tukuk.org/)"
chk "search answers"            200 "$(code 'https://tukuk.org/cari?q=weather')"
chk "play.tukuk.org"            200 "$(code https://play.tukuk.org/)"
# play/tchat/build ride the SECOND tunnel (a3af5bb4, credentials-file mode); a 530
# here means that connector is not up, not that the Godot build is missing.
[[ "$(systemctl is-active cloudflared-build 2>/dev/null)" == active ]] \
  && good "second tunnel (cloudflared-build)" active \
  || bad "second tunnel (cloudflared-build)" "$(systemctl is-active cloudflared-build 2>/dev/null) — play/tchat/build will 530"
chk "cockpit on 9090"            200 "$(code https://127.0.0.1:9090/login)"
for s in meilisearch tukuk-os cloudflared nginx; do
  [[ "$(systemctl is-active "$s" 2>/dev/null)" == active ]] && good "service $s" active || bad "service $s" "$(systemctl is-active "$s" 2>/dev/null)"
done
[[ "$(ss -ltn 2>/dev/null | grep -c ':3001')" == 1 ]] && good "Node behind front (3001)" 3001 || bad "Node behind front (3001)" "$(ss -ltn | awk '/:3001/:3000/{print $4}' | tr '\n' ' ')"
if [[ -f "$APP/data/tukuk-os.json" ]]; then
  PK=$(node -e 'try{const d=require("'"$APP"'/data/tukuk-os.json");const s=JSON.stringify(d);console.log((s.match(/credentialId/g)||[]).length+" credential(s)")}catch(e){console.log("unreadable")}' 2>/dev/null || echo unreadable)
  [[ "$PK" != "unreadable" && "$PK" != "0 credential(s)" ]] && good "passkey store" "$PK" || bad "passkey store" "$PK — users would have to re-register"
else
  bad "passkey store" "no data/tukuk-os.json"
fi
TIMERS=$(systemctl list-timers --all --no-pager 2>/dev/null | grep -c 'tukuk-\|meili-\|chat-\|indexnow\|load-governor\|weight-report\|builder-idle')
[[ "$TIMERS" -ge 8 ]] && good "backup/maintenance timers" "$TIMERS scheduled" || bad "backup/maintenance timers" "$TIMERS scheduled"
# A bundle clone records origin as the path of the stick it came from, and a USB install has no
# .git at all (install-from-usb.sh excludes it). Either way the daily tukuk-update timer then
# fetches a device that is no longer in the machine: the box looks healthy and never receives
# another commit. Reported as NEXT, not FAIL — repointing a remote needs a GitHub key, which is a
# human decision, and the site is correct and serving either way.
ORIGIN=$(git -C "$APP" remote get-url origin 2>/dev/null || echo none)
case "$ORIGIN" in
  *.bundle|/media/*|/run/media/*|file:*)
    note "git remote" "origin is the handover bundle — once this box has a key: sudo git -C $APP remote set-url origin git@github.com:fevian448/tukuk-os-v2.git" ;;
  none)
    note "git remote" "no origin at all (USB install excludes .git) — re-clone from a bundle to get the daily auto-update back" ;;
  *) good "git remote" "$ORIGIN" ;;
esac
MP=$(grep -o 'index.pck.zip?v=pck[0-9a-f]*' /var/www/tukuk-play/index.html 2>/dev/null | head -1)
[[ -n "$MP" ]] && good "pack is edge-cacheable" "$MP" || note "Godot HD build" "no mainPack alias in /var/www/tukuk-play — rebuild: sudo INSTALL_GAME=1 TUKUK_GAME_BUNDLE=<usb>/code/station-break-game.bundle bash scripts/setup-all.sh (builder + boot overlay now live in deploy/godot/)"
[[ -f "$APP/apk/tukuk-chat-release.jks" ]] && good "APK signing key" present || note "APK signing key" "apk/*.jks is gitignored — copy it from the laptop, then verify md5 matches the released APKs"
# A missing provider key is not a failure — the app degrades to extractive answers —
# but it must be visible, because "chat stopped working after the rebuild" is
# otherwise indistinguishable from a code bug.
LLMS=""; for k in GROQ_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY CLOUDFLARE_AI_API_KEY HUGGINGFACE_API_KEY; do
  [[ -n "$(_env_get $k)" ]] && LLMS="$LLMS ${k%_API_KEY}"
done
[[ -n "$LLMS" ]] && good "AI providers" "$LLMS" || note "AI providers" "no LLM key in .env — chat/rerank run extractive-only until one is added"

echo
if (( FAILS )); then
  echo -e "\033[0;31m  $FAILS check(s) failed — the box is NOT done. Fix above, rerun this script (it is idempotent).\033[0m"
  exit 1
fi
echo -e "\033[0;32m  All checks passed. Box rebuilt from off-site archives; nothing left to type.\033[0m"
