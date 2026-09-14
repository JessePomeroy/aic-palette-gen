import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { sha256, writeShardRelease } from "../scripts/lib/shard-builder.ts";
import {
	findColorCandidates,
	LOCKED_COLOR_MATCH_POLICY,
	matchColorPixels,
} from "../src/lib/colors/color-index.ts";
import {
	addTileCoverage,
	DIRECTORY_MAGIC,
	readArtworkDirectory,
	readMetadataPage,
	readShardManifest,
	tilesForLock,
} from "../src/lib/colors/color-shards.ts";
import { createIndexedSearch } from "../src/lib/colors/indexed-search.ts";
import { shardFixture } from "./helpers/shard-fixture.ts";

const signal = () => new AbortController().signal;
test("packing preserves audited pixels and deduplicates samples without exposing source paths", async () => {
	const f = await shardFixture([["#444f40"], ["#444f40"], ["#ffffff"]]);
	const manifest = readShardManifest(f.manifest);
	const directory = readArtworkDirectory(
		gunzipSync(f.asset("directory.bin.gz")),
		3,
	);
	const metadata = readMetadataPage(
		JSON.parse(gunzipSync(f.asset("metadata/0.json.gz")).toString()),
		0,
		manifest,
		directory,
	);
	assert.deepEqual([...directory.ids], [1, 2, 3]);
	assert.equal(metadata[0].sample.offset, metadata[1].sample.offset);
	for (let i = 0; i < metadata.length; i++) {
		const sample = metadata[i].sample,
			pack = f.asset(`samples/${sample.pack}.pack`);
		assert.deepEqual(
			new Uint8Array(
				gunzipSync(
					pack.slice(sample.offset, sample.offset + sample.compressedBytes),
				),
			),
			f.entries[i].pixels,
		);
	}
	assert.ok(!JSON.stringify(metadata).includes("source"));
});

test("tighter retrieval stays conservative and preserves exact acceptance for single and multiple locks", async () => {
	const f = await shardFixture();
	const index = {
		version: 2 as const,
		generatedAt: f.manifest.generatedAt,
		corpus: "fixture",
		entries: f.entries.map((row) => row.entry),
	};
	const search = createIndexedSearch(f.fetcher);
	for (const locks of [
		["#00ff00"],
		["#ff0000", "#00ff00"],
		["#0000ff"],
		["#444f40"],
		["#e8c0c8"],
		["#bd9751"],
		["#777777"],
		["#444f40", "#e8c0c8"],
	]) {
		const result = await search.search(locks, { signal: signal() });
		const candidates = findColorCandidates(
			index,
			locks,
			LOCKED_COLOR_MATCH_POLICY,
		);
		const exact = f.entries.filter(
			(row) =>
				matchColorPixels(row.pixels, locks, LOCKED_COLOR_MATCH_POLICY).matches,
		);
		assert.ok(result.candidateCount <= candidates.length);
		assert.ok(
			result.candidateCount >= exact.length,
			"Tighter retrieval retains every strict match",
		);
		assert.equal(result.status, exact.length ? "match" : "no-match");
		if (result.status === "match")
			assert.ok(exact.some((row) => row.artwork.id === result.artwork.id));
	}
	assert.equal(f.requests.filter((r) => r.path === "manifest.json").length, 1);
	assert.equal(
		f.requests.find((r) => r.path === "release.json")?.cache,
		"no-cache",
	);
	assert.ok(
		f.requests
			.filter((r) => r.path.startsWith("samples/"))
			.every((r) => r.range),
	);
});

test("rounding-box and hue-cone pruning retain every strict match across varied RGB samples", async () => {
	let seed = 192837;
	const hexes = [
		"#000000",
		"#ffffff",
		"#777777",
		"#e8c0c8",
		"#444f40",
		"#556052",
	];
	while (hexes.length < 512) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		hexes.push(`#${(seed & 0xffffff).toString(16).padStart(6, "0")}`);
	}
	const f = await shardFixture(hexes.map((hex) => [hex]));
	const directory = readArtworkDirectory(
		gunzipSync(f.asset("directory.bin.gz")),
		hexes.length,
	);
	for (const hex of hexes.slice(0, 128)) {
		const counts = new Uint32Array(hexes.length);
		for (const key of tilesForLock(hex, f.manifest))
			addTileCoverage(
				gunzipSync(f.asset(`tiles/${key}.bin.gz`)),
				key,
				directory,
				hex,
				counts,
			);
		for (let i = 0; i < f.entries.length; i++) {
			if (
				matchColorPixels(f.entries[i].pixels, [hex], LOCKED_COLOR_MATCH_POLICY)
					.matches
			)
				assert.equal(
					counts[i],
					1,
					`Strict ${hex} match must survive conservative pruning`,
				);
		}
	}
});

