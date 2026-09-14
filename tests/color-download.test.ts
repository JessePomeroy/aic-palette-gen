import assert from "node:assert/strict";
import { test } from "node:test";
import { requestColorImage } from "../scripts/lib/color-download.ts";

const image_id = "00000000-0000-0000-0000-000000000001";
const scaleError = "Requests for scales in excess of 100% are not allowed.";

test("width requests preserve the existing size except for narrow originals", async () => {
	for (const [width, expected] of [
		[554, 155],
		[1, 1],
		[3000, 843],
		[0, 843],
	]) {
		const response = await requestColorImage(
			{ image_id, thumbnail: { width, height: 3000, alt_text: "" } },
			async (url) => {
				assert.ok(url.endsWith(`/full/${expected},/0/default.jpg`));
				return new Response(null, { status: 200 });
			},
		);
		assert.equal(response.status, 200);
	}
});

test("only an explicit scale restriction retries once at half size, including split bodies", async () => {
	const urls: string[] = [];
	let cancelled = false;
	const response = await requestColorImage({ image_id }, async (url) => {
		urls.push(url);
		if (urls.length === 2) return new Response(null, { status: 200 });
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(scaleError.slice(0, 20)));
					controller.enqueue(new TextEncoder().encode(scaleError.slice(20)));
				},
				cancel() {
					cancelled = true;
				},
			}),
			{ status: 403 },
		);
	});
	assert.equal(response.status, 200);
	assert.equal(cancelled, true);
	assert.deepEqual(
		urls.map((url) => new URL(url).pathname.split("/").at(-3)),
		["843,", "pct:50"],
	);
});

test("other forbidden responses are not retried and error reads are bounded", async () => {
	for (const message of ["Access denied", "x".repeat(4096) + scaleError]) {
		let calls = 0;
		const response = await requestColorImage({ image_id }, async () => {
			calls++;
			return new Response(message, { status: 403 });
		});
		assert.equal(response.status, 403);
		assert.equal(calls, 1);
	}
});

test("fallback errors retain cooldown headers and never loop", async () => {
	for (const status of [403, 429, 503]) {
		let calls = 0;
		const response = await requestColorImage({ image_id }, async () => {
			calls++;
			return calls === 1
				? new Response(scaleError, { status: 403 })
				: new Response(scaleError, {
						status,
						headers: { "retry-after": "120" },
					});
		});
		assert.equal(calls, 2);
		assert.equal(response.status, status);
		assert.equal(response.headers.get("retry-after"), "120");
		await response.body?.cancel();
	}
});
