import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_PALETTE_BYTES,
	PaletteRequestError,
	parsePalette,
	readPaletteRequest,
} from "../src/lib/server/palette-request.ts";
import { createWriteLimiter } from "../src/lib/server/write-limiter.ts";

const palette = () => ({
	artworkId: 27992,
	mode: "dominant",
	count: 5,
	colors: Array.from({ length: 5 }, () => ({
		hex: "#123456",
		rgb: { r: 18, g: 52, b: 86 },
		hsl: { h: 210, s: 65, l: 20 },
		name: "Blue",
	})),
});

test("palette validation preserves exact valid swatches and strips unrelated fields", () => {
	for (const mode of ["dominant", "vibrant", "ai"]) {
		const value = { ...palette(), mode, unwanted: { nested: true } };
		assert.deepEqual(parsePalette(value), { ...palette(), mode });
	}
	const eight = {
		...palette(),
		count: 8,
		colors: Array.from({ length: 8 }, () => palette().colors[0]),
	};
	assert.deepEqual(parsePalette(eight), eight);
});

test("malformed palette shapes, ranges, and inconsistent counts never reach persistence", () => {
	for (const value of [
		null,
		[],
		"palette",
		{},
		{ ...palette(), artworkId: 0 },
		{ ...palette(), artworkId: 2147483648 },
		{ ...palette(), artworkId: "27992" },
		{ ...palette(), mode: "invalid" },
		{ ...palette(), count: 99 },
		{ ...palette(), count: 5.5 },
		{ ...palette(), count: 6 },
		{ ...palette(), colors: [] },
		{ ...palette(), colors: [null, ...palette().colors.slice(1)] },
	])
		assert.throws(() => parsePalette(value), PaletteRequestError);
	for (const change of [
		{ hex: "red" },
		{ hex: "#abcdef" },
		{ rgb: [18, 52, 86] },
		{ rgb: { r: NaN, g: 52, b: 86 } },
		{ rgb: { r: 18, g: 52, b: 256 } },
		{ hsl: { h: Infinity, s: 20, l: 30 } },
		{ hsl: { h: 400, s: 20, l: 30 } },
		{ name: "x".repeat(81) },
		{ name: { text: "blue" } },
	]) {
		const value = palette();
		const colors = [
			{ ...value.colors[0], ...change },
			...value.colors.slice(1),
		];
		assert.throws(
			() => parsePalette({ ...value, colors }),
			PaletteRequestError,
		);
	}
});

test("JSON boundary rejects foreign origins and unsupported content types", async () => {
	const make = (headers: HeadersInit) =>
		new Request("https://chroma.test/api/palette", {
			method: "POST",
			headers,
			body: JSON.stringify(palette()),
		});
	assert.deepEqual(
		await readPaletteRequest(
			make({
				"content-type": "application/json; charset=utf-8",
				origin: "https://chroma.test",
			}),
			"https://chroma.test",
		),
		palette(),
	);
	for (const [headers, status] of [
		[{ "content-type": "application/json", origin: "https://other.test" }, 403],
		[
			{ "content-type": "application/json", "sec-fetch-site": "cross-site" },
			403,
		],
		[{ "content-type": "text/plain" }, 415],
	] as const)
		await assert.rejects(
			readPaletteRequest(make(headers), "https://chroma.test"),
			{ status },
		);
});

test("body cap applies to declared sizes and streamed bodies with a false Content-Length", async () => {
	const request = (body: string, headers = {}) =>
		new Request("https://chroma.test/api/palette", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body,
		});
	await assert.rejects(
		readPaletteRequest(
			request("{}", { "content-length": String(MAX_PALETTE_BYTES + 1) }),
			"https://chroma.test",
		),
		{ status: 413 },
	);
	await assert.rejects(
		readPaletteRequest(
			request(" ".repeat(MAX_PALETTE_BYTES + 1), { "content-length": "1" }),
			"https://chroma.test",
		),
		{ status: 413 },
	);
	await assert.rejects(
		readPaletteRequest(request("{"), "https://chroma.test"),
		{ status: 400 },
	);
	await assert.rejects(
		readPaletteRequest(request("null"), "https://chroma.test"),
		{ status: 400 },
	);
	const exact = JSON.stringify(palette()).padEnd(MAX_PALETTE_BYTES, " ");
	assert.deepEqual(
		await readPaletteRequest(request(exact), "https://chroma.test"),
		palette(),
	);
});

test("save limiter isolates clients, bounds aggregate bursts, and resets after its window", () => {
	const limit = createWriteLimiter(10, 100);
	for (let i = 0; i < 10; i++) assert.equal(limit("client-a", 1000), 0);
	assert.equal(limit("client-a", 1000), 60);
	assert.equal(limit("client-b", 2000), 0);
	for (let i = 0; i < 89; i++) assert.equal(limit(`client-${i}`, 2000), 0);
	assert.equal(limit("new-client", 2000), 59);
	assert.equal(limit("client-a", 61000), 0);
	assert.equal(limit("new-client", 61000), 0);
});
