#!/usr/bin/env node
'use strict';
// Compare the repo's tunnel list with the edge, and count the tunnels that exist.
//
// Why this exists: this box runs its tunnel in TOKEN mode, and cloudflared IGNORES the local
// `ingress:` block in that mode — the edge decides, and the edge is the Cloudflare dashboard.
// So `deploy/cloudflared/config.yml` is a canonical LIST, not the source of truth, and the two
// can drift without a single symptom: a hostname added in the dashboard but not in the file is
// a rebuild away from vanishing, and one in the file but not at the edge is a route that has
// never worked. Neither failure produces a log line anywhere.
//
//   node scripts/cloudflared-audit.js           # human output
//   node scripts/cloudflared-audit.js --json    # machine output
//   node scripts/cloudflared-audit.js --offline # parse the repo only, no API calls
//
// Exit codes: 0 in step (or nothing to compare), 1 drift, 2 the API refused us (scope) —
// 2 is deliberately NOT 1: a token without Tunnel:Read is a credential problem, not a defect
// in the routing, and CI should be able to tell them apart.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'deploy', 'cloudflared', 'config.yml');
const API = 'https://api.cloudflare.com/client/v4';

function parseHosts(text) {
  return text.split('\n')
    .map((l) => l.match(/^\s*-\s*hostname:\s*(\S+)\s*$/))
    .filter(Boolean)
    .map((m) => m[1].toLowerCase());
}

// .env is gitignored and the shipped defaults live in deploy/env.defaults; read whichever
// exists, with the process environment winning (a CI run supplies both keys that way).
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function credentials() {
  // Three sources, later ones winning: the publishable defaults, the private half that
  // is not in git, then the box's own .env (which scripts/make-env.sh builds from the
  // first two). Reading env.secrets here is why the audit still works on a laptop that
  // has no .env — the token left env.defaults when the repo became publishable.
  const env = {
    ...readEnvFile(path.join(ROOT, 'deploy', 'env.defaults')),
    ...readEnvFile(path.join(ROOT, 'deploy', 'env.secrets')),
    ...readEnvFile(path.join(ROOT, '.env')),
  };
  const pick = (k) => process.env[k] || env[k] || '';
  return { account: pick('CLOUDFLARE_ACCOUNT_ID'), token: pick('CLOUDFLARE_API_TOKEN'), tunnel: pick('CF_TUNNEL_ID') };
}

async function api(pathname, token) {
  const res = await fetch(API + pathname, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const detail = (body.errors || []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const offline = argv.includes('--offline');

  const local = parseHosts(fs.readFileSync(CONFIG, 'utf8'));
  const report = { local, edge: null, tunnels: null, missingAtEdge: [], missingInRepo: [], notes: [] };
  const out = (obj) => (json ? console.log(JSON.stringify(obj, null, 2)) : null);

  const { account, token, tunnel } = credentials();
  if (offline || !account || !token || !tunnel) {
    report.notes.push(offline
      ? 'offline: repo list only, the edge was not asked'
      : 'no CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CF_TUNNEL_ID — repo list only');
    if (!json) {
      console.log(`tunnel list in the repo (${local.length}):`);
      for (const h of local) console.log(`  ${h}`);
      console.log(`\n${report.notes[0]}`);
    }
    out(report);
    return 0;
  }

  try {
    // Both calls need Tunnel:Read. A 403/401 here is a scope problem, not drift.
    const list = await api(`/accounts/${account}/cfd_tunnel?is_deleted=false&per_page=50`, token);
    report.tunnels = (list || []).map((t) => ({ id: t.id, name: t.name, status: t.status, connections: (t.connections || []).length }));

    const cfg = await api(`/accounts/${account}/cfd_tunnel/${tunnel}/configurations`, token);
    report.edge = ((cfg && cfg.config && cfg.config.ingress) || [])
      .map((r) => (r.hostname || '').toLowerCase())
      .filter(Boolean);

    report.missingAtEdge = local.filter((h) => !report.edge.includes(h));
    report.missingInRepo = report.edge.filter((h) => !local.includes(h));
  } catch (err) {
    report.notes.push(`the API refused the check: ${err.message}`);
    if (!json) console.error(`[tunnel-audit] ${report.notes[0]}`);
    out(report);
    return 2;
  }

  if (!json) {
    console.log(`live tunnels (${report.tunnels.length}):`);
    for (const t of report.tunnels) {
      const mark = t.id === tunnel ? ' <= configured' : '';
      console.log(`  ${t.id}  ${t.name.padEnd(16)} ${t.status}  ${t.connections} connection(s)${mark}`);
    }
    if (report.tunnels.length > 1) {
      console.log('\nA second tunnel exists. Routes belong on the configured one — a second connector is');
      console.log('a second credential, a second unit, and a hostname that 530s when it is forgotten.');
    }
    console.log(`\nedge list (${report.edge.length}) vs repo list (${local.length}):`);
    for (const h of report.missingAtEdge) console.log(`  MISSING AT THE EDGE  ${h}   (in the repo, not routed — never live)`);
    for (const h of report.missingInRepo) console.log(`  MISSING IN THE REPO  ${h}   (live now, lost on the next rebuild)`);
    if (!report.missingAtEdge.length && !report.missingInRepo.length) console.log('  in step');
  }
  out(report);

  const drift = report.missingAtEdge.length + report.missingInRepo.length;
  const extraTunnel = report.tunnels.length > 1;
  return drift || extraTunnel ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[tunnel-audit] ${err && err.stack ? err.stack : err}`);
    process.exit(2);
  });
