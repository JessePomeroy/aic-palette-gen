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
				match: async (key: Request) => {
					const saved = cache.get(key.url);
					return saved
						? new Response(await saved.clone().arrayBuffer(), {
								headers: saved.headers,
							})
						: undefined;
				},
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
					size: key.endsWith("report.json")
						? 17 * 1024 * 1024
						: key.endsWith("index.json") || key.includes("oversize")
							? 12 * 1024 * 1024
							: key.endsWith(`${"b".repeat(64)}.rgba`)
								? 160001
								: data.length,
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
	const legacy = "/v2/expanded-2500-20260913";
	const sample = `${legacy}/samples/${"a".repeat(64)}.rgba`;
	for (const path of [
		"/v2/unknown/index.json",
		`${legacy}/original.jpg`,
		`${legacy}/samples/not-a-hash.rgba`,
		`${legacy}/index.json?raw=1`,
	])
		assert.equal((await get(path)).status, 404);
	assert.equal((await get(sample, { method: "POST" })).status, 405);
	assert.equal(
		(await get(sample, { headers: { Range: "bytes=0-1" } })).status,
		416,
	);
	assert.equal(
		(await get(sample, { method: "OPTIONS" })).headers.get(
			"access-control-allow-origin",
		),
		"*",
	);
	const rgba = await get(sample);
	assert.equal(rgba.status, 200);
	assert.equal(rgba.headers.get("content-type"), "application/octet-stream");
	assert.match(
		rgba.headers.get("cache-control") ?? "",
		/immutable.*no-transform/,
	);
	assert.equal(await rgba.text(), "0123456789");
	await Promise.all(pending);
	const head = await get(sample, { method: "HEAD" });
	assert.equal(head.headers.get("x-index-cache"), "HIT");
	assert.equal(head.headers.get("content-length"), "10");
	assert.equal(await head.text(), "");
	// The actual legacy index is larger than v3's 8 MiB JSON limit.
	assert.equal((await get(`${legacy}/index.json`)).status, 200);
	assert.equal((await get(`${legacy}/report.json`)).status, 503);
	assert.equal(
		(await get(`${legacy}/samples/${"b".repeat(64)}.rgba`)).status,
		503,
	);
	assert.equal((await get("/v3/oversize/manifest.json")).status, 503);
	await Promise.all(pending);
});
