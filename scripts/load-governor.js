'use strict';
/*
 * load-governor.js — watch the machine, not just the website.
 *
 * Why this exists: on 2026-10-23 the box was "heavy" and nothing in the app was at fault.
 * A GUI login greeter, left running by a desktop stack nobody logs into, had burned 85.7%
 * of a CPU core continuously for 3.5 days. No health check would ever have noticed, because
 * /health was perfectly fine — the outage was a slow leak, not a crash.
 *
 * So this sampler answers a different question than the watchdog: not "is the site up" but
 * "who is using this server, and is anything using it for no reason". It runs every 2 minutes
 * from a systemd timer and writes three files under data/ (git-ignored, never served):
 *
 *   data/load-snapshot.json  the current reading + 24h of history — the admin panel reads this
 *   data/load-prev.json      the previous raw counters, used to turn totals into rates
 *   data/load-alerts.json    capped alert history, also written to the journal
 *
 * Two deliberate rules:
 *   1. It ONLY reads. It never kills, restarts or disables anything. A monitor that takes
 *      action becomes a second outage, and the failure mode above is not worth that risk.
 *   2. It ALWAYS exits 0. If sampling throws, that is logged and the previous snapshot stays.
 *
 * Everything reported here is host detail. It is served only behind auth.requireAdmin and
 * must never reach a public page or a public API.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA = path.join(process.cwd(), 'data');
const SNAPSHOT = path.join(DATA, 'load-snapshot.json');
const PREV = path.join(DATA, 'load-prev.json');
const ALERTS = path.join(DATA, 'load-alerts.json');

// Services this box is supposed to run. Anything here that reports a restart, or disappears,
// is worth an alert; `not-found` is skipped so the file survives a machine that lacks a unit.
const SERVICES = [
  'tukuk-os.service', 'meilisearch.service', 'tukuk-agent.service', 'tukuk-builder.service',
  'cloudflared.service', 'nginx.service', 'systemd-journald.service',
];
// Units switched off on purpose (deploy/lighten-server.sh). If one comes back — an apt upgrade
// re-enabling lightdm is exactly how the greeter returned before — say so.
const MUST_STAY_OFF = [
  'lightdm.service', 'avahi-daemon.service', 'cups.service', 'cups-browsed.service',
  'bluetooth.service', 'ModemManager.service', 'smbd.service', 'nmbd.service',
  'udisks2.service', 'apport.service', 'pmcd.service', 'pmie.service', 'pmlogger.service',
  'pmproxy.service',
];

// Thresholds. Tuned to this box: 4 cores, ~6.8 GB RAM, and a normal idle load of ~0.2.
const LIMITS = {
  loadPerCore: 1.5,      // sustained demand above 1.5x the core count means queueing
  memAvailFraction: 0.15, // below 15 % free is where reclaim starts costing latency
  swapUsedFraction: 0.30, // only meaningful when swap exists
  rogueCpuPct: 60,        // one unsupervised process eating 60 % of a core for 2 min
  rogueRssMb: 512,        // ... or holding half a GB with nothing managing it
  minSamplesForRate: 30,  // ignore rate maths over a shorter window than this (seconds)
};
const RE_ALERT_AFTER_MS = 30 * 60 * 1000; // do not shout the same line every 2 minutes
const HISTORY_MAX = 720;                   // 24 h at one sample per 2 min
const ALERTS_MAX = 300;

const HZ = (() => { try { return Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100; } catch { return 100; } })();
const PAGE_KB = (() => { try { return (Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim()) || 4096) / 1024; } catch { return 4; } })();

function log(msg) {
  console.log(`[load-governor] ${msg}`);
  try { execFileSync('systemd-cat', ['--identifier=load-governor', 'cat'], { input: msg + '\n', stdio: ['pipe', 'ignore', 'ignore'] }); } catch { /* journal is optional */ }
}
function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
// Never leave a half-written snapshot for the admin panel to choke on.
function writeAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

