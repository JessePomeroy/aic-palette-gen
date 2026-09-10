import assert from "node:assert/strict";
import { test } from "node:test";
import { readToneImage } from "../src/lib/server/tone-image.ts";

test("accepts browser JPEG bytes without fetching an external image URL", async () => {
	const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
	const request = new Request("https://example.com/api/ai-palette?count=5", {
		method: "POST",
		headers: { "Content-Type": "image/jpeg" },
		body: bytes,
	});
	assert.deepEqual(await readToneImage(request), Buffer.from(bytes));
});

test("rejects the old URL payload and mislabeled HTML", async () => {
	for (const type of ["application/json", "image/jpeg"]) {
		const request = new Request("https://example.com", {
			method: "POST",
			headers: { "Content-Type": type },
			body: "<html>blocked</html>",
		});
		await assert.rejects(readToneImage(request), /JPEG/);
	}
});

test("enforces the size limit even without a Content-Length header", async () => {
	const request = new Request("https://example.com", {
		method: "POST",
		headers: { "Content-Type": "image/jpeg" },
		body: new Uint8Array(1024 * 1024 + 1),
	});
	assert.equal(request.headers.get("content-length"), null);
	await assert.rejects(readToneImage(request), /exceeds 1 MB/);
});
