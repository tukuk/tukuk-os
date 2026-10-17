#!/usr/bin/env bash
# ==============================================================================
# setup-litert-pilot.sh — Aktifkan PILOT tier AI pinggir LiteRT-LM di pelayan.
#
#   sudo bash scripts/setup-litert-pilot.sh            # pasang + bench
#   sudo bash scripts/setup-litert-pilot.sh --force    # walau build berjalan
#
# PRASYARAT (dibuat penulis melalui SSH, automatik):
#   • uv + litert-lm v0.18 terpasang (/home/tukuk/.local/bin)
#   • model diimport: gemma3-1b-it-int4 + embeddinggemma-300m
#     (registry: /home/tukuk/.litert-lm/models)
#   • JANGAN jalan semasa build Tukuk Agent berjalan (perebutan CPU/RAM).
#
# Skrip ini TIDAK menyentuh src/answer.js — integrasi ke rotasi cloud hanya
# selepas pilot lulus benchmark dan dengan persetujuan penulis.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

LITERT_BIN=/home/tukuk/.local/bin/litert-lm
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:1.7b}"

[ "$(id -u)" = 0 ] || { echo "perlukan root: sudo bash $0"; exit 1; }

if pgrep -f build-agent-on-server >/dev/null 2>&1 && [ "${1:-}" != "--force" ]; then
  echo "✗ build Tukuk Agent masih berjalan — tunggu tamat (atau --force)."
  exit 1
fi

echo "── [1] pasang unit systemd litert-lm ──"
[ -x "$LITERT_BIN" ] || { echo "✗ litert-lm tiada di $LITERT_BIN — ulang langkah pemasangan CLI."; exit 1; }
install -m 0644 deploy/litert-lm.service /etc/systemd/system/litert-lm.service
systemctl daemon-reload
systemctl enable litert-lm >/dev/null 2>&1
systemctl restart litert-lm
sleep 4
systemctl is-active --quiet litert-lm \
  && echo "✓ litert-lm AKTIF pada 127.0.0.1:8090" \
  || { echo "✗ gagal — journalctl -u litert-lm -n 20:"; journalctl -u litert-lm -n 20 --no-pager; exit 1; }

echo "── [2] sediakan pembanding Ollama ($OLLAMA_MODEL) ──"
if sudo -u tukuk env HOME=/home/tukuk ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
  echo "✓ $OLLAMA_MODEL sudah ada."
else
  echo "… pull $OLLAMA_MODEL (prioriti rendah; ~1.4GB):"
  sudo -u tukuk env HOME=/home/tukuk nice -n15 ollama pull "$OLLAMA_MODEL" \
    || echo "⚠ ollama pull gagal — bench Ollama akan dilangkau."
fi

echo "── [3] benchmark apple-to-apple (tok/s + RSS) ──"
sudo -u tukuk env HOME=/home/tukuk node scripts/bench-edge-tier.js --ollama-model "$OLLAMA_MODEL"

cat <<'EOF'
═══════════════════════════════════════════════════════════════════════
Bacaan keputusan:
  • menangi LiteRT → saya daftar http://127.0.0.1:8090/v1 sebagai provider
    OpenAI-compatible dalam rotasi src/answer.js (satu batch berasingan,
    dengan ujian + lint hijau sebelum commit).
  • menang Ollama → pilot litert dilumpuhkan (systemctl disable --now
    litert-lm), model kekal di cakera untuk rujukan.
  • seri → pertimbangkan LFM2-8B-A1B (GGUF 4.8GB — perlu ukur RAM dulu).
EOF
