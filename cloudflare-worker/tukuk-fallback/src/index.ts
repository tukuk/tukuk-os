import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

const ORIGIN = 'https://tukuk.org';

// Paths that must keep talking to the origin on whichever host they arrived at. A
// redirect cannot answer an API call, and a POST that received a 301 would arrive at
// the apex as a GET — so these are proxied even on the mirror hostname.
const API_PATHS = new Set(['/search', '/websearch', '/suggest', '/images', '/videos', '/health', '/stats']);
const isApiRequest = (path: string): boolean => path.startsWith('/api/') || API_PATHS.has(path);

type Outcome = 'origin_ok' | 'www_redirect' | 'origin_error' | 'fallback_served' | 'static_miss' | 'api_unavailable';

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
	const secret: string | undefined = (env as Record<string, any>).UPLOAD_SECRET;
	if (!secret || token !== secret) return new Response('forbidden', { status: 403 });
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
		// This worker is routed on www.tukuk.org — the mirror hostname. The app tries to
		// 301 www → apex itself (src/server.js), but the request below is rebuilt against
		// ORIGIN, so the origin only ever sees Host: tukuk.org and that check cannot fire.
		// The edge is the last place that still knows the visitor used www.
		const isMirrorHost = url.hostname.toLowerCase().startsWith('www.');
		const canRedirect = isMirrorHost && !isApiRequest(path) && (request.method === 'GET' || request.method === 'HEAD');

		// Try to proxy to main server first
		try {
			const originUrl = new URL(ORIGIN + path + url.search);
			// new Request(originUrl, request) forwards the method, body, and all
			// original headers (including Cookie, Authorization, Content-Type).
			// `redirect: 'manual'` so 3xx responses are not followed automatically.
			const originResponse = await fetch(new Request(originUrl, request, { redirect: 'manual' }));

			// Forward ANY response below 500 (including 3xx redirects).
			// Return the original response — all headers (Set-Cookie, Location, etc.)
			// are passed straight to the browser without filtering.
			// Only fall back to R2 if the origin returns a 5xx or
			// the fetch fails entirely (network down).
			if (originResponse.status < 500) {
				// The origin is healthy, so one hostname can be enforced: send the visitor to
				// the apex instead of serving the same page twice. Deliberately AFTER the
				// health check — a 301 while the origin is down would follow the visitor
				// straight into the outage, and the mirror exists for exactly that moment.
				if (canRedirect) {
					track(env, 'www_redirect', request.method, path, 301);
					return new Response(null, {
						status: 301,
						headers: {
							Location: ORIGIN + path + url.search,
							'Cache-Control': 'public, max-age=300',
						},
					});
				}
				track(env, 'origin_ok', request.method, path, originResponse.status);
				return originResponse;
			}
			// 5xx: origin in trouble — fall through to the fallback below
			track(env, 'origin_error', request.method, path, originResponse.status);
		} catch (e) {
			// Server down / unreachable — fall through to static fallback
			track(env, 'origin_error', request.method, path);
		}

		// Fallback: serve static from R2
		if (isApiRequest(path)) {
			track(env, 'api_unavailable', request.method, path, 503);
			return new Response('API unavailable — server offline', { status: 503 });
		}

		try {
			const object = await env.FALLBACK_BUCKET.get(path === '/' ? 'index.html' : path);
			if (object) {
				track(env, 'fallback_served', request.method, path, 200);
				return new Response(object.body, {
					headers: {
						'Content-Type': object.httpMetadata?.contentType || 'text/html',
						'Cache-Control': 'public, max-age=300',
					},
				});
			}
		} catch (e) {
			// fall through
		}

		track(env, 'static_miss', request.method, path, 503);
		return new Response('Offline — static fallback not available', { status: 503 });
	},
} satisfies ExportedHandler<Env>;
