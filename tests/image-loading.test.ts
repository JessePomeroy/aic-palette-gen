import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchImageBlob } from "../src/lib/images/artwork-image.ts";

const originalFetch = globalThis.fetch;
const imageUrl = "https://www.artic.edu/iiif/2/example/full/843,/0/default.jpg";
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("loads directly without depending on a proxy blocked by the CDN", async () => {
	const calls: unknown[] = [];
	globalThis.fetch = async (url) => {
		calls.push(url);
		return url === imageUrl
			? new Response("pixels", { headers: { "Content-Type": "image/jpeg" } })
			: new Response("Forbidden", { status: 403 });
	};
	assert.equal(await (await fetchImageBlob(imageUrl)).text(), "pixels");
	assert.deepEqual(calls, [imageUrl]);
});

test("falls back once when browser CORS rejects the direct image", async () => {
	const calls: unknown[] = [];
	globalThis.fetch = async (url) => {
		calls.push(url);
		if (url === imageUrl) throw new TypeError("Failed to fetch");
		return new Response("pixels", {
			headers: { "Content-Type": "image/jpeg" },
		});
	};
	assert.equal(await (await fetchImageBlob(imageUrl)).text(), "pixels");
	assert.deepEqual(calls, [
		imageUrl,
		`/api/image?${new URLSearchParams({ url: imageUrl })}`,
	]);
});

test("reports failure after both paths fail without an unbounded retry loop", async () => {
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return new Response("Forbidden", { status: 403 });
	};
	await assert.rejects(
		fetchImageBlob(imageUrl),
		/directly or through the proxy/,
	);
	assert.equal(calls, 2);
});

test("cancelling an image request does not start the fallback proxy", async () => {
	const controller = new AbortController();
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		controller.abort();
		throw new DOMException("Cancelled", "AbortError");
	};
	await assert.rejects(fetchImageBlob(imageUrl, controller.signal), {
		name: "AbortError",
	});
	assert.equal(calls, 1);
});
