import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { createServer } from "vite";

test("real palette routes enforce validation and redact database failures", async (t) => {
	const cacheDir = await mkdtemp(join(tmpdir(), "chroma-route-test-"));
	const previousUrl = process.env.DATABASE_URL;
	const previousFetch = neonConfig.fetchFunction;
	process.env.DATABASE_URL = "postgresql://test:test@localhost:1/test";
	let databaseCalls = 0;
	let failDatabase = false;
	neonConfig.fetchFunction = async () => {
		databaseCalls++;
		if (failDatabase) throw new Error("private-database-error-sentinel");
		return Response.json({ fields: [], rows: [], rowCount: 1 });
	};
	const server = await createServer({
		cacheDir,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", port: 0, hmr: false },
	});
	t.after(async () => {
		await server.close();
		neonConfig.fetchFunction = previousFetch;
		if (previousUrl === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = previousUrl;
		await rm(cacheDir, { recursive: true, force: true });
	});
	await server.listen();
	const address = server.httpServer?.address();
	assert.ok(address && typeof address !== "string");
	const origin = `http://127.0.0.1:${address.port}`;
	t.diagnostic(
		`Isolated route server PID ${process.pid}, port ${address.port}; database transport stubbed`,
	);
	const body = {
		artworkId: 27992,
		mode: "dominant",
		count: 5,
		colors: Array.from({ length: 5 }, () => ({
			hex: "#123456",
			rgb: { r: 18, g: 52, b: 86 },
			hsl: { h: 210, s: 65, l: 20 },
		})),
	};
	const post = (value: string, headers = {}) =>
		fetch(`${origin}/api/palette`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: value,
		});
	for (const [value, headers, status] of [
		["null", {}, 400],
		[
			JSON.stringify({ ...body, colors: [], mode: "invalid", count: 99 }),
			{},
			400,
		],
		[" ".repeat(16 * 1024 + 1), {}, 413],
		[JSON.stringify(body), { origin: "https://other.test" }, 403],
		[JSON.stringify(body), { "content-type": "text/plain" }, 415],
	] as const)
		assert.equal((await post(value, headers)).status, status);
	assert.equal(databaseCalls, 0);
	const saved = await post(JSON.stringify(body));
	assert.equal(saved.status, 201);
	const result = await saved.json();
	assert.match(result.id, /^[0-9a-f-]{36}$/);
	assert.equal(result.url, `${origin}/palette/${result.id}`);
	assert.equal(databaseCalls, 1);
	failDatabase = true;
	const failedSave = await post(JSON.stringify(body));
	assert.equal(failedSave.status, 503);
	assert.equal(failedSave.headers.get("retry-after"), "30");
	const failure = await failedSave.text();
	assert.match(failure, /temporarily unavailable/);
	assert.ok(!failure.includes("private-database-error-sentinel"));
	const failedLoad = await fetch(
		`${origin}/palette/00000000-0000-4000-8000-000000000000`,
	);
	assert.equal(failedLoad.status, 503);
	const page = await failedLoad.text();
	assert.match(page, /Saved palettes are temporarily unavailable/);
	assert.ok(!page.includes("private-database-error-sentinel"));
	const calls = databaseCalls;
	assert.equal((await fetch(`${origin}/palette/not-a-uuid`)).status, 404);
	assert.equal(databaseCalls, calls);
	for (let i = 0; i < 3; i++) assert.equal((await post("null")).status, 400);
	const throttled = await post(JSON.stringify(body));
	assert.equal(throttled.status, 429);
	assert.ok(Number(throttled.headers.get("retry-after")) > 0);
	assert.equal(databaseCalls, calls);
});
