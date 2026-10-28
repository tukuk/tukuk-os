import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	fetchMock,
} from "cloudflare:test";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import worker from "../src";

// The failover brain. Every test drives a real scenario end to end:
//   origin healthy            → origin passthrough
//   origin 5xx / throws       → GCP mirror
//   mirror also misses        → cold R2 snapshot
//   both miss and R2 empty    → 503
//   API call during outage    → 503 (never a static page)
// plus the authenticated /edge-backup gateway (write secret vs read-only secret).
//
// ORIGIN/MIRROR_URL are pointed at inert *.test hosts and intercepted with undici's
// MockAgent, so nothing touches the network. disableNetConnect() makes any request we
// did NOT stage throw - which is also how we simulate the origin fetch failing outright
// (connector down / box offline), and it doubles as an assertion that the ladder never
// reaches a host it should not have.
const ORIGIN = "https://origin.test";
const MIRROR = "https://mirror.test";

function testEnv(extra: Record<string, unknown> = {}): any {
	// env from cloudflare:test already carries the R2/D1/AnalyticsEngine bindings;
	// spread them and layer the brain's own vars + secrets on top.
	return { ...env, ORIGIN, MIRROR_URL: MIRROR, UPLOAD_SECRET: "write-secret", MIRROR_READ_TOKEN: "read-secret", ...extra };
}

async function run(path: string, init: RequestInit = {}, e: any = testEnv()) {
	const request = new Request(`https://worker.tukuk.org${path}`, init as any);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, e, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

beforeEach(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	// Every staged interceptor must have been consumed - this proves the worker fetched
	// exactly the hosts the ladder says it should, and no more.
	fetchMock.assertNoPendingInterceptors();
});

describe("failover brain - origin ladder", () => {
	it("passes a healthy origin straight through (no mirror, no R2)", async () => {
		fetchMock
			.get(ORIGIN)
			.intercept({ path: "/", method: "GET" })
			.reply(200, "LIVE FROM BOX");

		const res = await run("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("LIVE FROM BOX");
	});

	it("degrades to the GCP mirror when the origin returns 5xx", async () => {
		fetchMock.get(ORIGIN).intercept({ path: "/", method: "GET" }).reply(502, "bad gateway");
		fetchMock.get(MIRROR).intercept({ path: "/", method: "GET" }).reply(200, "MIRROR PAGE");

		const res = await run("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("MIRROR PAGE");
	});

	it("degrades to the GCP mirror when the origin fetch throws (box/tunnel down)", async () => {
		fetchMock
			.get(ORIGIN)
			.intercept({ path: "/about", method: "GET" })
			.replyWithError(new Error("socket hang up - connector offline"));
		fetchMock.get(MIRROR).intercept({ path: "/about", method: "GET" }).reply(200, "MIRROR ABOUT");

		const res = await run("/about");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("MIRROR ABOUT");
	});

	it("falls through a mirror miss to the cold R2 snapshot", async () => {
		// origin down, mirror 404s the page (not <400), so the R2 copy wins.
		fetchMock.get(ORIGIN).intercept({ path: "/", method: "GET" }).reply(500, "boom");
		fetchMock.get(MIRROR).intercept({ path: "/", method: "GET" }).reply(404, "not mirrored");
		await env.FALLBACK_BUCKET.put("index.html", "R2 HOME", {
			httpMetadata: { contentType: "text/html" },
		});

		const res = await run("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("R2 HOME");
	});

	it("serves a deep link from the snapshot's file key, not its URL path", async () => {
		// snapshot-r2.sh writes about.html for /about, so a lookup by path alone 503s a
		// blackout on every page except the home page.
		fetchMock.get(ORIGIN).intercept({ path: "/about", method: "GET" }).reply(500, "boom");
		fetchMock.get(MIRROR).intercept({ path: "/about", method: "GET" }).reply(404, "not mirrored");
		await env.FALLBACK_BUCKET.put("about.html", "R2 ABOUT", {
			httpMetadata: { contentType: "text/html" },
		});

		const res = await run("/about");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("R2 ABOUT");
	});

	it("serves a nested page from its index.html key", async () => {
		fetchMock.get(ORIGIN).intercept({ path: "/learn", method: "GET" }).reply(500, "boom");
		fetchMock.get(MIRROR).intercept({ path: "/learn", method: "GET" }).reply(404, "not mirrored");
		await env.FALLBACK_BUCKET.put("learn/index.html", "R2 LEARN", {
			httpMetadata: { contentType: "text/html" },
		});

		const res = await run("/learn");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("R2 LEARN");
	});

	it("returns 503 when origin, mirror and R2 all miss", async () => {
		fetchMock.get(ORIGIN).intercept({ path: "/gone", method: "GET" }).reply(500, "boom");
		fetchMock.get(MIRROR).intercept({ path: "/gone", method: "GET" }).reply(404, "nope");
		// nothing seeded for /gone under any of its snapshot keys

		const res = await run("/gone");
		expect(res.status).toBe(503);
		expect(await res.text()).toMatch(/Offline/);
	});
});

describe("failover brain - API and mutation policy", () => {
	it("answers an API call with 503 during an outage - never a static page", async () => {
		// /health is in API_PATHS. Only the origin is fetched; the mirror and R2 must NOT
		// be, so we stage no interceptors for them (disableNetConnect would throw if we did).
		fetchMock.get(ORIGIN).intercept({ path: "/health", method: "GET" }).reply(500, "down");

		const res = await run("/health");
		expect(res.status).toBe(503);
		expect(await res.text()).toMatch(/API unavailable/);
	});

	it("answers a POST mutation with 503 when the origin is down", async () => {
		// A static mirror cannot replay a write; the ladder must refuse rather than GET the
		// page back from the mirror. Origin fetch is attempted (with the POST) then refused.
		fetchMock
			.get(ORIGIN)
			.intercept({ path: "/contact", method: "POST" })
			.replyWithError(new Error("origin offline"));

		const res = await run("/contact", { method: "POST", body: "hi" });
		expect(res.status).toBe(503);
	});
});

describe("edge-backup gateway - two-tier auth", () => {
	it("accepts a GET with the read-only token and returns the stored object", async () => {
		await env.FALLBACK_BUCKET.put("snapshot.txt", "COLD COPY", {
			httpMetadata: { contentType: "text/plain" },
		});
		const res = await run("/edge-backup?key=snapshot.txt", {
			method: "GET",
			headers: { authorization: "Bearer read-secret" },
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("COLD COPY");
	});

	it("refuses a POST from the read-only token (403) - it may read but never write", async () => {
		const res = await run("/edge-backup?key=poison", {
			method: "POST",
			body: "malicious archive",
			headers: { authorization: "Bearer read-secret" },
		});
		expect(res.status).toBe(403);
	});

	it("refuses any token that is neither the write nor the read secret (403)", async () => {
		const res = await run("/edge-backup?key=whatever", {
			method: "GET",
			headers: { authorization: "Bearer not-a-real-secret" },
		});
		expect(res.status).toBe(403);
	});

	it("accepts a POST from the write secret and persists it", async () => {
		const res = await run("/edge-backup?key=chat.json", {
			method: "POST",
			body: "{}",
			headers: {
				authorization: "Bearer write-secret",
				"x-content-type": "application/json",
			},
		});
		expect(res.status).toBe(200);
		const stored = await env.FALLBACK_BUCKET.get("chat.json");
		expect(await stored!.text()).toBe("{}");
	});
});
