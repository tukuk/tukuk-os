const dns = require('dns');
const { EventEmitter } = require('events');
const config = require('./config');

/**
 * Internet connection monitor.
 *
 * Broadcasts { status } as 'offline' | 'online' | 'limited'
 * and emits 'changed' whenever it flips.
 *
 * 'limited' means DNS resolves but there is no outbound route — useful to
 * know whether the engine can crawl external pages at all.
 */

const emitter = new EventEmitter();
const state = {
  status: 'unknown',
  internet: false,
  dns: false,
  since: Date.now(),
  lastCheck: 0,
  lastError: null,
  transitions: 0,
  checks: 0
};

let timer = null;

function resolveDns() {
  return new Promise((resolve) => {
    dns.lookup('cloudflare.com', (error) => resolve(!error));
  });
}

function probeHttp() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.net.timeoutMs);

    fetch(config.net.probeUrl, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve(response.ok);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

async function check({ silent = false } = {}) {
  const dnsOk = await resolveDns();
  const httpOk = dnsOk ? await probeHttp() : false;

  const next = httpOk ? 'online' : dnsOk ? 'limited' : 'offline';
  const changed = next !== state.status;

  state.dns = dnsOk;
  state.internet = httpOk;
  state.lastCheck = Date.now();
  state.checks += 1;

  if (changed) {
    state.status = next;
    state.since = Date.now();
    state.transitions += 1;
    if (!silent) {
      console.log(`[net] connection -> ${next}`);
      emitter.emit('changed', snapshot());
    }
  }

  return snapshot();
}

function snapshot() {
  return {
    status: state.status,
    internet: state.internet,
    dns: state.dns,
    since: new Date(state.since).toISOString(),
    sinceSeconds: Math.round((Date.now() - state.since) / 1000),
    lastCheck: state.lastCheck ? new Date(state.lastCheck).toISOString() : null,
    lastError: state.lastError,
    transitions: state.transitions,
    checks: state.checks,
    note: state.status === 'limited'
      ? 'DNS works but there is no outbound HTTP path — external crawling cannot function.'
      : state.status === 'offline'
        ? 'No internet. Search and the brain keep working for documents already indexed.'
        : 'Internet available. External search and crawling are available.'
  };
}

function start() {
  if (timer) return;
  check({ silent: true });
  timer = setInterval(() => check().catch(() => {}), config.net.checkIntervalMs);
  timer.unref?.();
  console.log(`[net] monitor active (every ${Math.round(config.net.checkIntervalMs / 1000)}s)`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function onChange(handler) {
  emitter.on('changed', handler);
  return () => emitter.off('changed', handler);
}

module.exports = { start, stop, check, snapshot, onChange };