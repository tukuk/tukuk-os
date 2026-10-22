#!/usr/bin/env node
/*
 * Tukuk-OS starter CLI (bin).
 *
 *   tukuk-os           -> launch the search engine (index.js)
 *   tukuk-os mcp       -> launch the MCP server (stdio) — for AI clients (Kilo/Claude)
 *
 * spawn is used so that `require.main === module` inside mcp/server.js stays true
 * and main() runs exactly like `node mcp/server.js`.
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
  process.stderr.write(`[tukuk-os] failed to launch: ${err.message}\n`);
  process.exit(1);
});
