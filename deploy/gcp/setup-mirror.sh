#!/usr/bin/env bash
# ==============================================================================
# setup-mirror.sh — bootstrap the GCP failover mirror VM (run ON the VM, as root).
#
# This turns a bare always-free e2-micro into the www.tukuk.org backup origin:
#   * nginx serving the static snapshot on 127.0.0.1:8080 (loopback only — the
#     tunnel connects to it locally; nothing is exposed to the internet),
#   * the /srv/tukuk-mirror/releases + /var/www/tukuk-mirror symlink layout that
#     scripts/mirror-pull.sh flips atomically,
#   * the cloudflared binary and (optionally) the tunnel config,
#   * a systemd timer that re-pulls every 6h, just after the box writes R2.
#
# IT IS NOT SELF-CONTAINED BY DESIGN — the source of truth for mirror-pull.sh,
# gcp-config.yml and the two systemd units stays in the repo, so a change there is
# a change on the VM after the next deploy, not a drift-prone copy. Copy these four
# files next to this script before running it:
#   deploy/cloudflared/gcp-config.yml
#   scripts/mirror-pull.sh
#   deploy/gcp/tukuk-mirror-pull.service
#   deploy/gcp/tukuk-mirror-pull.timer
# (see deploy/GCP-FAILOVER.md for the one scp command that grabs all of them).
#
# The interactive Cloudflare steps (tunnel login/create, DNS route, secrets) are
# done by hand in the runbook — this script only lays down what runs on the box.
#
# USE (as root):
#   TUNNEL_ID=<uuid> bash setup-mirror.sh
#   # and drop the tunnel credentials at /etc/cloudflared/<TUNNEL_ID>.json first
#   # (from `cloudflared tunnel create`, see runbook). Without TUNNEL_ID it still
#   # installs everything but leaves cloudflared disabled for you to finish.
# ==============================================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
LINK=/var/www/tukuk-mirror
BASE=/srv/tukuk-mirror
ENVF=/etc/tukuk-mirror.env
# Normalise the operator-supplied tunnel id once, so every later "$TUNNEL_ID" read is
# safe under `set -u` (the static variable scanner, and an emergency 3am run without it).
TUNNEL_ID="${TUNNEL_ID:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[setup] ERROR: need '$1'." >&2; exit 1; }; }
have_file() { [[ -f "$1" ]] || { echo "[setup] ERROR: missing $1 — copy the deploy/gcp + scripts files here first (see runbook)." >&2; exit 1; }; }

echo "[setup] checking prerequisites ..."
[[ $EUID -eq 0 ]] || { echo "[setup] ERROR: run as root (sudo)." >&2; exit 1; }
need apt-get
have_file "$SRC_DIR/gcp-config.yml"
have_file "$SRC_DIR/mirror-pull.sh"
have_file "$SRC_DIR/tukuk-mirror-pull.service"
have_file "$SRC_DIR/tukuk-mirror-pull.timer"

echo "[setup] installing nginx + curl + ca-certificates ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx curl ca-certificates

# ---- cloudflared (amd64 .deb from Cloudflare's own release bucket) ----
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[setup] downloading cloudflared ..."
  CF_VER=2025.4.2   # pin; bump deliberately, never chase :latest on a backup box
  TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
  curl -fsSL --max-time 120 \
    "https://github.com/cloudflare/cloudflared/releases/download/${CF_VER}/cloudflared-linux-amd64.deb" \
    -o "$TMPD/cloudflared.deb"
  dpkg -i "$TMPD/cloudflared.deb"
fi
cloudflared --version

# ---- mirror storage layout + a placeholder so the tunnel can be verified pre-pull ----
echo "[setup] laying down $BASE/releases and the $LINK symlink ..."
mkdir -p "$BASE/releases"
# Never delete a live release dir; if a real $LINK already exists leave its target alone.
if [[ ! -L "$LINK" ]]; then
  SEED="$BASE/releases/00000000T000000Z"
  mkdir -p "$SEED"
  if [[ ! -s "$SEED/index.html" ]]; then
    cat > "$SEED/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>tukuk.org backup</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto">
