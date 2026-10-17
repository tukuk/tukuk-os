#!/usr/bin/env bash
# ==============================================================================
# publish-agent.sh — HANTARKAN release Tukuk Agent yang dibina di LAPTOP ke
# pelayan, lalu pasang & mulakan servisnya di sana (tiada build berat di VPS).
#
#   bash scripts/build-tukuk-agent.sh            # sekali, di laptop
#   bash scripts/publish-agent.sh tukuk@192.168.8.100
#
# Aliran:
#   1. rsync code-server/release/ → $DEST:/tmp/tukuk-agent-release/  (sebagai user biasa)
#   2. ssh + sudo: letak di /opt/tukuk-agent/release, buat user rendah-hak,
#      pasang unit systemd dari /opt/tukuk-os/deploy (auto-update perlu sudah
#      menarik komit terkini), enable + restart, sahkan aktif.
#
# Nota: sudo berjalan INTERAKTIF di hujung — anda taip kata laluan pelayan.
# Setelah servis hidup, satu langkah terakhir tiada di sini: dalam MOD TOKEN
# cloudflared, hostname agent.tukuk.org → http://127.0.0.1:8443 MESTI ditambah
# di dashboard Cloudflare (Zero Trust → Networks → Routes), sebab ingress
# tempatan diabaikan. Lepas itu https://agent.tukuk.org terbuka.
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "guna: bash scripts/publish-agent.sh <user@host>   (cth. tukuk@192.168.8.100)"
  exit 1
fi

REL="code-server/release"
if [ ! -x "$REL/bin/tukuk-agent" ]; then
  echo "✗ $REL/bin/tukuk-agent tiada — bina dulu:"
  echo "    bash scripts/build-tukuk-agent.sh"
  exit 1
fi
SIZE=$(du -sh "$REL" | cut -f1)
echo "── 1/3 rsync release ($SIZE) ke $DEST ──"
ssh "$DEST" 'rm -rf /tmp/tukuk-agent-release && mkdir -p /tmp/tukuk-agent-release'
rsync -az --delete "$REL/" "$DEST:/tmp/tukuk-agent-release/"

echo "── 2/3 pasang di pelayan (anda mungkin diminta kata laluan sudo) ──"
ssh -t "$DEST" 'sudo bash -se' <<'REMOTE'
set -eu
OS=/opt/tukuk-os
[ -f "$OS/deploy/tukuk-agent.service" ] || { echo "✗ $OS/deploy/tukuk-agent.service tiada — jalankan auto-update.sh dulu."; exit 1; }
mkdir -p /opt/tukuk-agent
rsync -a --delete /tmp/tukuk-agent-release/ /opt/tukuk-agent/release/
rm -rf /tmp/tukuk-agent-release
getent passwd tukuk-agent >/dev/null 2>&1 || useradd --system --home-dir /var/lib/tukuk-agent --shell /usr/sbin/nologin tukuk-agent
install -d -m 0750 -o tukuk-agent -g tukuk-agent /var/lib/tukuk-agent/extensions /var/lib/tukuk-agent/user-data /var/lib/tukuk-agent/projects
chown -R tukuk-agent:tukuk-agent /opt/tukuk-agent
cp "$OS/deploy/tukuk-agent.service" /etc/systemd/system/tukuk-agent.service
systemctl daemon-reload
systemctl enable tukuk-agent >/dev/null
systemctl restart tukuk-agent
sleep 2
systemctl is-active tukuk-agent
REMOTE

echo "── 3/3 siap ──"
echo "✓ release di /opt/tukuk-agent/release, servis tukuk-agent dihantar."
echo "  PILIHAN & JIKA PERLU:"
echo "   • Kata laluan editor: dikendalikan code-server sendiri (--auth password),"
echo "     pada /var/lib/tukuk-agent/user-data — atau tukar ExecStart ke --auth none"
echo "     jika autentikasi dicuekkan di tepi tunnel."
echo "   • agent.tukuk.org → http://127.0.0.1:8443 MESTI ada sebagai route dalam"
echo "     dashboard Cloudflare (mod token mengabaikan ingress tempatan)."
echo "   • AGENT_TOKEN (dan AGENT_ORIGIN=https://agent.tukuk.org) dalam env Tukuk-OS"
echo "     di pelayan = API Key yang sama ditaip dalam Cline (Base URL"
echo "     https://tukuk.org/api/agent/v1, model tukuk-agent)."
echo "   • Pelanjutan Cline (vsix) boleh dipasang kemudian:"
echo "       sudo -u tukuk-agent /opt/tukuk-agent/release/bin/tukuk-agent \\"
echo "         --extensions-dir /var/lib/tukuk-agent/extensions --install-extension cline.vsix"
