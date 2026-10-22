// tukuk-www-worker — tukuk.org AND www.tukuk.org stay alive.
// 1. Origin alive → proxy to the tunnel. (A Worker's fetch() to a hostname in the same
//    zone goes STRAIGHT to the origin, it does not re-enter the Worker route — so no loop.)
// 2. Origin down/5xx → backup mode from an R2 snapshot:
//    a. /search & /suggest → a mini search engine inside the worker, scoring the index
//       snapshot from R2 (search-index.json) — the JSON shape matches the real API.
//    b. Static pages → HTML/asset snapshots from R2.
//    c. No snapshot either → the maintenance page.

const INDEX_TTL_MS = 10 * 60 * 1000; // the index is recycled inside the isolate every 10 min
let idxCache = { at: 0, docs: null, loading: null };

function maintenancePage() {
  return new Response(
    "<!DOCTYPE html><html><head><title>Tukuk - Maintenance</title></head><body style='font-family:sans-serif;text-align:center;padding:50px;'><h1>The system is under maintenance</h1><p>Sorry, our main server is having a temporary problem or is being maintained. Please try again in a moment.</p></body></html>",
    { status: 503, headers: { "Content-Type": "text/html;charset=UTF-8" } }
  );
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Cache-Control": "public, max-age=60",
      "X-Tukuk-Mode": "backup"
    }
  });
}

async function loadDocs(env) {
  if (!env.BACKUP) return [];
  if (idxCache.docs && Date.now() - idxCache.at < INDEX_TTL_MS) return idxCache.docs;
  if (!idxCache.loading) {
    idxCache.loading = (async () => {
      const obj = await env.BACKUP.get("search-index.json");
      const docs = obj ? JSON.parse(await obj.text()) : [];
      idxCache = { at: Date.now(), docs, loading: null };
      return docs;
    })().catch((err) => {
      idxCache = { at: 0, docs: null, loading: null };
      console.error("loadDocs failed:", err?.message);
      return [];
    });
  }
  return idxCache.loading;
}

function tokenize(q) {
  return String(q).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function scoreDoc(doc, tokens, phrase) {
  const title = String(doc.title || "").toLowerCase();
  const desc = String(doc.description || "").toLowerCase();
  const body = String(doc.content || "").toLowerCase();
  let s = title.includes(phrase) ? 12 : 0;
  for (const t of tokens) {
    if (title.includes(t)) s += 5;
    if (desc.includes(t)) s += 2;
    if (body.includes(t)) s += 1;
  }
  return s;
}

// /search?q=... — a response with exactly the shape of the original Meilisearch API
// (`index: "halaman_web"` is that live index name, not copy — do not translate it)
async function backupSearch(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, parseInt(url.searchParams.get("limit"), 10) || 20);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
  if (!q) return json({ query: "", hits: [], total: 0, index: "halaman_web" });

  const docs = await loadDocs(env);
  const tokens = tokenize(q);
  const phrase = q.toLowerCase();
  const scored = [];
  for (const d of docs) {
    const s = scoreDoc(d, tokens, phrase);
    if (s > 0) scored.push([s, d]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const hits = scored.slice(offset, offset + limit).map(([, d]) => d);

  return json({
    query: q,
    index: "halaman_web",
    hits,
    estimatedTotalHits: scored.length,
    totalHits: scored.length,
    offset,
    limit,
    processingTimeMs: 1,
    related: [],
    didYouMean: null
  });
}

// /suggest?q=... — the full original shape: {suggestions:[{title,url}]}
async function backupSuggest(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ suggestions: [] });
  const docs = await loadDocs(env);
  const ql = q.toLowerCase();
  const suggestions = [];
  for (const d of docs) {
    if (String(d.title || "").toLowerCase().includes(ql)) {
      suggestions.push({ title: d.title, url: d.url || "" });
      if (suggestions.length >= 6) break;
    }
  }
  return json({ suggestions });
}

// The other API endpoints — safe empty payloads so the UI does not break
const EMPTY_JSON = {
  "/trending": { queries: [], windowDays: 7 },
  "/websearch": { hits: [], provider: "backup" },
  "/answer": {},
  "/images": { hits: [] },
  "/videos": { hits: [] },
  "/news": { hits: [] },
  "/music": { results: [] },
  "/radio": { results: [] },
  "/health": { status: "backup-mode" },
  "/stats": { documents: 0, backup: true }
};

async function serveStatic(pathname, env) {
  const clean = pathname.replace(/^\/+/, "");
  const keys = [];
  if (!clean) keys.push("index.html");
  else {
    keys.push(clean);
    // Pages are stored as <name>.html (example: /about → about.html)
    if (!/\.[a-z0-9]+$/i.test(clean)) {
      keys.push(`${clean}.html`);
      keys.push(`${clean}/index.html`);
    }
  }
  for (const key of keys) {
    try {
      const object = await env.BACKUP.get(key);
      if (object) {
        return new Response(object.body, {
          status: 200,
          headers: {
            "Content-Type": object.httpMetadata?.contentType ||
              (key.endsWith(".html") || !key.includes(".") ? "text/html;charset=UTF-8" : "application/octet-stream"),
            "Cache-Control": "public, max-age=300",
            "X-Tukuk-Mode": "backup"
          }
        });
      }
    } catch (err) {
      console.error("R2 get failed", key, err?.message);
    }
  }
  return null;
}

async function handleBackupMode(request, env, pathname) {
  if (request.method === "GET" || request.method === "HEAD") {
    if (pathname === "/search") return backupSearch(request, env);
    if (pathname === "/suggest") return backupSuggest(request, env);
    if (Object.prototype.hasOwnProperty.call(EMPTY_JSON, pathname)) return json(EMPTY_JSON[pathname]);
    const page = await serveStatic(pathname, env);
    if (page) return page;
  }
  if (pathname.startsWith("/api/")) return json({ error: "Server offline (backup mode)" }, 503);
  return maintenancePage();
}

// Analytics Engine — write one telemetry line. Fails quietly (never block the response).
function logEvent(env, e) {
  if (!env || !env.TUKUK_ENGINE) return;
  try {
    env.TUKUK_ENGINE.writeDataPoint({
      indexes: [String(e.hostname || "")],
      blobs: [String(e.method || ""), String(e.pathname || ""), String(e.q || ""), String(e.mode || "")],
      doubles: [Number(e.status) || 0]
    });
  } catch (err) {
    console.error("logEvent failed:", err && err.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const host = url.hostname; // the original host: tukuk.org / www.tukuk.org
    const q = (url.searchParams.get("q") || "").slice(0, 200);
    url.hostname = "tukuk.org";

    try {
      const response = await fetch(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
        // redirect: 'manual' so the 3xx code-server responses (login redirect + Set-Cookie)
        // are handed back to the browser. With 'follow' the Worker chases them itself and
        // drops Set-Cookie/Location — the browser never gets a session token.
        redirect: "manual"
      });

      // If the server answers 5xx → go into full backup mode
      if (response.status >= 500) throw new Error("Server error");

      ctx.waitUntil(Promise.resolve().then(() =>
        logEvent(env, { hostname: host, method: request.method, pathname, q, mode: "proxy", status: response.status })
      ));
      return response;
    } catch (err) {
      const resp = await handleBackupMode(request, env, pathname);
      ctx.waitUntil(Promise.resolve().then(() =>
        logEvent(env, { hostname: host, method: request.method, pathname, q, mode: "backup", status: resp.status })
      ));
      return resp;
    }
  },
};
