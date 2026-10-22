#!/usr/bin/env node
/**
 * generate-store-icons.js — Jana ikon SVG berasingan untuk setiap app bawaan
 * (/public/icons/apps/<nama>.svg) dan setiap game Arked (/public/icons/games/<kind>.svg).
 *
 * Setiap ikon = jubin 128×128 dengan gradien + emoji gamenya, jadi tab pelayar,
 * buku tanda dan skrin utama boleh bezakan app/game walaupun tanpa favicon PNG.
 *
 * Guna: node scripts/generate-store-icons.js
 */
const fs = require('fs');
const path = require('path');

const OUT_APPS = path.join(__dirname, '..', 'public', 'icons', 'apps');
const OUT_GAMES = path.join(__dirname, '..', 'public', 'icons', 'games');

// name → {em: emoji, c1/c2: hujung gradien} — selari dengan STORE_APP_META & TYPES Arked
const APPS = {
  notes:    { em: '📝', c1: '#ffd166', c2: '#f77f00' },
  calc:     { em: '🧮', c1: '#4cc9f0', c2: '#4361ee' },
  todo:     { em: '✅', c1: '#06d6a0', c2: '#0a9c6e' },
  convert:  { em: '📐', c1: '#b891ff', c2: '#7b2ff7' },
  timer:    { em: '⏱️', c1: '#ef476f', c2: '#b91c44' },
  color:    { em: '🎨', c1: '#f78c6b', c2: '#e5446d' },
  password: { em: '🔐', c1: '#8d99ae', c2: '#4a5568' },
  text:     { em: '🔡', c1: '#4c8dff', c2: '#2b5cd9' },
  pixel:    { em: '🟩', c1: '#30d158', c2: '#1a7f3c' },
  piano:    { em: '🎹', c1: '#e8eaf0', c2: '#9aa3b5' },
  spiro:    { em: '🌀', c1: '#4cc9f0', c2: '#b891ff' },
  orbit:    { em: '🪐', c1: '#ffd166', c2: '#ef476f' },
  fractal:  { em: '🔮', c1: '#a259ff', c2: '#4c8dff' },
  drum:     { em: '🥁', c1: '#ff9f43', c2: '#ef233c' },
  pubg:     { em: '🪂', c1: '#7d9c5b', c2: '#3f5232' },
  // New utility tools
  calendar: { em: '📅', c1: '#4c8dff', c2: '#1d4ed8' },
  dice:     { em: '🎲', c1: '#f59e0b', c2: '#d97706' },
  tip:      { em: '💵', c1: '#10b981', c2: '#059669' },
  bmi:      { em: '⚖️', c1: '#6366f1', c2: '#4338ca' },
  // Hit game ports — unique gradient + emoji per title
  candy:     { em: '🍬', c1: '#ff6b9d', c2: '#c44569' },
  flappy:    { em: '🐦', c1: '#ffd166', c2: '#ef7d00' },
  subway:    { em: '🚇', c1: '#06d6a0', c2: '#0885a3' },
  slice:     { em: '🍉', c1: '#ff6b6b', c2: '#2d6a4f' },
  roadhop:   { em: '🐸', c1: '#52b788', c2: '#1b4332' },
  bubble:    { em: '🫧', c1: '#90e0ef', c2: '#48bfe3' },
  ludo:      { em: '🎲', c1: '#ef476f', c2: '#ffd166' },
  solitaire: { em: '🃏', c1: '#e63946', c2: '#1d3557' },
  number2048:{ em: '🧊', c1: '#f2b179', c2: '#d97b2f' },
  blockdrop: { em: '🧩', c1: '#a259ff', c2: '#6d28d9' },
  snake:     { em: '🐍', c1: '#30d158', c2: '#0f6b31' },
  mines:     { em: '💣', c1: '#ff9f43', c2: '#c96a10' },
  connect4:  { em: '🔴', c1: '#ef233c', c2: '#1a5cff' },
  breakout:  { em: '🧱', c1: '#4c8dff', c2: '#2b5cd9' },
  invaders:  { em: '👾', c1: '#9b5de5', c2: '#f15bb5' },
  doodle:    { em: '🦘', c1: '#fee440', c2: '#00f5d4' },
  pong:      { em: '🏓', c1: '#00bbf9', c2: '#0077b6' },
  stack:     { em: '🗼', c1: '#ff9e00', c2: '#ff4800' },
  simon:     { em: '🎼', c1: '#06d6a0', c2: '#118ab2' },
  muncher:   { em: '🟡', c1: '#ffd60a', c2: '#ff006e' },
  puzzle15:  { em: '🔢', c1: '#8338ec', c2: '#3a86ff' },
  tictactoe: { em: '❌', c1: '#ef476f', c2: '#06d6a0' },
  memory:    { em: '🧠', c1: '#b891ff', c2: '#7b2ff7' },
  whack:     { em: '🔨', c1: '#e76f51', c2: '#264653' },
};
const GAMES = {
  ttt:      { em: '⭕', c1: '#ef476f', c2: '#b91c44' },
  memory:   { em: '🧠', c1: '#b891ff', c2: '#7b2ff7' },
  mole:     { em: '🐹', c1: '#f78c6b', c2: '#c96a35' },
  rps:      { em: '✊', c1: '#4cc9f0', c2: '#4361ee' },
  reaction: { em: '⚡', c1: '#ffd166', c2: '#f77f00' },
  guess:    { em: '🔢', c1: '#06d6a0', c2: '#0a9c6e' },
  quiz:     { em: '💡', c1: '#4c8dff', c2: '#2b5cd9' },
  br:       { em: '🔫', c1: '#8d99ae', c2: '#3d4451' },
  fps:      { em: '🎯', c1: '#ef233c', c2: '#8d1420' },
  runner:   { em: '🏃', c1: '#30d158', c2: '#1a7f3c' },
  s2048:    { em: '🧊', c1: '#f2b179', c2: '#d97b2f' },
  snake:    { em: '🐍', c1: '#30d158', c2: '#0f6b31' },
  breakout: { em: '🧱', c1: '#4c8dff', c2: '#2b5cd9' },
  blox:     { em: '🧩', c1: '#a259ff', c2: '#6d28d9' },
  astro:    { em: '☄️', c1: '#26c6da', c2: '#0e7c8b' },
  mines:    { em: '💣', c1: '#ff9f43', c2: '#c96a10' },
  arcade:   { em: '🕹️', c1: '#f7b32b', c2: '#b3541e' },
};

function svg(icon) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${icon.c1}"/><stop offset="1" stop-color="${icon.c2}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <circle cx="42" cy="30" r="58" fill="#ffffff" opacity="0.10"/>
  <rect x="6" y="6" width="116" height="116" rx="24" fill="none" stroke="#000000" stroke-opacity="0.18"/>
  <text x="64" y="72" font-size="66" text-anchor="middle" dominant-baseline="middle">${icon.em}</text>
</svg>
`;
}

function writeAll(dir, map) {
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [name, icon] of Object.entries(map)) {
    fs.writeFileSync(path.join(dir, name + '.svg'), svg(icon));
    n++;
  }
  return n;
}

const a = writeAll(OUT_APPS, APPS);
const g = writeAll(OUT_GAMES, GAMES);
console.log(`Icons generated: ${a} apps → public/icons/apps/ · ${g} games → public/icons/games/`);
