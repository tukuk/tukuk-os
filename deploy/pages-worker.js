// _worker.js — Pages Worker for the tukuk-mirror project (www.tukuk.org).
//
// The story: www became a static Pages mirror (4 Nov 2026) and stayed a
// mirror even with the main server wide awake — correct, but not what was
// asked for: "bila server tukuk.org hidup www.tukuk.org bukan sekadar
// mirror tapi boleh hidup juga; bila down baru mirror betul-betul menjadi
// mirror." Pages Functions are the place to fix this without any Zone
// Workers permission: this file runs in front of EVERY request to the
// project's domains, with the snapshot itself bound as env.ASSETS.
//
// Flow per request:
//   1. fetch https://tukuk.org<path> — the apex, proxied record → tunnel →
//      nginx → Node. Not the www hostname, so this cannot re-enter Pages;
//      Host is the apex, so the app's www→apex 301 middleware never fires
//      and the nginx vhost/cache key stay normal.
//   2. status >= 500 (dead box = the edge answers 530) or > 6s abort
//      (wedged tunnel hangs) → serve the snapshot from ASSETS, which keeps
//      Pages' own rules: /alat/unit → alat/unit.html, 404.html for unknown
//      paths, _headers (X-Robots-Tag: noindex, follow).
//   3. Both fail — rare, but say so plainly rather than blame Pages.
//
// So www is now the live site whenever the live site exists, and a genuine
// offline mirror only in the minutes when it does not. Staleness costs
// freshness, never availability.

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const apex = 'https://tukuk.org' + incoming.pathname + incoming.search;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const live = await fetch(new Request(apex, request), { signal: controller.signal });
      clearTimeout(timer);
      if (live.status < 500) return live;
    } catch {
      clearTimeout(timer);
    }

    // Same method + headers onto the snapshot: GETs read files; a POST that
    // arrives during an outage hits the static tool page it came from,
    // which is exactly what the form sits on.
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>tukuk.org unavailable</title>' +
        '<body style="font-family:system-ui;background:#10131a;color:#e6e9ef;text-align:center;padding-top:15vh">' +
        '<h1>Both servers are resting</h1><p>tukuk.org and its mirror were unreachable at the same moment. Try again shortly.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60' } }
      );
    }
  },
};
