import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

const ORIGIN = 'https://tukuk.org';

type Outcome = 'origin_ok' | 'origin_error' | 'fallback_served' | 'static_miss' | 'api_unavailable';

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
		if (path.startsWith('/api/') || path === '/search' || path === '/websearch' || path === '/suggest' || path === '/images' || path === '/videos' || path === '/health' || path === '/stats') {
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
