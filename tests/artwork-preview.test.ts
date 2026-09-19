import assert from "node:assert/strict";
import { test } from "node:test";
import { createIndexedSearch } from "../src/lib/colors/indexed-search.ts";
import { shardFixture } from "./helpers/shard-fixture.ts";

test("preview lookup returns verified pixels for the same artwork and image without color tiles", async () => {
	const f = await shardFixture([["#a05030", "#405060"]]);
	const index = createIndexedSearch(f.fetcher);
	const result = await index.sampleForArtwork(
		f.entries[0].artwork,
		AbortSignal.timeout(1000),
	);
	assert.ok(result);
	assert.deepEqual(result, {
		width: 2,
		height: 1,
		pixels: f.entries[0].pixels,
	});
	assert.ok(!f.requests.some((request) => request.path.startsWith("tiles/")));
	const calls = f.requests.length;
	result.pixels.fill(0);
	const again = await index.sampleForArtwork(
		f.entries[0].artwork,
		AbortSignal.timeout(1000),
	);
	assert.deepEqual(
		again?.pixels,
		f.entries[0].pixels,
		"callers cannot mutate the cached sample",
	);
	assert.equal(f.requests.length, calls);
});

test("unindexed and changed museum images never get an unrelated preview", async () => {
	const f = await shardFixture();
	const index = createIndexedSearch(f.fetcher);
	for (const artwork of [
		{ ...f.entries[0].artwork, id: 99999 },
		{ ...f.entries[0].artwork, image_id: f.entries[1].artwork.image_id },
	])
		assert.equal(
			await index.sampleForArtwork(artwork, AbortSignal.timeout(1000)),
			null,
		);
	assert.ok(!f.requests.some((request) => request.path.startsWith("samples/")));
});

test("corrupt or wrong-range preview data fails closed, and a retry can recover", async () => {
	const f = await shardFixture();
	const index = createIndexedSearch(f.fetcher);
	f.corrupt.add("samples/0.pack");
	// Corrupt the requested first sample, not merely the last byte of the pack.
	f.wrongRange(true);
	await assert.rejects(
		index.sampleForArtwork(f.entries[0].artwork, AbortSignal.timeout(1000)),
		/range/,
	);
	f.wrongRange(false);
	const last = f.entries.at(-1);
	assert.ok(last);
	await assert.rejects(
		index.sampleForArtwork(last.artwork, AbortSignal.timeout(1000)),
	);
	f.corrupt.clear();
	assert.ok(
		await index.sampleForArtwork(
			f.entries[0].artwork,
			AbortSignal.timeout(1000),
		),
	);
});

test("aborted preview requests cannot return pixels even from cache", async () => {
	const f = await shardFixture();
	const index = createIndexedSearch(f.fetcher);
	await index.sampleForArtwork(f.entries[0].artwork, AbortSignal.timeout(1000));
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		index.sampleForArtwork(f.entries[0].artwork, controller.signal),
		{ name: "AbortError" },
	);
});
