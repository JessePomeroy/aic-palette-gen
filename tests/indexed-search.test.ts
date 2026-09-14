import assert from "node:assert/strict";
import { test } from "node:test";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog.ts";
import { createIndexedSearch } from "../src/lib/colors/indexed-search.ts";
import { shardFixture } from "./helpers/shard-fixture.ts";

test("candidate downloads overlap in a bounded window without favoring faster responses", async (t) => {
	const f = await shardFixture([
		["#556052"],
		["#545f51"],
		["#566153"],
		["#556053"],
		["#546052"],
	]);
	t.mock.method(Math, "random", () => 0);
	let active = 0,
		peak = 0;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const completed: number[] = [];
	const search = createIndexedSearch(async (input, init) => {
		if (!String(input).includes("/samples/")) return f.fetcher(input, init);
		const position = ++active;
		peak = Math.max(peak, active);
		if (active === 4) release();
		await gate;
		if (position === 1) await new Promise((resolve) => setTimeout(resolve, 20));
		completed.push(position);
		return f.fetcher(input, init);
	});
	const result = await search.search(["#556052"], {
		signal: AbortSignal.timeout(1000),
	});
	assert.equal(peak, 4);
	assert.notEqual(completed[0], 1);
	assert.equal(result.status, "match");
	if (result.status === "match") assert.equal(result.artwork.id, 1);
	assert.equal(result.checkedCount, 1);
	assert.equal(
		f.requests.filter((request) => request.path.startsWith("samples/")).length,
		4,
	);
});

test("indexed selection preserves strict green matching, exclusions and seen fallback", async () => {
	const f = await shardFixture([["#5a5a5a"], ["#556052"], ["#545f51"]]);
	let count = 0;
	const result = await createIndexedSearch(f.fetcher).search(["#556052"], {
		signal: new AbortController().signal,
		currentArtworkId: 3,
		seenArtworkIds: [2],
		onIndexReady: (n) => {
			count = n;
		},
	});
	assert.equal(count, 3);
	assert.equal(result.status, "match");
	if (result.status === "match") {
		assert.equal(result.artwork.id, 2);
		assert.equal(result.repeated, true);
	}
	assert.ok(f.requests.every((request) => !request.path.includes("artic.edu")));
});

test("repeated searches reuse the manifest, color tiles, metadata and verified sample", async () => {
	const f = await shardFixture([["#556052"]]),
		search = createIndexedSearch(f.fetcher);
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
	const requests = f.requests.length;
	for (let i = 0; i < 3; i++)
		assert.equal(
			(
				await search.search(["#556052"], {
					signal: new AbortController().signal,
				})
			).status,
			"match",
		);
	assert.equal(f.requests.length, requests);
});

test("a complete negative may exhaust 2500 cheap cached sample checks without being marked incomplete", async () => {
	const f = await shardFixture(Array.from({ length: 2500 }, () => ["#5a5a5a"]));
	const result = await createIndexedSearch(f.fetcher).search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(result.status, "no-match");
	assert.equal(result.checkedCount, 2500);
	assert.equal(result.indexedCount, 2500);
});

test("corrupt sample bytes are unavailable, never cached or accepted, and retries recover", async () => {
	const f = await shardFixture([["#556052"]]),
		search = createIndexedSearch(f.fetcher);
	f.corrupt.add("samples/0.pack");
	const result = await search.search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(result.status, "incomplete");
	if (result.status === "incomplete")
		assert.equal(result.reason, "unavailable");
	f.corrupt.clear();
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
});

test("all locked colors must occur in the same artwork, not separate color matches", async () => {
	const f = await shardFixture([["#ff0000"], ["#0000ff"]]);
	const result = await createIndexedSearch(f.fetcher).search(
		["#ff0000", "#0000ff"],
		{ signal: new AbortController().signal },
	);
	assert.equal(result.status, "no-match");
	assert.ok(!f.requests.some((request) => request.path.startsWith("samples/")));
});

test("a cancelled catalog load cannot overwrite or cancel the next search", async () => {
	const f = await shardFixture([["#556052"]]);
	let release = (_: Response) => {};
	const delayed = new Promise<Response>((resolve) => {
		release = resolve;
	});
	let entered = () => {};
	const waiting = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let first = true;
	const search = createIndexedSearch((input, init) => {
		if (first && String(input).endsWith("/manifest.json")) {
			first = false;
			entered();
			return delayed;
		}
		return f.fetcher(input, init);
	});
	const controller = new AbortController();
	const old = search.search(["#556052"], {
		signal: controller.signal,
		onIndexReady: () => assert.fail("Cancelled load must not publish progress"),
	});
	const rejected = assert.rejects(old, { name: "AbortError" });
	await waiting;
	controller.abort();
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
	release(new Response(Uint8Array.from(f.asset("manifest.json"))));
	await rejected;
});

test("locks and seen IDs are snapshotted before asynchronous catalog loading", async () => {
	const f = await shardFixture([["#556052"]]);
	const locks = ["#556052"],
		seen = [1];
	const pending = createIndexedSearch(f.fetcher).search(locks, {
		signal: new AbortController().signal,
		seenArtworkIds: seen,
	});
	locks[0] = "#0000ff";
	seen.pop();
	const result = await pending;
	assert.equal(result.status, "match");
	if (result.status === "match") assert.equal(result.repeated, true);
});

test("catalog normalization preserves display metadata and rejects unsafe or non-public-domain records", async () => {
	const f = await shardFixture([["#556052"]]);
	const art = readIndexedArtwork({
		...f.entries[0].artwork,
		artist_display: null,
		thumbnail: null,
	});
	assert.equal(art.artist_display, "");
	assert.deepEqual(art.thumbnail, { alt_text: "", width: 0, height: 0 });
	assert.throws(
		() => readIndexedArtwork({ ...art, is_public_domain: false }),
		/public-domain/,
	);
	assert.throws(
		() => readIndexedArtwork({ ...art, image_id: "../../sample" }),
		/public-domain/,
	);
	assert.throws(
		() => readArtworkCatalog({ version: 1, artworks: [art, art] }),
		/Duplicate/,
	);
});