test("an oversized query stops before exceeding its download allowance and reports incomplete", async () => {
	const f = await shardFixture([["#00ff00"]]),
		count = 300000;
	const directory = Buffer.alloc(8 + count * 8);
	directory.writeUInt32LE(DIRECTORY_MAGIC, 0);
	directory.writeUInt32LE(count, 4);
	for (let i = 0; i < count; i++) {
		directory.writeUInt32LE(i + 1, 8 + i * 8);
		directory.writeUInt32LE(1, 12 + i * 8);
	}
	const encoded = gzipSync(directory),
		key = Object.keys(f.manifest.tiles)[0];
	const manifest = {
		...f.manifest,
		count,
		directory: {
			bytes: directory.length,
			compressedBytes: encoded.length,
			sha256: sha256(directory),
		},
		metadata: Array.from(
			{ length: Math.ceil(count / 256) },
			() => f.manifest.metadata[0],
		),
		tiles: {
			[key]: {
				bytes: 14000000,
				compressedBytes: 13000000,
				sha256: "a".repeat(64),
			},
		},
	};
	f.files.set("directory.bin.gz", encoded);
	f.files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
	const result = await createIndexedSearch(f.fetcher).search(["#00ff00"], {
		signal: signal(),
	});
	assert.equal(result.status, "incomplete");
	if (result.status === "incomplete") assert.equal(result.reason, "limit");
	assert.ok(
		!f.requests.some((request) => request.path.startsWith("tiles/")),
		"No oversized download starts",
	);
});

test("current artwork is excluded, unseen matches are preferred, and returned metadata is owned", async () => {
	const f = await shardFixture([["#00ff00"], ["#00ff00"], ["#00ff00"]]);
	const search = createIndexedSearch(f.fetcher);
	const result = await search.search(["#00ff00"], {
		signal: signal(),
		currentArtworkId: 1,
		seenArtworkIds: [2],
	});
	assert.equal(result.status, "match");
	if (result.status !== "match") return;
	assert.equal(result.artwork.id, 3);
	assert.equal(result.repeated, false);
	result.artwork.thumbnail.width = 999;
	const repeated = await search.search(["#00ff00"], {
		signal: signal(),
		currentArtworkId: 1,
		seenArtworkIds: [2, 3],
	});
	assert.equal(repeated.status, "match");
	if (repeated.status === "match") {
		assert.equal(repeated.repeated, true);
		assert.equal(repeated.artwork.thumbnail.width, 1);
	}
});

test("invalid queries and pre-cancelled work do not fetch", async () => {
	const f = await shardFixture(),
		search = createIndexedSearch(f.fetcher);
	for (const locks of [[], ["bad"], Array(9).fill("#ffffff")])
		await assert.rejects(search.search(locks, { signal: signal() }));
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		search.search(["#ffffff"], { signal: controller.signal }),
	);
	assert.equal(f.requests.length, 0);
});

test("missing tiles and corrupt release metadata never become a no-match verdict", async () => {
	const f = await shardFixture([["#00ff00"]]);
	const tile = [...f.files.keys()].find((key) => key.startsWith("tiles/"));
	assert.ok(tile);
	f.unavailable.add(tile);
	await assert.rejects(
		createIndexedSearch(f.fetcher).search(["#00ff00"], { signal: signal() }),
	);
	f.unavailable.clear();
	f.corrupt.add("directory.bin.gz");
	await assert.rejects(
		createIndexedSearch(f.fetcher).search(["#00ff00"], { signal: signal() }),
	);
});

test("missing or wrongly ranged samples are incomplete and can be retried", async () => {
	const f = await shardFixture([["#00ff00"]]),
		search = createIndexedSearch(f.fetcher);
	f.unavailable.add("samples/0.pack");
	assert.equal(
		(await search.search(["#00ff00"], { signal: signal() })).status,
		"incomplete",
	);
	f.unavailable.clear();
	f.wrongRange(true);
	assert.equal(
		(await search.search(["#00ff00"], { signal: signal() })).status,
		"incomplete",
	);
	f.wrongRange(false);
	assert.equal(
		(await search.search(["#00ff00"], { signal: signal() })).status,
		"match",
	);
});

test("cancellation during sample retrieval cannot complete or poison the next search", async () => {
	const f = await shardFixture([["#00ff00"]]),
		controller = new AbortController();
	let cancel = true;
	const fetcher: typeof fetch = async (input, init) => {
		if (String(input).includes("samples/") && cancel) {
			cancel = false;
			controller.abort();
		}
		return f.fetcher(input, init);
	};
	const search = createIndexedSearch(fetcher);
	await assert.rejects(
		search.search(["#00ff00"], { signal: controller.signal }),
	);
	assert.equal(
		(await search.search(["#00ff00"], { signal: signal() })).status,
		"match",
	);
});

test("tile and metadata readers reject out-of-bounds addresses and counts", async () => {
	const f = await shardFixture([["#00ff00"]]);
	const directory = readArtworkDirectory(
		gunzipSync(f.asset("directory.bin.gz")),
		1,
	);
	const key = Object.keys(f.manifest.tiles)[0],
		bytes = gunzipSync(f.asset(`tiles/${key}.bin.gz`));
	bytes.writeUInt32LE(99, 18);
	assert.throws(() =>
		addTileCoverage(bytes, key, directory, "#00ff00", new Uint32Array(1)),
	);
	assert.throws(() =>
		readShardManifest({
			...f.manifest,
			tiles: { "../private": f.manifest.directory },
		}),
	);
	const page = JSON.parse(gunzipSync(f.asset("metadata/0.json.gz")).toString());
	page[0].sample.offset = 999999;
	assert.throws(() => readMetadataPage(page, 0, f.manifest, directory));
});

test("a corrupt source sample never writes a release manifest", async () => {
	const f = await shardFixture([["#00ff00"]]);
	const source = {
			...f.entries[0],
			compressedSample: new Uint8Array([1, 2, 3]),
		},
		files: string[] = [];
	async function* entries() {
		yield source;
	}
	await assert.rejects(
		writeShardRelease(entries(), 1, f.manifest.generatedAt, async (path) => {
			files.push(path);
		}),
	);
	assert.ok(!files.includes("manifest.json"));
});