<h1>tukuk.org — backup mirror</h1>
<p>This is the standalone mirror. It has not been populated from the live snapshot
yet — the first refresh runs on its timer. If the main site is unreachable, refresh
this page in a moment; the pull copies every public page.</p>
</body>
HTML
  fi
  ln -sfn "$SEED" "$LINK"
fi
chmod -R a+rX "$BASE"

# ---- nginx: loopback :8080, static, marker header ----
echo "[setup] writing the mirror nginx server block ..."
cat > /etc/nginx/conf.d/tukuk-mirror.conf <<'NGX'
# The GCP failover mirror. The tunnel talks to this on loopback only; the VM has
# no public web port. `x-mirror: gcp` is the marker Phase 5 checks to prove a page
# really came from GCP and not the home box.
server {
    listen 127.0.0.1:8080;
    server_name www.tukuk.org;

    root /var/www/tukuk-mirror;
    index index.html;

    add_header x-mirror "gcp" always;

    # The snapshot is static HTML + hashed-ish assets; a short lease is plenty and
    # lets a re-pull become visible quickly. search-index.json is fine to cache too.
    location ~* \.(html)$ {
        add_header x-mirror "gcp" always;
        add_header Cache-Control "public, max-age=60";
        try_files $uri $uri/ =404;
    }
    location / {
        add_header x-mirror "gcp" always;
        try_files $uri $uri/ $uri/index.html =404;
    }
}
NGX
# Drop the default site so it cannot shadow the mirror on any host header.
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ---- puller script + env (token filled in by the operator) ----
echo "[setup] installing /usr/local/bin/mirror-pull.sh ..."
install -m 0755 "$SRC_DIR/mirror-pull.sh" /usr/local/bin/mirror-pull.sh
if [[ ! -f "$ENVF" ]]; then
  # 0600: the read token is a secret. Created here so the timer has the file; the
  # operator must still paste the real value (the runbook says exactly this line).
  umask 077
  printf 'MIRROR_READ_TOKEN=\nMIRROR_BASE=https://worker.tukuk.org/edge-backup\n' > "$ENVF"
  echo "[setup] WROTE $ENVF with an EMPTY token — set MIRROR_READ_TOKEN before the first pull."
fi

# ---- systemd timer ----
echo "[setup] installing the 6h refresh timer ..."
install -m 0644 "$SRC_DIR/tukuk-mirror-pull.service" /etc/systemd/system/tukuk-mirror-pull.service
install -m 0644 "$SRC_DIR/tukuk-mirror-pull.timer"   /etc/systemd/system/tukuk-mirror-pull.timer
systemctl daemon-reload
systemctl enable --now tukuk-mirror-pull.timer

# ---- tunnel config (only when TUNNEL_ID is known and creds exist) ----
if [[ -n "${TUNNEL_ID:-}" ]]; then
  mkdir -p /etc/cloudflared
  sed "s/<TUNNEL_ID>/$TUNNEL_ID/g" "$SRC_DIR/gcp-config.yml" > /etc/cloudflared/config.yml
  if [[ -f "/etc/cloudflared/$TUNNEL_ID.json" ]]; then
    cloudflared service install 2>/dev/null || true
    systemctl enable --now cloudflared || true
    echo "[setup] cloudflared installed for tunnel $TUNNEL_ID."
  else
    echo "[setup] config written for $TUNNEL_ID, but /etc/cloudflared/$TUNNEL_ID.json is missing."
    echo "[setup] finish with: cloudflared tunnel create + place the .json, then 'cloudflared service install'."
  fi
else
  echo "[setup] TUNNEL_ID not set — cloudflared left unconfigured. Do the tunnel in the runbook, then re-run with TUNNEL_ID."
fi

echo "[setup] done. Mirror serves on 127.0.0.1:8080; refresh runs on the timer."
systemctl list-timers 'tukuk-mirror-pull*' --no-pager || true
