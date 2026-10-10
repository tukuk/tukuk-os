#!/usr/bin/env node
/*
 * Tukuk-OS CLI pemula (bin).
 *
 *   tukuk-os           -> lancarkan enjin carian (index.js)
 *   tukuk-os mcp       -> lancarkan MCP server (stdio) — untuk pelanggan AI (Kilo/Claude)
 *
 * Menggunakan spawn supaya `require.main === module` dalam mcp/server.js
 * tetap benar dan main() berjalan seperti `node mcp/server.js`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const isMcp = args[0] === 'mcp';
const target = isMcp
  ? path.join(__dirname, '..', 'mcp', 'server.js')
  : path.join(__dirname, '..', 'index.js');
const forward = isMcp ? args.slice(1) : args;

const child = spawn(process.execPath, [target, ...forward], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 0 : code);
});
child.on('error', (err) => {
  process.stderr.write(`[tukuk-os] gagal melancarkan: ${err.message}\n`);
  process.exit(1);
});
