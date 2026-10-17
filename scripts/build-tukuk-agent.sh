#!/usr/bin/env bash
# ==============================================================================
# build-tukuk-agent.sh — Bina release Tukuk Agent (editor VS Code + agen AI) di
# LAPTOP, kemudian sematkan pelanjutan Cline + konfigurasi Tukuk-OS MCP.
#
#   bash scripts/build-tukuk-agent.sh [path/ke/cline.vsix]
#
# Mengapa di laptop, bukan VPS: bina VS Code perlu Node 24 + submodule lib/vscode
# (~1GB) + toolchain berat. VPS HANYA berjalan release siap (di-rsync), selaras
# polisi "tiada Docker / server ringan" (lihat deploy/tukuk-agent.service).
#
# Perlu (sekali sahaja, di laptop):
#   • Node 24 (nvm install 24). code-server engines: node "24".
#   • Pustaka sistem untuk node-gyp: sudo apt install libkrb5-dev
#     build-essential python3 pkg-config libxkbfile-dev libsecret-1-dev
#     (kegagalan 'gssapi/gssapi.h' pada kerberos = libkrb5-dev belum ada).
#   • Alternatif: build TERUS di pelayan → scripts/build-agent-on-server.sh.
#   • git submodule update --init code-server/lib/vscode   (fail besar).
#   • fail .vsix Cline. Muat dari Open VSX (pinned versi) ke
#     code-server/vendor/extensions/cline.vsix — ATAU hantar path sebagai $1.
#     Roo Code / Kilo Code ialah ganti terus (konfig sama).
#
# Output: code-server/release/  (bin/tukuk-agent + node bawaan + ekst+config).
# Ia yang di-rsync ke /opt/tukuk-agent/release pada VPS.
#
# PENTING: pelanjutan dipasang ke --extensions-dir SEPARATE (vendor/extensions
# → release/extensions) supaya mula bersih & boleh diulang. Fail konfigurasi dari
# tukuk-agent.defaults/ disalin sebagai templat; AGENT_TOKEN/base URL perlu
# diselaraskan dengan .env sebenar sebelum deploy.
# ==============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

CS="code-server"
RELEASE="$CS/release"
DEFAULTS="tukuk-agent.defaults"
CS_BIN="$RELEASE/bin/tukuk-agent"

# ── 0.Prakualifikasi persekitaran (gagal awal, bukan selepas 20 minit build) ──
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" != "24" ]; then
  echo "⚠ Tukuk Agent build perlu Node 24 (engines), kini v$NODE_MAJOR."
  echo "  Guna:  nvm install 24 && nvm use 24   (jangan terus di VPS)"
  [ -t 1 ] && { echo "  (melanjut atas risiko sendiri — tekan Ctrl-C)"; sleep 5; }
fi

if [ ! -d "$CS/lib/vscode/Extensions" ] && [ -z "$(ls -A "$CS/lib/vscode" 2>/dev/null)" ]; then
  echo "✗ lib/vscode submodule KOSONG. Jalankan:"
  echo "    git -C $CS submodule update --init lib/vscode"
  exit 1
fi

# ── 1. Bina tukuk-agent + release standalone (KEEP_MODULES=1 → bin + node) ──
# foundry-local-sdk memuat turun OnnxRuntime ±139MB dari NuGet untuk inferens
# AI LOKAL VS Code — kita tak pakai (AI via cloud /api/agent) dan muat turun
# itu kerap timeout pada link perlahan. Skip rasmi (skripnya sendiri sokong).
export FOUNDRY_LOCAL_SKIP_INSTALL=1

echo "── npm ci (dalam $CS) ──"
( cd "$CS" && npm ci ) || { echo "✗ npm ci gagal"; exit 1; }

echo "── npm run build ──"
( cd "$CS" && npm run build ) || { echo "✗ build code-server gagal"; exit 1; }

# build-code-server.sh HANYA compile wrapper (tsc). Yang menjana
# lib/vscode-reh-web-linux-x64 (server web VS Code yang dicari release) ialah
# build-vscode.sh — fasa gulp paling panjang (±1–2 jam) dan perlukan VERSION.
#
# Tambalan longgar-Copilot: pepohon vscode pin menjalankan
# prepareBuiltInCopilotRipgrepShim TANPA syarat semasa pembungkusan REH, tetapi
# Microsoft rasmi mendapat copilot daripada VSIX prabina manakala build
# dari-sumber menanggalkan @github/copilot/** ikut .moduleignore — jadi build
# dari-sumber MATI sentiasa dengan "Copilot SDK directory not found". Tukuk
# Agent tiada Copilot (agen = Cline melalui /api/agent); tugas itu dilonggarkan
# kepada amaran sahaja. Idempoten — guarded oleh penanda TIADA-COPILOT-SDK.
CS_COPILOT_TS="$CS/lib/vscode/build/lib/copilot.ts" node - <<'NODE' || { echo "✗ tambalan copilot gagal"; exit 1; }
const fs = require('node:fs');
const f = process.env.CS_COPILOT_TS;
let s = fs.readFileSync(f, 'utf8');
if (s.includes('TIADA-COPILOT-SDK')) { console.log('\u2713 copilot.ts sudah ditambal'); process.exit(0); }
const old = 'throw new Error(`[prepareBuiltInCopilotRipgrepShim] Copilot SDK directory not found at ${copilotSdkBase}`);';
if (!s.includes(old)) { console.error('\u2717 corak throw copilot tidak ditemui dalam ' + f + ' — semak pin vscode manual.'); process.exit(1); }
s = s.replace(old, '/* TIADA-COPILOT-SDK: longgar utk build tanpa VSIX */ console.warn("[copilot-shim] SDK tiada — skip"); return;');
fs.writeFileSync(f, s);
console.log('\u2713 copilot.ts ditambal — shim REH jadi longgar (amar, bukan batal).');
NODE

