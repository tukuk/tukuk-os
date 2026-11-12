#!/usr/bin/env node
/**
 * generate-agent-icons.js — Rebrand the Tukuk Agent (forked code-server) media
 * to the Tukuk OS identity. Renders the parent logo-mark over the Tukuk dark
 * background and writes the full icon set code-server expects:
 *   favicon.svg, favicon-dark-support.svg, favicon.ico,
 *   pwa-icon-{192,512}.png, pwa-icon-maskable-{192,512}.png
 *
 * Run: node scripts/generate-agent-icons.js
 */
const fs = require("fs")
const path = require("path")
const sharp = require("sharp")

const REPO = path.resolve(__dirname, "..")
const MEDIA = path.join(REPO, "code-server", "src", "browser", "media")

// Tukuk brand palette (matches public/theme.css dark surface + accent).
const BG = "#0f1115"
const ACCENT = "#4c8dff"
const INK = "#e6e9ef"

/** Square app icon, `size`px, mark centered with padding. */
function iconSvg(size, { fullBleed = false } = {}) {
  // fullBleed (maskable) keeps safe-zone padding so nothing is clipped.
  const pad = fullBleed ? size * 0.22 : size * 0.16
  const box = size - pad * 2
  const cx = size / 2
  const cy = size / 2
  const u = box / 130 // scale factor from the 130-unit logo-mark viewBox
  const ringR = 26 * u
  const ringCx = cx - (56 - 65) * u // recentre mark within canvas
  const ringCy = cy
  const stroke = 11 * u
  const bar = 7 * u
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="${ACCENT}" stroke-width="${stroke}"/>
  <line x1="${ringCx + ringR * 0.72}" y1="${ringCy + ringR * 0.72}" x2="${ringCx + 47 * u}" y2="${ringCy + 47 * u}" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round"/>
  <rect x="${ringCx - 12 * u}" y="${ringCy - 4 * u}" width="${bar}" height="${12 * u}" rx="${2.5 * u}" fill="${INK}"/>
  <rect x="${ringCx - 1 * u}" y="${ringCy - 13 * u}" width="${bar}" height="${21 * u}" rx="${2.5 * u}" fill="${ACCENT}"/>
  <rect x="${ringCx + 10 * u}" y="${ringCy - 8 * u}" width="${bar}" height="${16 * u}" rx="${2.5 * u}" fill="${INK}"/>
</svg>`
}

// Simple circular "T" search-glyph favicon for tiny browser tabs.
function faviconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${BG}"/>
  <circle cx="27" cy="27" r="13" fill="none" stroke="${ACCENT}" stroke-width="6"/>
  <line x1="37" y1="37" x2="48" y2="48" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round"/>
  <rect x="3" y="55" width="58" height="4" rx="2" fill="${ACCENT}"/>
</svg>`
}

/** Build a PNG-compressed ICO container from a list of PNG buffers. */
function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const offset = 6 + count * 16
  let total = offset
  for (const p of pngs) total += p.length
  const buf = Buffer.alloc(total)
  header.copy(buf, 0)
  let cursor = offset
  pngs.forEach((p, i) => {
    const dim = p.readUInt32BE(16) // PNG IHDR width
    const entry = 6 + i * 16
    buf.writeUInt8(dim >= 256 ? 0 : dim, entry) // width
    buf.writeUInt8(dim >= 256 ? 0 : dim, entry + 1) // height
    buf.writeUInt8(0, entry + 2) // color count
    buf.writeUInt8(0, entry + 3) // reserved
    buf.writeUInt16LE(1, entry + 4) // planes
    buf.writeUInt16LE(32, entry + 6) // bit count
    buf.writeUInt32LE(p.length, entry + 8) // bytes in resource
    buf.writeUInt32LE(cursor, entry + 12) // image offset
    p.copy(buf, cursor)
    cursor += p.length
  })
  return buf
}

async function main() {
  fs.mkdirSync(MEDIA, { recursive: true })

  // Vector favicons.
  fs.writeFileSync(path.join(MEDIA, "favicon.svg"), faviconSvg(64))
  // Dark-support variant: transparent bg for light-mode tabs.
  fs.writeFileSync(
    path.join(MEDIA, "favicon-dark-support.svg"),
    faviconSvg(64).replace(`fill="${BG}"`, 'fill="none"'),
  )

  // Raster favicon (.ico). This sharp build has no ICO writer, so we wrap one
  // or more PNG frames in an ICO container by hand (PNG-compressed ICO entries).
  const sizes = [16, 32, 48]
  const frames = []
  for (const s of sizes) {
    frames.push(await sharp(Buffer.from(faviconSvg(s))).png({ width: s, height: s }).toBuffer())
  }
  fs.writeFileSync(path.join(MEDIA, "favicon.ico"), buildIco(frames))

  // PWA icons.
  for (const size of [192, 512]) {
    const png = await sharp(Buffer.from(iconSvg(size))).png().toBuffer()
    fs.writeFileSync(path.join(MEDIA, `pwa-icon-${size}.png`), png)
    const maskable = await sharp(Buffer.from(iconSvg(size, { fullBleed: true }))).png().toBuffer()
    fs.writeFileSync(path.join(MEDIA, `pwa-icon-maskable-${size}.png`), maskable)
  }

  console.log("Wrote Tukuk Agent icon set to", MEDIA)
  for (const f of fs.readdirSync(MEDIA)) console.log("  -", f)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
