// Tukuk-OS failover brain. Routed on worker.tukuk.org: it proxies every request to the
// live origin (the home box, through its Cloudflare Tunnel). When the origin answers 5xx,
// or the fetch itself throws — a blackout, a dropped connector, a deploy that stopped the
// app — it degrades along a ladder instead of dying: first the independent GCP mirror
// (www.tukuk.org, its own tunnel on a separate machine), then the cold R2 static snapshot,
// and only if both miss does it 503. ORIGIN/MIRROR_URL come from env so one build is safe
// before and after the route move.
const DEFAULT_ORIGIN = 'https://tukuk.org';
const DEFAULT_MIRROR = 'https://www.tukuk.org';

// Paths that must keep talking to the origin on whichever host they arrived at. A
// redirect cannot answer an API call, and a POST that received a 301 would arrive at
// the apex as a GET — so these are proxied even on the mirror hostname.
const API_PATHS = new Set(['/search', '/websearch', '/suggest', '/images', '/videos', '/health', '/stats']);
const isApiRequest = (path: string): boolean => path.startsWith('/api/') || API_PATHS.has(path);

// snapshot-r2.sh stores pages under their file key (index.html, about.html,
// learn/index.html, theme.css) — never under the request path. Map a URL path onto the
// shapes that snapshot actually writes, in the order most likely to hit.
function snapshotKeys(path: string): string[] {
	const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
	if (clean === '') return ['index.html'];
	if (clean.split('/').some((part) => part === '..')) return [];
	return [`${clean}.html`, `${clean}/index.html`, clean];
}

// 'www_redirect' is gone: the brain lives on worker.tukuk.org now, so visitors who reach
// it are here precisely because the primary is suspect — bouncing them to the apex would
// defeat the whole point. 'mirror_served' marks a hit off the independent GCP origin.
type Outcome =
	| 'origin_ok'
	| 'origin_error'
	| 'mirror_served'
	| 'fallback_served'
	| 'static_miss'
	| 'api_unavailable';

// ---- authenticated R2 gateway (tukuk-backup's role, moved onto our own zone) ----
// The VPS Cloudflare token has no R2 scope, so its backup timers POST archives to a
// Worker holding the bucket binding. The tukuk-backup worker's *.workers.dev hostname
// is platform-throttled with HTTP 429 (shared edge), which silently killed every
// backup for a week; this hostname (www.tukuk.org) is on our own zone and not
// throttled. Same contract as tukuk-backup: Bearer UPLOAD_SECRET, POST ?key= put,
// GET ?key= fetch (or ?prefix= list), DELETE ?key= remove, 90 MB cap on declared
// AND actual bytes. Must be intercepted BEFORE origin proxying — the origin would
// just 404 it. Keys land in the same tukuk-fallback bucket the mirror reads from.
const MAX_BYTES = 90 * 1024 * 1024;