echo "── npm run build:vscode (gulp REH web — fasa panjang) ──"
( cd "$CS" && VERSION="$(node -p "require('./package.json').version")" MINIFY=true npm run build:vscode ) \
  || { echo "✗ build:vscode gagal"; exit 1; }

# Copilot dibuang terus daripada output REH: node_modules-nya sudah ditanggalkan
# .moduleignore (dist tanpa sdk akan ralat aktifasi ketika editor mula), dan
# kita memang tidak memakainya — agen ialah Cline.
rm -rf "$CS/lib/vscode-reh-web-linux-x64/extensions/copilot"

echo "── KEEP_MODULES=1 npm run release (release/ berdiri sendiri) ──"
( cd "$CS" && KEEP_MODULES=1 MINIFY=true npm run release ) || { echo "✗ release gagal"; exit 1; }

[ -x "$CS_BIN" ] || { echo "✗ $CS_BIN tiada selepas release"; exit 1; }
echo "✓ release siap: $RELEASE (bin/tukuk-agent wujud)"

# ── 2. Tentukan vsix Cline (arg $1 ATAU vendor/extensions/cline.vsix) ──
VSIX="${1:-$CS/vendor/extensions/cline.vsix}"
EXTDIR="$RELEASE/extensions"
mkdir -p "$EXTDIR"

if [ -f "$VSIX" ]; then
  echo "── pasang pelanjutan: $VSIX ──"
  # --extensions-dir mengarah pasang ke direktori terkawal kita (bukan ~/.vscode).
  "$CS_BIN" --extensions-dir "$EXTDIR" --install-extension "$VSIX" --force \
    || echo "⚠ install-extension gagal (cuba manual pada VPS: bin/tukuk-agent --install-extension)"
else
  echo "⚠ Tiada vsix di $VSIX."
  echo "  Muat Cline dari Open VSX (pinned) → letak di $CS/vendor/extensions/cline.vsix"
  echo "  atau hantar:  bash scripts/build-tukuk-agent.sh /path/cline.vsix"
  echo "  (build release tetap sah; pelanjutan boleh dipasang kemudian di VPS.)"
fi

# ── 3. Seed konfigurasi Tukuk-OS (MCP) + tetapan VS Code sebagai templat ──
# VS Code settings.json → <user-data>/User/settings.json (contoh; VPS puncai
# user-data di /var/lib/tukuk-agent/user-data).
SEED="$RELEASE/tukuk-agent-seed"
mkdir -p "$SEED/User"
cp "$DEFAULTS/settings.json" "$SEED/User/settings.json"
# mcp_settings.json → globalStorage Cline (lokasi tepat bergantung versi Cline;
# salin/masuk melalui UI Cline 'Edit MCP Settings' jika perlu).
cp "$DEFAULTS/mcp_settings.json" "$SEED/mcp_settings.json"
echo "✓ templat konfigurasi disalin ke $SEED (settings.json + mcp_settings.json)"

# ── 4. Ringkasan langkah deploy ──
cat <<EOF

════════════════════════════════════════════════════════════════════════
Tukuk Agent release siap di: $RELEASE
Seterusnya (VPS, TIADA build berat di sana):
  1. rsync $RELEASE/ → /opt/tukuk-agent/release/  (chown tukuk-agent)
  2. pasangkan user + servis:  lihat NOTA DEPLOY di deploy/tukuk-agent.service
  3. letak AGENT_TOKEN + AGENT_ORIGIN dalam /home/tukuk/.config/tukuk-os/env
     (nilai padanan yang sama dipakai pelanjutan Cline sebagai API Key)
  4. dalam Cline (UI): Provider=OpenAI Compatible,
       Base URL  https://tukuk.org/api/agent/v1
       API Key   <AGENT_TOKEN>
       Model     tukuk-agent
     MCP sudah didaftar: tukuk-os (tukuk_search/ask/plan/scaffold/review/agent)
  5. systemctl enable --now tukuk-agent  →  https://agent.tukuk.org
════════════════════════════════════════════════════════════════════════
EOF