// ── host: load, memory, disk ────────────────────────────────────────────────
function host() {
  const [l1, l5, l15] = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
  const mem = {};
  for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
    const m = /^(\w+):\s+(\d+)\s+kB$/.exec(line);
    if (m) mem[m[1]] = Number(m[2]) / 1024; // MB
  }
  const cores = os.cpus().length;
  let disk = null;
  try {
    const out = execFileSync('df', ['-kP', '/'], { encoding: 'utf8' }).split('\n')[1].split(/\s+/);
    disk = { totalMb: Math.round(Number(out[1]) / 1024), usedMb: Math.round(Number(out[2]) / 1024), freeMb: Math.round(Number(out[3]) / 1024) };
  } catch { /* df missing: report null rather than a guess */ }
  const uptimeSec = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]) || 0;
  return {
    cores,
    load1: l1, load5: l5, load15: l15,
    loadPerCore1: +(l1 / cores).toFixed(2),
    memTotalMb: Math.round(mem.MemTotal || 0),
    memAvailMb: Math.round(mem.MemAvailable || 0),
    memAvailPct: mem.MemTotal ? Math.round((mem.MemAvailable / mem.MemTotal) * 100) : 0,
    swapTotalMb: Math.round(mem.SwapTotal || 0),
    swapUsedMb: Math.round((mem.SwapTotal || 0) - (mem.SwapFree || 0)),
    disk,
    uptimeHours: Math.round(uptimeSec / 3600),
  };
}

