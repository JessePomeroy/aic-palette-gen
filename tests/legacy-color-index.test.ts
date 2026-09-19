import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
	forEachBounded,
	inventoryLegacy,
	uploadImmutable,
	verifyConditionalWrites,
} from "../scripts/legacy-color-index";
import {
	assertMigrationRequest,
	parseCurlResponse,
	SAFETY_KEY,
} from "../scripts/r2-s3";

test("upload requires S3 credentials and the retired REST credential option is rejected", () => {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", "scripts/legacy-color-index.ts", "--upload"],
		{ cwd: new URL("..", import.meta.url), encoding: "utf8" },
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /S3 operations require --credentials-file/);
	assert.equal(result.stdout, "");
	const retired = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"scripts/legacy-color-index.ts",
			"--upload",
			"--token-file",
			"/does-not-exist",
		],
		{ cwd: new URL("..", import.meta.url), encoding: "utf8" },
	);
	assert.equal(retired.status, 1);
	assert.match(retired.stderr, /Unknown option/);
});

test("preserved legacy archive has intact named samples and the audited exact size", async () => {
	const files = await inventoryLegacy();
	assert.equal(files.length, 3953);
	assert.equal(
		files.reduce((n, f) => n + f.bytes, 0),
		476497443,
	);
});

test("immutable uploader verifies identical objects and never overwrites conflicts", async () => {
	const bytes = new TextEncoder().encode("sample");
	for (const body of ["sample", "conflict"]) {
		let calls = 0;
		const request = async (_key: string, init?: RequestInit) => {
			calls++;
			assert.equal(init, undefined);
			return new Response(body);
		};
		if (body === "sample")
			assert.equal(
				await uploadImmutable(request, "release/index.json", bytes),
				"existing",
			);
		else
			await assert.rejects(
				uploadImmutable(request, "release/index.json", bytes),
				/differs/,
			);
		assert.equal(calls, 1);
	}
});

test("new uploads and races are conditional and verified by reading stored bytes", async () => {
	const bytes = new TextEncoder().encode("sample");
	for (const race of [false, true]) {
		let calls = 0;
		const request = async (_key: string, init?: RequestInit) => {
			calls++;
			if (calls === 1) return new Response(null, { status: 404 });
			if (calls === 3) return new Response(bytes);
			assert.equal(init?.method, "PUT");
			assert.equal(new Headers(init?.headers).get("if-none-match"), "*");
			assert.equal(await new Response(init?.body).text(), "sample");
			return race
				? new Response(null, { status: 412 })
				: new Response(null, { status: 200 });
		};
		assert.equal(
			await uploadImmutable(request, "release/index.json", bytes),
			race ? "existing" : "uploaded",
		);
		assert.equal(calls, 3);
	}
});

test("unknown destination, incorrect stored bytes and lost response fail closed", async () => {
	const bytes = new TextEncoder().encode("sample");
	await assert.rejects(
		uploadImmutable(
			async () => new Response(null, { status: 403 }),
			"key",
			bytes,
		),
		/Destination check/,
	);
	let calls = 0;
	await assert.rejects(
		uploadImmutable(
			async () =>
				++calls === 1
					? new Response(null, { status: 404 })
					: new Response("wrong stored bytes"),
			"key",
			bytes,
		),
		/differs/,
	);
	await assert.rejects(
		uploadImmutable(
			async (_key, init) => {
				if (init) throw new Error("lost response");
				return new Response(null, { status: 404 });
			},
			"key",
			bytes,
		),
		/lost response/,
	);
});

test("S3 transport is constrained to approved v2 keys and disposable-key deletion", () => {
	const key = "v2/starter-20260912/index.json";
	assert.doesNotThrow(() => assertMigrationRequest(key));
	assert.doesNotThrow(() =>
		assertMigrationRequest(key, {
			method: "PUT",
			headers: { "if-none-match": "*" },
		}),
	);
	assert.doesNotThrow(() =>
		assertMigrationRequest(SAFETY_KEY, { method: "DELETE" }),
	);
	for (const other of [
		"v3/full-59025-20260914/manifest.json",
		"v2/unknown/index.json",
		"v2/starter-20260912/../index.json",
		"https://example.com/",
		"__maintenance__/unapproved.txt",
	])
		assert.throws(() => assertMigrationRequest(other), /outside/);
	assert.throws(
		() => assertMigrationRequest(key, { method: "DELETE" }),
		/Only reads/,
	);
	assert.throws(
		() => assertMigrationRequest(key, { method: "PUT" }),
		/Only reads/,
	);
	assert.throws(
		() => assertMigrationRequest(key, { headers: { authorization: "unsafe" } }),
		/Unexpected/,
	);
});

test("curl responses preserve binary bytes, informational responses and HTTP errors", async () => {
	const bytes = Buffer.from([0, 255, 128, 13, 10]);
	const response = parseCurlResponse(
		Buffer.concat([
			Buffer.from(
				"HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200\r\nContent-Type: application/octet-stream\r\n\r\n",
			),
			bytes,
		]),
	);
	assert.equal(response.status, 200);
	assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
	assert.equal(
		parseCurlResponse(Buffer.from("HTTP/2 412\r\n\r\n<Error/>")).status,
		412,
	);
	assert.equal(parseCurlResponse(Buffer.from("HTTP/2 204\r\n\r\n")).body, null);
	assert.throws(() => parseCurlResponse(Buffer.from("not http")), /Malformed/);
});

test("live-gate fixture requires rejection and preserved bytes, and removes only its disposable object", async () => {
	for (const honorsCondition of [true, false]) {
		let stored: Uint8Array | undefined;
		const request = async (key: string, init?: RequestInit) => {
			assert.equal(key, SAFETY_KEY);
			if (init?.method === "PUT") {
				assert.equal(new Headers(init.headers).get("if-none-match"), "*");
				if (stored && honorsCondition)
					return new Response(null, { status: 412 });
				stored = new Uint8Array(await new Response(init.body).arrayBuffer());
				return new Response(null, { status: 200 });
			}
			if (init?.method === "DELETE") {
				stored = undefined;
				return new Response(null, { status: 204 });
			}
			return stored
				? new Response(Uint8Array.from(stored))
				: new Response(null, { status: 404 });
		};
		if (honorsCondition) await verifyConditionalWrites(request);
		else
			await assert.rejects(
				verifyConditionalWrites(request),
				/safety gate failed/,
			);
		assert.equal(stored, undefined);
	}
	let calls = 0;
	await assert.rejects(
		verifyConditionalWrites(async (_key, init) => {
			calls++;
			assert.equal(init, undefined);
			return new Response("unrelated existing data");
		}),
		/not absent/,
	);
	assert.equal(calls, 1);
});

test("bounded copy stops scheduling after failure and drains its in-flight work", async () => {
	let active = 0,
		peak = 0,
		completed = 0;
	await assert.rejects(
		forEachBounded([0, 1, 2, 3, 4, 5], async (value) => {
			active++;
			peak = Math.max(peak, active);
			try {
				if (value === 0) throw new Error("stop");
				await new Promise<void>((resolve) => setImmediate(resolve));
				completed++;
			} finally {
				active--;
			}
		}),
		/stop/,
	);
	assert.ok(peak <= 4);
	assert.equal(completed, 3);
	assert.equal(active, 0);
});
