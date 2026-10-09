// tukuk-www-worker — www.tukuk.org sentiasa hidup, sama seperti tukuk.org.
// 1. Origin hidup → proxy SEMUA permintaan ke tukuk.org (tunnel). www identik.
// 2. Origin mati/5xx → mod sandaran:
//    a. /search & /suggest → enjin carian mini dalam worker, skor snapshot
//       indeks dari R2 (search-index.json) — bentuk JSON sama seperti API asli,
//       jadi UI laman depan terus berfungsi tanpa pelayan.
//    b. Halaman statik → snapshot HTML/assets dari R2.
//    c. Snapshot pun takde → halaman penyelenggaraan.

const INDEX_TTL_MS = 10 * 60 * 1000; // indeks dikitar semula dalam isolate setiap 10 min
let idxCache = { at: 0, docs: null, loading: null };

function maintenancePage() {
  return new Response(
    "<!DOCTYPE html><html><head><title>Tukuk - Penyelenggaraan</title></head><body style='font-family:sans-serif;text-align:center;padding:50px;'><h1>Sistem Sedang Diselenggara</h1><p>Maaf, pelayan utama kami sedang mengalami gangguan sementara atau dalam penyelenggaraan. Sila cuba sebentar lagi.</p></body></html>",
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
      console.error("loadDocs gagal:", err?.message);
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

// /search?q=... — respons sama rupa seperti API Meilisearch asal
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

// /suggest?q=... — aut lengkap seperti asal {suggestions:[{title,url}]}
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

// Titik API lain — pulang kosong yang selamat supaya UI tidak rosak
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
    if (!/\.[a-z0-9]+$/i.test(clean)) keys.push(`${clean}/index.html`);
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
      console.error("R2 get gagal", key, err?.message);
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
  if (pathname.startsWith("/api/")) return json({ error: "Server offline (mod sandaran)" }, 503);
  return maintenancePage();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    url.hostname = "tukuk.org";

    try {
      const response = await fetch(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
        redirect: "follow"
      });

      // Jika pelayan membalas 5xx → masuk mod sandaran sepenuhnya
      if (response.status >= 500) throw new Error("Server error");

      return response;
    } catch (err) {
      return handleBackupMode(request, env, pathname);
    }
  },
};