// ── services: memory in, CPU out ────────────────────────────────────────────
// One `systemctl show` per unit. Measured on the server, not assumed: systemd 259 does not print
// the `Unit=` property even when asked for it, so a multi-unit call comes back as nameless blocks
// that cannot be attributed — that is how this function once silently reported zero services. Its
// CPU total is not exposed through `systemctl show` either, so it is read from the unit's own
// cgroup, which is the file the kernel actually maintains.
function cgroupUs(unit) {
  // Every unit tracked here is a system unit, and those live in system.slice under their exact name.
  try {
    const m = /^usage_usec (\d+)/m.exec(fs.readFileSync(`/sys/fs/cgroup/system.slice/${unit}/cpu.stat`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; } // never started: there is no cgroup, which is unknown rather than zero
}

// Cumulative CPU, in the unit that actually shows something. A fixed number of hours rounded every
// service younger than ~18 minutes to 0, which is the one number worth reading: how much of this
// machine a unit has taken in total. The greeter's 256,700 CPU-seconds read as "3.0 d" here.
function cpuText(us) {
  if (us === null) return null;
  if (us < 1e6) return `${Math.round(us / 1000)} ms`;
  if (us < 6e7) return `${(us / 1e6).toFixed(1)} s`;
  if (us < 3.6e9) return `${(us / 6e7).toFixed(1)} min`;
  if (us < 8.64e10) return `${(us / 3.6e9).toFixed(1)} h`;
  return `${(us / 8.64e10).toFixed(1)} d`;
}

function units(names, prev) {
  const interval = prev && prev.sampledAtMs ? (Date.now() - prev.sampledAtMs) / 1000 : 0;
  const rows = [];
  for (const unit of names) {
    let out = '';
    try {
      out = execFileSync('systemctl', ['show', unit,
        '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID',
        '-p', 'MemoryCurrent', '-p', 'MemoryMax', '-p', 'NRestarts', '-p', 'TasksCurrent'],
      { encoding: 'utf8', timeout: 5000 });
    } catch (err) {
      log(`systemctl show ${unit} failed (${err.message}) — skipped this sample`);
      continue;
    }
    const p = {};
    for (const line of out.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) p[line.slice(0, eq)] = line.slice(eq + 1);
    }
    if (p.LoadState === 'not-found') continue; // this machine does not have that unit at all
    // systemd prints "[not set]", "infinity" and uint64 -1 for "no limit"/"never started", and
    // Number() turns each of those into a plausible-looking catastrophe, so bounds are checked.
    const num = (k) => { const v = Number(p[k]); return Number.isFinite(v) && v >= 0 && v < 1e15 ? v : null; };
    const cpuUs = cgroupUs(unit);
    const prevUs = prev && prev.services && prev.services[unit] ? prev.services[unit].cpuUs : null;
    let cpuPct = null;
    if (cpuUs !== null && prevUs !== null && interval > LIMITS.minSamplesForRate) {
      cpuPct = +(((cpuUs - prevUs) / 1e6 / interval) * 100).toFixed(1);
      if (cpuPct < 0) cpuPct = null; // counter reset (unit restarted) — the restart alerts cover it
    }
    const memCur = num('MemoryCurrent');
    const memMax = num('MemoryMax');
    rows.push({
      unit,
      state: `${p.ActiveState || '?'}/${p.SubState || '?'}`,
      pid: Number(p.MainPID) || 0,
      memoryMb: memCur === null ? null : Math.round(memCur / 1048576),
      memoryLimitMb: memMax === null ? null : Math.round(memMax / 1048576),
      cpuPct,
      cpuUs,
      cpuTotalText: cpuText(cpuUs),
      restarts: Number(p.NRestarts) || 0,
      tasks: num('TasksCurrent'),
    });
  }
  return rows;
}

// ── processes: find the greeter case ────────────────────────────────────────
// A process is "unsupervised" when nothing in its cgroup path is a .service: it belongs to a
// login session, a transient scope or nothing at all. That is precisely where a runaway that
// no unit file, no restart policy and no health check will ever notice lives.
function ownUnit(cgroupText) {
  for (const line of cgroupText.split('\n')) {
    const idx = line.indexOf('::');
    if (idx < 0) continue;
    for (const part of line.slice(idx + 2).split('/')) {
      if (part.endsWith('.service')) return part;
    }
    return null; // a slice/scope path: no owning service
  }
  return null;
}

function processes(prev) {
  const prevProcs = (prev && prev.procs) || {};
  const interval = prev && prev.sampledAtMs ? (Date.now() - prev.sampledAtMs) / 1000 : 0;
  // Field 22 of /proc/pid/stat is start time in clock ticks since boot, so boot uptime is needed
  // to convert a process's total CPU into "what fraction of a core has it been burning all its life".
  const bootUptimeSec = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]) || 0;
  const list = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let stat, statm, cgroup;
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      statm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8');
      cgroup = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    } catch { continue; } // exited mid-scan, or permission — skip it, do not fail the run
    const close = stat.lastIndexOf(')');
    if (close < 0) continue;
    const comm = stat.slice(stat.indexOf('(') + 1, close);
    const f = stat.slice(close + 2).split(' ');
    const state = f[0];
    const ppid = Number(f[1]) || 0;
    if (state === 'Z') continue; // zombies cost no CPU
    if (ppid === 2) continue;    // kthreadd's children: kernel workers, no unit, no business here
    const utime = Number(f[11]) || 0, stime = Number(f[12]) || 0;
    const starttime = Number(f[19]) || 0; // defeats PID reuse between samples
    const rssMb = Math.round((Number(statm.split(' ')[1]) || 0) * PAGE_KB / 1024);
    const key = `${pid}:${starttime}`;
    const before = prevProcs[key];
    let cpuPct = null;
    if (before && interval > LIMITS.minSamplesForRate) {
      const ticks = (utime + stime) - before.ticks;
      if (ticks >= 0) cpuPct = +((ticks / HZ / interval) * 100).toFixed(1);
    }
    // The interval rate needs a previous sighting, which a freshly spawned runaway does not have
    // yet. Age since process start is available immediately and is the same arithmetic that proved
    // the greeter was burning 85.7% of a core, so it is reported as `sinceStartPct`.
    const ageSec = bootUptimeSec - starttime / HZ;
    let sinceStartPct = null;
    if (ageSec > 60) sinceStartPct = +(((utime + stime) / HZ / ageSec) * 100).toFixed(1);
    list.push({
      pid, comm, starttime, rssMb, ticks: utime + stime, cpuPct, sinceStartPct,
      // The same lifetime total the greeter was proven with: 256,700 CPU-seconds is not a rate,
      // it is a bill, and it is the number that says "this has been burning since Thursday".
      cpuTotalText: cpuText(Math.round((utime + stime) / HZ * 1e6)),
      unit: ownUnit(cgroup),
    });
  }
  const totalCpuTicks = list.reduce((n, p) => n + p.ticks, 0);
  // Rank by what the process did in THIS interval, falling back to its lifetime rate, then to
  // memory. Before the second sample there are no interval rates at all, so `hot` keeps the
  // ordering honest instead of pretending an empty column means "idle".
  const hot = (p) => (p.cpuPct !== null ? p.cpuPct : p.sinceStartPct || 0);
  const rank = (a, b) => {
    if (hot(a) === 0 && hot(b) === 0) return b.rssMb - a.rssMb;
    return hot(b) - hot(a) || b.ticks - a.ticks;
  };
  const keep = [...list].sort(rank).slice(0, 80);
  const procsForPrev = {};
  for (const p of keep) procsForPrev[`${p.pid}:${p.starttime}`] = { ticks: p.ticks, comm: p.comm };
  const busy = [...list].sort(rank).slice(0, 8);
  const fat = [...list].sort((a, b) => b.rssMb - a.rssMb).slice(0, 8);
  // A busy-but-small process is exactly the greeter case, so CPU alerts do not go through the
  // memory filter: report anything unsupervised that is either doing work or holding memory.
  const unsupervised = list.filter((p) => !p.unit && (hot(p) > 1 || p.rssMb > 40))
    .sort((a, b) => hot(b) - hot(a) || b.rssMb - a.rssMb).slice(0, 12);
  return { busy, fat, unsupervised, procsForPrev, totalCpuTicks, scanned: list.length };
}

