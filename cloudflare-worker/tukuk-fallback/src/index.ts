import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

const ORIGIN = 'https://tukuk.org';

// Paths that must keep talking to the origin on whichever host they arrived at. A
// redirect cannot answer an API call, and a POST that received a 301 would arrive at
// the apex as a GET — so these are proxied even on the mirror hostname.
const API_PATHS = new Set(['/search', '/websearch', '/suggest', '/images', '/videos', '/health', '/stats']);
const isApiRequest = (path: string): boolean => path.startsWith('/api/') || API_PATHS.has(path);

type Outcome = 'origin_ok' | 'www_redirect' | 'origin_error' | 'fallback_served' | 'static_miss' | 'api_unavailable';

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
