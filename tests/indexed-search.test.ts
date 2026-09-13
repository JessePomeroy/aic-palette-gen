import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
	analyzeColorSignature,
	type ColorIndex,
} from "../src/lib/colors/color-index.ts";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog.ts";
import {
	COLOR_INDEX_ASSET_ROOT,
	createIndexedSearch,
} from "../src/lib/colors/indexed-search.ts";

function fixture(...colors: number[][]) {
	const samples = new Map<string, Uint8Array>();
	const index: ColorIndex = {
		version: 2,
		generatedAt: "2026-09-12T00:00:00Z",
		corpus: "Synthetic test catalog",
		entries: colors.map((rgb, i) => {
			const pixels = Uint8Array.from([...rgb, 255]);
			const sha256 = createHash("sha256").update(pixels).digest("hex");
			samples.set(sha256, pixels);
			return {
				artworkId: i + 1,
				imageId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
				sourceUpdatedAt: null,
				signature: analyzeColorSignature(pixels),
				sample: { width: 1, height: 1, sha256 },
			};
		}),
	};
	const catalog = {
		version: 1,
		artworks: index.entries.map((entry) => ({
			id: entry.artworkId,
			title: `Artwork ${entry.artworkId}`,
			image_id: entry.imageId,
			is_public_domain: true,
		})),
	};
	const requests: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		assert.ok(
			url.startsWith(`${COLOR_INDEX_ASSET_ROOT}/`),
			"Matching must never fetch museum API/images or a proxy",
		);
		if (url.endsWith("/index.json")) return Response.json(index);
		if (url.endsWith("/artworks.json")) return Response.json(catalog);
		const digest = url.split("/").at(-1)?.replace(".rgba", "");
		const pixels = digest && samples.get(digest);
		return pixels
			? new Response(Uint8Array.from(pixels))
			: new Response(null, { status: 404 });
	};
	return { index, catalog, samples, requests, fetcher };
}

test("indexed selection preserves strict green matching, current exclusion and seen fallback without museum requests", async () => {
	const data = fixture([90, 90, 90], [85, 96, 82], [84, 95, 81]);
	let count = 0;
	const result = await createIndexedSearch(data.fetcher).search(["#556052"], {
		signal: new AbortController().signal,
		currentArtworkId: 3,
		seenArtworkIds: [2],
		onIndexReady: (n) => (count = n),
	});
	assert.equal(count, 3);
	assert.equal(result.status, "match");
	if (result.status !== "match") throw new Error("Expected match");
	assert.equal(result.artwork.id, 2);
	assert.equal(result.repeated, true);
	assert.equal(result.indexedCount, 3);
	assert.ok(
		!data.requests.some((url) =>
			url.endsWith(`${data.index.entries[2].sample.sha256}.rgba`),
		),
	);
});

test("repeated searches reuse the catalog and verified samples", async () => {
	const data = fixture([85, 96, 82]);
	const search = createIndexedSearch(data.fetcher);
	for (let i = 0; i < 3; i++)
		assert.equal(
			(
				await search.search(["#556052"], {
					signal: new AbortController().signal,
				})
			).status,
			"match",
		);
	assert.equal(
		data.requests.length,
		3,
		"Two JSON files and one sample, loaded once",
	);
});

test("expanded catalogs can exhaust more than 1000 strict rejections without a false incomplete result", async () => {
	// Gray is conservatively retrieved for this muted green but fails the
	// app's final hue/chroma policy. Every candidate must actually be checked.
	const data = fixture(...Array.from({ length: 2500 }, () => [90, 90, 90]));
	const result = await createIndexedSearch(data.fetcher).search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(result.status, "no-match");
	assert.equal(result.checkedCount, 2500);
	assert.equal(result.indexedCount, 2500);
});

test("workbench edits to a returned artwork cannot mutate the cached catalog", async () => {
	const data = fixture([85, 96, 82]);
	const search = createIndexedSearch(data.fetcher);
	const first = await search.search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(first.status, "match");
	if (first.status !== "match") throw new Error("Expected match");
	first.artwork.title = "Edited";
	first.artwork.thumbnail.alt_text = "Edited";
	const second = await search.search(["#556052"], {
		signal: new AbortController().signal,
	});
	if (second.status !== "match") throw new Error("Expected match");
	assert.equal(second.artwork.title, "Artwork 1");
	assert.equal(second.artwork.thumbnail.alt_text, "");
});