// ── alerts ─────────────────────────────────────────────────────────────────
function evaluate(h, svcs, procs, prev, lastAlerts) {
  const now = Date.now();
  const fresh = (key) => {
    const at = lastAlerts[key];
    if (at && now - at < RE_ALERT_AFTER_MS) return false;
    lastAlerts[key] = now;
    return true;
  };
  const out = [];
  const push = (key, level, text) => { if (fresh(key)) out.push({ at: new Date(now).toISOString(), key, level, text }); };

  if (h.loadPerCore1 > LIMITS.loadPerCore) {
    push('load', 'warn', `load ${h.load1.toFixed(2)} across ${h.cores} cores = ${h.loadPerCore1}x capacity (5-min ${h.load5})`);
  }
  if (h.memTotalMb > 0 && h.memAvailPct < LIMITS.memAvailFraction * 100) {
    push('mem', 'crit', `only ${h.memAvailMb} MB free of ${h.memTotalMb} MB (${h.memAvailPct}%)`);
  }
  if (h.swapTotalMb > 0 && h.swapUsedMb / h.swapTotalMb > LIMITS.swapUsedFraction) {
    push('swap', 'warn', `${h.swapUsedMb} MB of ${h.swapTotalMb} MB swap in use — memory pressure is real now`);
  }
  if (h.disk && h.disk.freeMb < 2048) {
    push('disk', 'crit', `root filesystem has only ${h.disk.freeMb} MB free`);
  }
  for (const s of svcs) {
    if (s.state.startsWith('failed') || s.state === 'inactive/failed') {
      push(`down:${s.unit}`, 'crit', `${s.unit} is ${s.state}`);
    }
    const was = prev && prev.services && prev.services[s.unit];
    if (was && s.restarts > was.restarts) {
      push(`restart:${s.unit}`, 'warn', `${s.unit} restarted (${was.restarts} → ${s.restarts} total)`);
    }
  }
  for (const unit of MUST_STAY_OFF) {
    const s = svcs.find((x) => x.unit === unit);
    if (s && s.state.startsWith('active')) {
      push(`backon:${unit}`, 'warn', `${unit} is running again although it was switched off on purpose (deploy/lighten-server.sh)`);
    }
  }
  for (const p of procs.unsupervised) {
    const burning = Math.max(p.cpuPct === null ? -1 : p.cpuPct, p.sinceStartPct === null ? -1 : p.sinceStartPct);
    if (burning > LIMITS.rogueCpuPct) {
      const how = p.cpuPct !== null && p.cpuPct >= (p.sinceStartPct || 0) ? `${p.cpuPct}% over the last interval` : `${p.sinceStartPct}% averaged over its whole life`;
      push(`roguecpu:${p.comm}`, 'crit', `${p.comm} (pid ${p.pid}) is using ${how} of a core, has taken ${p.cpuTotalText} of CPU in total, and belongs to no service — nothing will restart or stop it`);
    }
    if (p.rssMb > LIMITS.rogueRssMb) {
      push(`rogueross:${p.comm}`, 'warn', `${p.comm} (pid ${p.pid}) holds ${p.rssMb} MB with no unit managing it`);
    }
  }
  return out;
}