async function backupGateway(request: Request, env: any, url: URL): Promise<Response> {
	const header = request.headers.get('authorization') || '';
	const token = header.replace(/^Bearer\s+/i, '');
	// Two secrets. UPLOAD_SECRET writes (POST/DELETE); MIRROR_READ_TOKEN may only read
	// (GET/list). The GCP mirror VM polls the snapshot out of the bucket through this
	// gateway, so it needs GET but must NOT be able to overwrite a backup — a stolen VM
	// key can then only read already-public pages, never poison the archive.
	const writeSecret: string | undefined = (env as Record<string, any>).UPLOAD_SECRET;
	const readSecret: string | undefined = (env as Record<string, any>).MIRROR_READ_TOKEN;
	const isWrite = Boolean(writeSecret) && token === writeSecret;
	const isRead = Boolean(readSecret) && token === readSecret && request.method === 'GET';
	if (!isWrite && !isRead) return new Response('forbidden', { status: 403 });
	const bucket = (env as Record<string, any>).FALLBACK_BUCKET;

	if (request.method === 'POST') {
		const declared = Number(request.headers.get('content-length') || 0);
		if (declared > MAX_BYTES) return new Response('payload too large', { status: 413 });
		const body = await request.arrayBuffer();
		if (body.byteLength > MAX_BYTES) return new Response('payload too large', { status: 413 });
		const key =
			url.searchParams.get('key') ||
			request.headers.get('x-object-key') ||
			`meili-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
		const ct = request.headers.get('x-content-type') || 'application/gzip';
		await bucket.put(key, body, { httpMetadata: { contentType: ct } });
		return Response.json({ ok: true, key, bytes: body.byteLength });
	}

	if (request.method === 'GET') {
		const key = url.searchParams.get('key');
		if (!key) {
			const listed = await bucket.list({ prefix: url.searchParams.get('prefix') || '' });
			return Response.json({
				objects: listed.objects.map((o: any) => ({ key: o.key, bytes: o.size, uploaded: o.uploaded })),
			});
		}
		const object = await bucket.get(key);
		if (!object) return new Response('not found', { status: 404 });
		return new Response(object.body, {
			headers: {
				'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
				'Content-Length': String(object.size),
			},
		});
	}

	if (request.method === 'DELETE') {
		const key = url.searchParams.get('key');
		if (!key) return new Response('key required', { status: 400 });
		await bucket.delete(key);
		return Response.json({ ok: true, key });
	}

	return new Response('edge-backup gateway', { status: 405 });
}

function track(env: any, outcome: Outcome, method: string, path: string, status?: number): void {
	try {
		const engine = (env as Record<string, any>)['tukuk-os_engine'];
		engine?.writeDataPoint({
			blobs: [outcome, method, path, String(status ?? '')],
			indexes: [outcome],
		});
	} catch (e) {
		// logging must never fail the request
		console.error('writeDataPoint failed', outcome, (e as Error)?.message);
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		// Backup-timer uploads arrive here (see backupGateway) — handle at the edge,
		// before the origin proxy, so a healthy origin cannot 404 them.
		if (path === '/edge-backup' || path.startsWith('/edge-backup/')) {
			return backupGateway(request, env, url);
		}
		const ORIGIN = env.ORIGIN || DEFAULT_ORIGIN;
		const MIRROR = env.MIRROR_URL || DEFAULT_MIRROR;
		const isReadMethod = request.method === 'GET' || request.method === 'HEAD';

		// 1. Primary — proxy to the live origin (home box via its tunnel). new Request(url,
		//    request) forwards method, body and all original headers (Cookie, Authorization,
		//    Content-Type); redirect:'manual' so the origin's 3xx reach the visitor untouched.
		try {
			const originUrl = new URL(ORIGIN + path + url.search);
			const originResponse = await fetch(new Request(originUrl, request, { redirect: 'manual' }));
			// Anything below 500 is a real answer from a healthy origin — forward it whole.
			if (originResponse.status < 500) {
				track(env, 'origin_ok', request.method, path, originResponse.status);
				return originResponse;
			}
			// 5xx: origin in trouble — fall through to the ladder below
			track(env, 'origin_error', request.method, path, originResponse.status);
		} catch (e) {
			// fetch threw: connector down / box offline / DNS gone — degrade.
			track(env, 'origin_error', request.method, path);
		}

		// 2. No static answer exists for an API call or a mutation — refuse honestly rather
		//    than serving an HTML page where JSON, or the effect of a write, was expected.
		if (isApiRequest(path) || !isReadMethod) {
			track(env, 'api_unavailable', request.method, path, 503);
			return new Response('API unavailable — server offline', { status: 503 });
		}

		// 3. Ladder step one — the independent GCP mirror (own tunnel, own machine), so a
		//    home-box blackout cannot take the backup down with it. A plain GET/HEAD, no
		//    forwarded cookies: it serves static pages only. Only accept a genuine hit
		//    (<400); a mirror 404/5xx means "this page isn't mirrored", so we do NOT forward
		//    that error — we drop to the cold R2 copy instead of surfacing the mirror's miss.
		try {
			const mirrorResponse = await fetch(MIRROR + path + url.search, {
				method: request.method,
				redirect: 'manual',
			});
			if (mirrorResponse.status < 400) {
				track(env, 'mirror_served', request.method, path, mirrorResponse.status);
				return mirrorResponse;
			}
		} catch (e) {
			// mirror unreachable too — fall through to R2
		}

		// 4. Last resort — the cold R2 static snapshot the box writes every 6h. Look the
		//    page up by its snapshot key, not its URL path, or every deep link 503s.
		try {
			for (const key of snapshotKeys(path)) {
				const object = await env.FALLBACK_BUCKET.get(key);
				if (object) {
					track(env, 'fallback_served', request.method, path, 200);
					return new Response(object.body, {
						headers: {
							'Content-Type': object.httpMetadata?.contentType || 'text/html',
							'Cache-Control': 'public, max-age=300',
						},
					});
				}
			}
		} catch (e) {
			// fall through to 503
		}

		track(env, 'static_miss', request.method, path, 503);
		return new Response('Offline — static fallback not available', { status: 503 });
	},
} satisfies ExportedHandler<Env>;