test("complete negative and unavailable sample results are distinct, and failed samples can retry", async () => {
	const gray = fixture([90, 90, 90]);
	const rejected = await createIndexedSearch(gray.fetcher).search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(rejected.status, "no-match");
	const data = fixture([85, 96, 82]);
	let unavailable = true;
	const search = createIndexedSearch((input, init) =>
		String(input).endsWith(".rgba") && unavailable
			? Promise.resolve(new Response(null, { status: 503 }))
			: data.fetcher(input, init),
	);
	const result = await search.search(["#556052"], {
		signal: new AbortController().signal,
	});
	assert.equal(result.status, "incomplete");
	if (result.status !== "incomplete") throw new Error("Expected incomplete");
	assert.equal(result.reason, "unavailable");
	assert.equal(result.unavailableCount, 1);
	unavailable = false;
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
});

test("corrupt sample data is neither accepted nor retained in the sample cache", async () => {
	const data = fixture([85, 96, 82]);
	let corrupt = true;
	const search = createIndexedSearch((input, init) =>
		String(input).endsWith(".rgba") && corrupt
			? Promise.resolve(new Response(new Uint8Array([0, 0, 0, 255])))
			: data.fetcher(input, init),
	);
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"incomplete",
	);
	corrupt = false;
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
});

test("all locks must occur in the same indexed artwork", async () => {
	const data = fixture([255, 0, 0], [0, 0, 255]);
	assert.equal(
		(
			await createIndexedSearch(data.fetcher).search(["#ff0000", "#0000ff"], {
				signal: new AbortController().signal,
			})
		).status,
		"no-match",
	);
	assert.equal(
		data.requests.length,
		2,
		"Conservative retrieval can reject impossible candidates without loading pixels",
	);
});

test("missing or mismatched index metadata throws instead of reporting no match", async () => {
	const data = fixture([85, 96, 82]);
	const missing = createIndexedSearch(
		async () => new Response(null, { status: 404 }),
	);
	await assert.rejects(
		missing.search(["#556052"], { signal: new AbortController().signal }),
		/unavailable/,
	);
	data.catalog.artworks[0].image_id = "00000000-0000-0000-0000-999999999999";
	await assert.rejects(
		createIndexedSearch(data.fetcher).search(["#556052"], {
			signal: new AbortController().signal,
		}),
		/do not agree/,
	);
});

test("invalid queries and cancellation before loading do not fetch", async () => {
	const data = fixture([85, 96, 82]);
	const search = createIndexedSearch(data.fetcher);
	for (const locks of [
		[],
		["green"],
		Array.from({ length: 9 }, () => "#556052"),
	])
		await assert.rejects(
			search.search(locks, { signal: new AbortController().signal }),
			/valid locked/,
		);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		search.search(["#556052"], { signal: controller.signal }),
		{ name: "AbortError" },
	);
	assert.equal(data.requests.length, 0);
});

test("a cancelled catalog load cannot overwrite or cancel the next search", async () => {
	const data = fixture([85, 96, 82]);
	let release = (_: Response) => {};
	let first = true;
	const delayed = new Promise<Response>((resolve) => (release = resolve));
	const search = createIndexedSearch((input, init) => {
		if (first && String(input).endsWith("/index.json")) {
			first = false;
			return delayed;
		}
		return data.fetcher(input, init);
	});
	const oldController = new AbortController();
	const old = search.search(["#556052"], {
		signal: oldController.signal,
		onIndexReady: () => assert.fail("Cancelled load must not publish progress"),
	});
	oldController.abort();
	assert.equal(
		(await search.search(["#556052"], { signal: new AbortController().signal }))
			.status,
		"match",
	);
	release(Response.json(data.index));
	await assert.rejects(old, { name: "AbortError" });
});

test("locks are snapshotted across catalog loading", async () => {
	const data = fixture([85, 96, 82]);
	const locks = ["#556052"];
	const pending = createIndexedSearch(data.fetcher).search(locks, {
		signal: new AbortController().signal,
	});
	locks[0] = "#0000ff";
	assert.equal((await pending).status, "match");
});

test("catalog normalization retains display metadata and rejects unsafe, duplicate or non-public-domain entries", () => {
	const data = fixture([85, 96, 82]);
	const art = readIndexedArtwork({
		...data.catalog.artworks[0],
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
