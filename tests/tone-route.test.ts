import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

test("actual tone handler makes one bounded call and safely handles provider failures", async (t) => {
	const previousKey = process.env.GEMINI_API_KEY;
	process.env.GEMINI_API_KEY = "offline-test-key";
	const server = await createServer({
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false },
		appType: "custom",
	});
	t.after(async () => {
		await server.close();
		if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
		else process.env.GEMINI_API_KEY = previousKey;
	});
	const handler: unknown = (
		await server.ssrLoadModule("/src/routes/api/ai-palette/+server.ts")
	).POST;
	assert.ok(typeof handler === "function");
	let upstreamStatus = 200;
	let upstreamBody: unknown = {};
	let calls = 0;
	let providerThrows = false;
	t.mock.method(
		globalThis,
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			calls++;
			assert.equal(
				String(input),
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
			);
			assert.equal(
				new Headers(init?.headers).get("x-goog-api-key"),
				"offline-test-key",
			);
			assert.ok(init?.signal);
			if (providerThrows) throw new Error("private-provider-error-sentinel");
			return Response.json(upstreamBody, { status: upstreamStatus });
		},
	);
	let client = 0;
	const post = async (count = 5) => {
		const request = new Request(
			`http://localhost/api/ai-palette?count=${count}`,
			{
				method: "POST",
				headers: { "Content-Type": "image/jpeg" },
				body: new Uint8Array([255, 216, 255, 217]),
			},
		);
		const response: unknown = await handler({
			request,
			url: new URL(request.url),
			getClientAddress: () => `test-client-${client++}`,
		});
		assert.ok(response instanceof Response);
		return response;
	};
	assert.equal((await post(99)).status, 400);
	assert.equal(calls, 0);
	upstreamBody = {
		candidates: [
			{
				content: {
					parts: [
						{
							text: JSON.stringify({
								description: "Test",
								colors: [{ hex: "invalid" }],
							}),
						},
					],
				},
			},
		],
	};
	assert.equal((await post()).status, 502);
	assert.equal(calls, 1);
	upstreamStatus = 429;
	const limited = await post();
	assert.equal(limited.status, 429);
	assert.equal(limited.headers.get("retry-after"), "60");
	assert.equal(calls, 2, "no automatic retries");
	upstreamStatus = 403;
	upstreamBody = { error: "private-provider-error-sentinel" };
	const denied = await post();
	assert.equal(denied.status, 502);
	assert.ok(!(await denied.text()).includes("private-provider-error-sentinel"));
	providerThrows = true;
	const unavailable = await post();
	assert.equal(unavailable.status, 502);
	assert.ok(
		!(await unavailable.text()).includes("private-provider-error-sentinel"),
	);
	providerThrows = false;
	upstreamStatus = 200;
	upstreamBody = {
		candidates: [
			{
				content: {
					parts: [
						{
							text: JSON.stringify({
								description: "A quiet atmosphere.",
								colors: Array.from({ length: 5 }, () => ({
									hex: "#123456",
									name: "Quiet blue",
								})),
							}),
						},
					],
				},
			},
		],
	};
	const result = await post();
	assert.equal(result.status, 200);
	assert.equal((await result.json()).colors.length, 5);
	assert.equal(calls, 5);
});
