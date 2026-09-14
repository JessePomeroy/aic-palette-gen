import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../workers/color-index/index.mjs";

test("index delivery is read-only, range-bounded, cache-separated and limited to release assets", async (t) => {
	const cache = new Map<string, Response>(),
		reads: string[] = [],
		pending: Promise<unknown>[] = [];
	const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
	t.after(() => {
		if (originalCaches)
			Object.defineProperty(globalThis, "caches", originalCaches);
		else Reflect.deleteProperty(globalThis, "caches");
	});
	Object.defineProperty(globalThis, "caches", {
		configurable: true,
		value: {
			open: async () => ({
				match: async (key: Request) => cache.get(key.url)?.clone(),
				put: async (key: Request, value: Response) => {
					cache.set(
						key.url,
						new Response(await value.arrayBuffer(), { headers: value.headers }),
					);
				},
			}),
		},
	});
	const env = {
		INDEX_BUCKET: {
			get: async (
				key: string,
				options?: { range: { offset: number; length: number } },
			) => {
				reads.push(key);
				if (key.includes("missing")) return null;
				const data = new TextEncoder().encode("0123456789");
				const range = options?.range;
				const bytes = range
					? data.slice(range.offset, range.offset + range.length)
					: data;
				return {
					size: data.length,
					httpEtag: '"fixture"',
					body: new Blob([bytes]).stream(),
				};
			},
		},
	};
	const context = {
		waitUntil: (promise: Promise<unknown>) => pending.push(promise),
	};
	const get = (path: string, init?: RequestInit) =>
		worker.fetch(new Request(`https://index.test${path}`, init), env, context);
	for (const [path, init, status] of [
		["/private/original.jpg", undefined, 404],
		["/v3/release/manifest.json?url=private", undefined, 404],
		["/v3/release/manifest.json", { method: "PUT", body: "no" }, 405],
		["/v3/release/samples/0.pack", undefined, 416],
		[
			"/v3/release/samples/0.pack",
			{ headers: { Range: "bytes=0-9999999" } },
			416,
		],
	] as const)
		assert.equal((await get(path, init)).status, status);
	assert.equal(reads.length, 0);
	const first = await get("/v3/release/samples/0.pack", {
		headers: { Range: "bytes=2-4" },
	});
	assert.equal(first.status, 206);
	assert.equal(first.headers.get("content-range"), "bytes 2-4/10");
	assert.equal(first.headers.get("access-control-allow-origin"), "*");
	assert.equal(await first.text(), "234");
	await Promise.all(pending);
	const cached = await get("/v3/release/samples/0.pack", {
		headers: { Range: "bytes=2-4" },
	});
	assert.equal(cached.headers.get("x-index-cache"), "HIT");
	assert.equal(await cached.text(), "234");
	const other = await get("/v3/release/samples/0.pack", {
		headers: { Range: "bytes=5-7" },
	});
	assert.equal(await other.text(), "567");
	assert.equal(reads.length, 2);
	assert.equal(
		(
			await get("/v3/release/samples/0.pack", {
				headers: { Range: "bytes=9-12" },
			})
		).status,
		416,
	);
	assert.equal((await get("/v3/missing/manifest.json")).status, 404);
	assert.equal(
		(await get("/v3/release/manifest.json", { method: "OPTIONS" })).status,
		204,
	);
	await Promise.all(pending);
});