function main() {
  const prev = readJsonSafe(PREV);
  const h = host();
  const svcs = units([...SERVICES, ...MUST_STAY_OFF], prev);
  const procs = processes(prev);
  const alertState = readJsonSafe(ALERTS) || { alerts: [] };
  const lastAlerts = {};
  for (const a of alertState.alerts) if (a.key) lastAlerts[a.key] = Date.parse(a.at) || 0;

  const alerts = evaluate(h, svcs, procs, prev, lastAlerts);
  for (const a of alerts) log(`${a.level.toUpperCase()} ${a.text}`);

  const snap = {
    sampledAt: new Date().toISOString(),
    hostname: os.hostname(),
    host: h,
    services: svcs.map((s) => ({ unit: s.unit, state: s.state, memoryMb: s.memoryMb, memoryLimitMb: s.memoryLimitMb, cpuPct: s.cpuPct, cpuTotalText: s.cpuTotalText, restarts: s.restarts })),
    topCpu: procs.busy.map((p) => ({ comm: p.comm, pid: p.pid, cpuPct: p.cpuPct, sinceStartPct: p.sinceStartPct, cpuTotalText: p.cpuTotalText, rssMb: p.rssMb, unit: p.unit || '(no service)' })),
    topRss: procs.fat.map((p) => ({ comm: p.comm, pid: p.pid, rssMb: p.rssMb, unit: p.unit || '(no service)' })),
    unsupervised: procs.unsupervised.map((p) => ({ comm: p.comm, pid: p.pid, rssMb: p.rssMb, cpuPct: p.cpuPct, sinceStartPct: p.sinceStartPct, cpuTotalText: p.cpuTotalText })),
    processesScanned: procs.scanned,
    newAlerts: alerts,
  };

  // 24 h of trend, one line per sample, so the panel can show "it started at 03:00".
  const previous = readJsonSafe(SNAPSHOT) || {};
  const history = Array.isArray(previous.history) ? previous.history : [];
  const hottest = procs.busy[0];
  history.push({
    t: snap.sampledAt, l1: h.load1, av: h.memAvailMb, sw: h.swapUsedMb,
    top: hottest ? `${hottest.comm} ${hottest.cpuPct !== null ? hottest.cpuPct + '%/int' : hottest.sinceStartPct + '%/life'}` : '',
  });
  while (history.length > HISTORY_MAX) history.shift();
  snap.history = history;

  fs.mkdirSync(DATA, { recursive: true });
  writeAtomic(SNAPSHOT, snap);
  writeAtomic(PREV, {
    sampledAtMs: Date.now(),
    // cpuUs has to be carried forward or the next run can never turn it into a rate.
    services: Object.fromEntries(svcs.map((s) => [s.unit, { cpuUs: s.cpuUs, restarts: s.restarts }])),
    procs: procs.procsForPrev,
  });
  alertState.alerts = [...alertState.alerts, ...alerts].slice(-ALERTS_MAX);
  writeAtomic(ALERTS, alertState);

  console.log(`[load-governor] load1=${h.load1} (${h.loadPerCore1}x) free=${h.memAvailMb}MB services=${svcs.length} scanned=${procs.scanned} alerts=${alerts.length}`);
}

// Exported so the systemd reading and the alert thresholds can be tested on their own. A bug in
// units() shows up as "no services", which is indistinguishable from a machine that genuinely has
// none — that is exactly how a parse bug survived a first run on the wrong box.
module.exports = { host, units, processes, evaluate, cgroupUs, cpuText, LIMITS, SERVICES, MUST_STAY_OFF };

if (require.main === module) {
  try { main(); } catch (err) {
    // Monitoring must never be the outage: report and leave the last good snapshot in place.
    log(`ERROR sampling failed: ${(err && err.message) || err}`);
  }
  process.exit(0);
}
