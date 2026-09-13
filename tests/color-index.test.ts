import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
	analyzeColorSignature,
	type ColorIndex,
	colorSampleDigest,
	DEFAULT_COLOR_MATCH_POLICY,
	findColorCandidates,
	findIndexedArtwork,
	LOCKED_COLOR_MATCH_POLICY,
	matchColorPixels,
	matchColorSignature,
	readColorIndex,
	readColorSample,
} from "../src/lib/colors/color-index.ts";

function pixels(...colors: number[][]) {
	return new Uint8ClampedArray(
		colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]),
	);
}

function indexOf(...images: Uint8ClampedArray[]): ColorIndex {
	return {
		version: 2,
		generatedAt: "2026-09-12T00:00:00.000Z",
		corpus: "Synthetic test images, not museum artworks",
		entries: images.map((image, i) => ({
			artworkId: i + 1,
			imageId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
			sourceUpdatedAt: null,
			signature: analyzeColorSignature(image),
			sample: {
				width: image.length / 4,
				height: 1,
				sha256: createHash("sha256").update(image).digest("hex"),
			},
		})),
	};
}

function loaderFor(...images: Uint8ClampedArray[]) {
	return async (entry: ColorIndex["entries"][number]) =>
		Uint8Array.from(images[entry.artworkId - 1]);
}

test("the app's hue/chroma guards apply to strict pixels without dropping valid conservative candidates", async () => {
	const samples = [
		pixels([90, 90, 90]),
		pixels([85, 96, 82]),
		pixels([84, 95, 81]),
	];
	const index = indexOf(...samples);
	assert.equal(
		matchColorPixels(samples[0], ["#556052"], LOCKED_COLOR_MATCH_POLICY)
			.matches,
		false,
	);
	for (const hex of ["#556052", "#e8c0c8", "#bd9751", "#5a5a5a"]) {
		const candidates = new Set(
			findColorCandidates(index, [hex], LOCKED_COLOR_MATCH_POLICY).map(
				(entry) => entry.artworkId,
			),
		);
		for (const [i, sample] of samples.entries()) {
			if (matchColorPixels(sample, [hex], LOCKED_COLOR_MATCH_POLICY).matches)
				assert.ok(candidates.has(i + 1));
		}
	}
	const result = await findIndexedArtwork(index, ["#556052"], {
		policy: LOCKED_COLOR_MATCH_POLICY,
		loadSample: loaderFor(...samples),
		random: () => 0,
	});
	assert.equal(result.status, "match");
	if (result.status === "match") assert.notEqual(result.entry.artworkId, 1);
	for (const guard of [
		{ minColoredChroma: 0.015 },
		{ minChromaRatio: 0 },
		{ maxHueDegrees: 181 },
	])
		assert.throws(
			() =>
				matchColorPixels(samples[0], ["#556052"], {
					...DEFAULT_COLOR_MATCH_POLICY,
					...guard,
				}),
			/policy/,
		);
});

test("direct pixel verification shares all-lock, alpha and coverage semantics without binning", () => {
	const sample = pixels([140, 152, 174], [16, 75, 167], [255, 0, 0, 127]);
	const exact = matchColorPixels(sample, ["#8c98ae", "#104ba7"], {
		maxDeltaE: 0,
		minCoverage: 0.5,
	});
	assert.equal(exact.matches, true);
	assert.deepEqual(
		exact.locks.map((lock) => lock.coverage),
		[0.5, 0.5],
	);
	assert.deepEqual(
		exact.locks.map((lock) => lock.nearestDistance),
		[0, 0],
	);
	assert.equal(matchColorPixels(sample, ["#8c98ae", "#ff0000"]).matches, false);
	assert.equal(matchColorPixels(sample, ["#8c98ae", "#8c98ae"]).matches, true);
	const accent = pixels(
		...Array.from({ length: 99 }, () => [0, 0, 255]),
		[255, 0, 0],
	);
	assert.equal(matchColorPixels(accent, ["#ff0000"]).locks[0].coverage, 0.01);
	assert.equal(matchColorPixels(accent, ["#ff0000"]).matches, true);
	assert.equal(
		matchColorPixels(accent, ["#ff0000"], {
			maxDeltaE: 0.05,
			minCoverage: 0.02,
		}).matches,
		false,
	);
});

test("direct verification handles empty or malformed data without weakening its policy", () => {
	assert.equal(matchColorPixels(pixels(), []).matches, false);
	assert.deepEqual(matchColorPixels(pixels([255, 0, 0, 0]), ["#ff0000"]), {
		matches: false,
		locks: [{ hex: "#ff0000", coverage: 0, nearestDistance: null }],
	});
	assert.throws(() => matchColorPixels(new Uint8Array(3), []), /RGBA/);
	assert.throws(() => matchColorPixels(pixels(), ["red"]), /six-digit/);
	assert.throws(
		() => matchColorPixels(pixels(), [], { maxDeltaE: NaN, minCoverage: 0.01 }),
		/policy/,
	);
});

test("direct verification rejects a near-threshold histogram false positive", () => {
	// A 0.02 Oklab bin rounds this pixel toward the lock. The supplied pixel
	// itself is just outside the experimental 0.05 tolerance.
	const sample = pixels([80, 80, 80]);
	assert.equal(
		matchColorSignature(analyzeColorSignature(sample), ["#5e5e5e"]).matches,
		true,
	);
	const result = matchColorPixels(sample, ["#5e5e5e"]);
	assert.equal(result.matches, false);
	assert.equal(result.locks[0].coverage, 0);
	assert.ok(
		Math.abs((result.locks[0].nearestDistance ?? 0) - 0.0506502592) < 1e-9,
	);
});

test("sRGB reference colors land in independently specified Oklab bins", () => {
	// sRGB primaries in Oklab: R(.62796,.22486,.12585),
	// G(.86644,-.23389,.17950), B(.45201,-.03246,-.31153).
	// Mid-gray is about L=.59987, not encoded sRGB's .502.
	const signature = analyzeColorSignature(
		pixels(
			[0, 0, 0],
			[255, 255, 255],
			[128, 128, 128],
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
		),
	);
	assert.deepEqual(signature, {
		opaquePixels: 6,
		bins: [
			[0, 0, 0, 1],
			[23, -2, -16, 1],
			[30, 0, 0, 1],
			[31, 11, 6, 1],
			[43, -12, 9, 1],
			[50, 0, 0, 1],
		],
	});
});

test("histograms retain neutrals, counts and rare accents independently of pixel order", () => {
	const colors = [
		[0, 0, 0],
		[255, 255, 255],
		[255, 0, 0],
		[0, 0, 0],
	];
	const signature = analyzeColorSignature(pixels(...colors));
	assert.equal(signature.opaquePixels, 4);
	assert.equal(signature.bins.length, 3);
	assert.deepEqual(
		signature,
		analyzeColorSignature(pixels(...colors.reverse())),
	);
	assert.deepEqual(
		signature,
		analyzeColorSignature(new Uint8Array(pixels(...colors))),
	);
	assert.equal(
		matchColorSignature(signature, ["#000000", "#ffffff", "#ff0000"]).matches,
		true,
	);
});

test("every lock passes separately; a perfect match cannot compensate for a missing color", () => {
	const red = analyzeColorSignature(pixels([255, 0, 0]));
	const both = analyzeColorSignature(pixels([255, 0, 0], [0, 0, 255]));
	assert.equal(matchColorSignature(red, ["#ff0000", "#0000ff"]).matches, false);
	const result = matchColorSignature(both, ["#ff0000", "#0000ff"]);
	assert.equal(result.matches, true);
	assert.deepEqual(
		result.locks.map((lock) => lock.coverage),
		[0.5, 0.5],
	);
	assert.ok(
		result.locks.every(
			(lock) => lock.nearestDistance !== null && lock.nearestDistance < 0.02,
		),
	);
});

test("duplicate and nearby locks can share coverage without changing caller hex values", () => {
	const hexes = Object.freeze(["#FF0000", "#ff0000", "#fd0200"]);
	const result = matchColorSignature(
		analyzeColorSignature(pixels([255, 0, 0])),
		hexes,
	);
	assert.equal(result.matches, true);
	assert.deepEqual(
		result.locks.map((lock) => lock.hex),
		hexes,
	);
	assert.deepEqual(
		result.locks.map((lock) => lock.coverage),
		[1, 1, 1],
	);
});

test("coverage threshold rejects isolated artifacts but includes the exact minimum", () => {
	const background = Array.from({ length: 198 }, () => [0, 0, 255]);
	const noise = analyzeColorSignature(
		pixels(...background, [0, 0, 255], [255, 0, 0]),
	);
	const accent = analyzeColorSignature(
		pixels(...background, [255, 0, 0], [255, 0, 0]),
	);
	assert.equal(matchColorSignature(noise, ["#ff0000"]).matches, false);
	const match = matchColorSignature(accent, ["#ff0000", "#0000ff"]);
	assert.equal(match.matches, true);
	assert.equal(match.locks[0].coverage, 0.01);
	assert.equal(
		matchColorSignature(accent, ["#ff0000"], {
			maxDeltaE: 0.05,
			minCoverage: 0.02,
		}).matches,
		false,
	);
});

test("alpha cutoff defines both counted pixels and the coverage denominator", () => {
	const image = analyzeColorSignature(
		pixels([255, 0, 0, 127], [0, 0, 255, 128]),
	);
	assert.equal(image.opaquePixels, 1);
	assert.equal(matchColorSignature(image, ["#ff0000"]).matches, false);
	assert.equal(matchColorSignature(image, ["#0000ff"]).locks[0].coverage, 1);
	for (const empty of [pixels(), pixels([255, 0, 0, 0])]) {
		const signature = analyzeColorSignature(empty);
		assert.equal(matchColorSignature(signature, []).matches, false);
		assert.deepEqual(matchColorSignature(signature, ["#ff0000"]).locks, [
			{ hex: "#ff0000", coverage: 0, nearestDistance: null },
		]);
	}
});

test("tolerance stays fixed unless the caller explicitly selects a different policy", () => {
	const signature = analyzeColorSignature(pixels([128, 128, 128]));
	assert.equal(matchColorSignature(signature, ["#888888"]).matches, true);
	assert.equal(matchColorSignature(signature, ["#aaaaaa"]).matches, false);
	assert.equal(
		matchColorSignature(signature, ["#aaaaaa"], {
			maxDeltaE: 0.2,
			minCoverage: 0.01,
		}).matches,
		true,
	);
	assert.deepEqual(DEFAULT_COLOR_MATCH_POLICY, {
		maxDeltaE: 0.05,
		minCoverage: 0.01,
	});
});

test("invalid lock, policy and pixel inputs fail explicitly", () => {
	const signature = analyzeColorSignature(pixels([255, 0, 0]));
	for (const hex of ["", "red", "#fff", "#gg0000", "ff0000", "#ff000000"])
		assert.throws(() => matchColorSignature(signature, [hex]), /six-digit/);
	for (const maxDeltaE of [-1, NaN, Infinity, 1.1])
		assert.throws(
			() =>
				matchColorSignature(signature, [], { maxDeltaE, minCoverage: 0.01 }),
			/policy/,
		);
	for (const minCoverage of [0, -1, NaN, Infinity, 1.1])
		assert.throws(
			() =>
				matchColorSignature(signature, [], { maxDeltaE: 0.05, minCoverage }),
			/policy/,
		);
	assert.throws(() => analyzeColorSignature(new Uint8Array(3)), /RGBA/);
	assert.throws(
		() => analyzeColorSignature(new Uint8Array(40001 * 4)),
		/40,000/,
	);
});

test("filtering and verification preserve reachability for every eligible artwork", async () => {
	const both = pixels([255, 0, 0], [0, 0, 255]);
	const images = [both, pixels([255, 0, 0]), both, both];
	const index = indexOf(...images);
	const selected = [];
	for (const random of [0, 1 / 3, 0.999999]) {
		const result = await findIndexedArtwork(index, ["#ff0000", "#0000ff"], {
			loadSample: loaderFor(...images),
			random: () => random,
		});
		assert.equal(result.status, "match");
		if (result.status !== "match") throw new Error("Expected a match");
		assert.equal(result.candidateCount, 3);
		assert.equal(result.checkedCount, 1);
		assert.equal(result.repeated, false);
		selected.push(result.entry.artworkId);
	}
	assert.deepEqual(selected, [1, 3, 4]);
});

test("current artwork is excluded and unseen results take priority over repeats", async () => {
	const images = Array.from({ length: 4 }, () => pixels([255, 0, 0]));
	const index = indexOf(...images);
	const before = JSON.stringify(index);
	const result = await findIndexedArtwork(index, ["#ff0000"], {
		loadSample: loaderFor(...images),
		currentArtworkId: 1,
		seenArtworkIds: [1, 2, 4, 999],
		random: () => 0,
	});
	assert.equal(result.status, "match");
	if (result.status !== "match") throw new Error("Expected a match");
	assert.equal(result.entry.artworkId, 3);
	assert.equal(result.candidateCount, 3);
	assert.equal(result.checkedCount, 1);
	assert.equal(result.repeated, false);
	assert.equal(JSON.stringify(index), before);
	const repeated = await findIndexedArtwork(index, ["#ff0000"], {
		loadSample: loaderFor(...images),
		currentArtworkId: 1,
		seenArtworkIds: [1, 2, 3, 4],
		random: () => 0,
	});
	assert.equal(repeated.status, "match");
	if (repeated.status !== "match") throw new Error("Expected a repeat");
	assert.equal(repeated.entry.artworkId, 2);
	assert.equal(repeated.repeated, true);
});

test("empty and only-current candidate pools never fetch or call random", async () => {
	const index = indexOf(pixels([255, 0, 0]));
	const random = () => {
		throw new Error("Must not be called");
	};
	const options = {
		random,
		loadSample: async () => {
			throw new Error("Must not load a sample");
		},
	};
	assert.deepEqual(await findIndexedArtwork(index, ["#0000ff"], options), {
		status: "no-match",
		candidateCount: 0,
		checkedCount: 0,
		unavailableCount: 0,
	});
	assert.deepEqual(
		await findIndexedArtwork(index, ["#ff0000"], {
			...options,
			currentArtworkId: 1,
		}),
		{
			status: "no-match",
			candidateCount: 0,
			checkedCount: 0,
			unavailableCount: 0,
		},
	);
	assert.equal(
		(await findIndexedArtwork(indexOf(), ["#ff0000"], options)).status,
		"no-match",
	);
	for (const value of [-1, 1, NaN, Infinity])
		await assert.rejects(
			findIndexedArtwork(index, [], { ...options, random: () => value }),
			/Random source/,
		);
});

test("a saved index round trips without losing metadata or changing query results", async () => {
	const images = [pixels([255, 0, 0]), pixels([0, 0, 255])];
	const original = indexOf(...images);
	const loaded = readColorIndex(JSON.parse(JSON.stringify(original)));
	assert.deepEqual(loaded, original);
	assert.deepEqual(
		await findIndexedArtwork(loaded, ["#ff0000"], {
			loadSample: loaderFor(...images),
			random: () => 0,
		}),
		await findIndexedArtwork(original, ["#ff0000"], {
			loadSample: loaderFor(...images),
			random: () => 0,
		}),
	);
});

test("conservative retrieval recovers bin-rounding misses without loosening acceptance", async () => {
	const image = pixels([60, 60, 60]);
	const index = indexOf(image);
	assert.equal(
		matchColorSignature(index.entries[0].signature, ["#303030"]).matches,
		false,
	);
	assert.equal(findColorCandidates(index, ["#303030"]).length, 1);
	const result = await findIndexedArtwork(index, ["#303030"], {
		loadSample: loaderFor(image),
	});
	assert.equal(result.status, "match");
	if (result.status !== "match") throw new Error("Expected strict pixel match");
	assert.ok((result.match.locks[0].nearestDistance ?? 1) <= 0.05);
});

test("conservative retrieval retains strict positives across colors and explicit radii", () => {
	let seed = 73;
	const channel = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed >>> 24;
	};
	const colors = Array.from({ length: 16 }, () => [
		channel(),
		channel(),
		channel(),
	]);
	const sample = pixels(
		...colors.flatMap((color) => Array.from({ length: 5 }, () => color)),
	);
	const index = indexOf(sample);
	for (const maxDeltaE of [0, 0.005, 0.02, 0.05, 0.2, 1]) {
		const policy = { maxDeltaE, minCoverage: 0.05 };
		for (const color of colors) {
			const hex =
				"#" +
				color.map((channel) => channel.toString(16).padStart(2, "0")).join("");
			assert.equal(matchColorPixels(sample, [hex], policy).matches, true);
			assert.equal(findColorCandidates(index, [hex], policy).length, 1);
		}
	}
});

test("rejects broad-retrieval false positives, then verifies a seen fallback", async () => {
	const images = [pixels([80, 80, 80]), pixels([94, 94, 94])];
	const result = await findIndexedArtwork(indexOf(...images), ["#5e5e5e"], {
		loadSample: loaderFor(...images),
		seenArtworkIds: [2],
		random: () => 0,
	});
	assert.equal(result.status, "match");
	if (result.status !== "match")
		throw new Error("Expected the second candidate");
	assert.equal(result.entry.artworkId, 2);
	assert.equal(result.repeated, true);
	assert.equal(result.checkedCount, 2);
	assert.equal(result.match.locks[0].nearestDistance, 0);
});

test("budget limits and unavailable or stale samples are incomplete, never no-match", async () => {
	const images = [pixels([80, 80, 80]), pixels([94, 94, 94])];
	const index = indexOf(...images);
	const limited = await findIndexedArtwork(index, ["#5e5e5e"], {
		loadSample: loaderFor(...images),
		random: () => 0,
		maxChecks: 1,
	});
	assert.deepEqual(limited, {
		status: "incomplete",
		reason: "limit",
		candidateCount: 2,
		checkedCount: 1,
		unavailableCount: 0,
	});
	for (const loadSample of [
		async () => {
			throw new Error("network");
		},
		async () => new Uint8Array([1, 2, 3, 4]),
	]) {
		const unavailable = await findIndexedArtwork(index, ["#5e5e5e"], {
			loadSample,
		});
		assert.deepEqual(unavailable, {
			status: "incomplete",
			reason: "unavailable",
			candidateCount: 2,
			checkedCount: 2,
			unavailableCount: 2,
		});
	}
	for (const maxChecks of [0, -1, 1.5, Infinity, 2501])
		await assert.rejects(
			findIndexedArtwork(index, [], {
				loadSample: loaderFor(...images),
				maxChecks,
			}),
			/maxChecks/,
		);
});

test("exhausted verified rejections produce no-match; unavailable candidates do not prevent other matches", async () => {
	const image = pixels([80, 80, 80]);
	const noMatch = await findIndexedArtwork(indexOf(image), ["#5e5e5e"], {
		loadSample: loaderFor(image),
	});
	assert.deepEqual(noMatch, {
		status: "no-match",
		candidateCount: 1,
		checkedCount: 1,
		unavailableCount: 0,
	});
	const images = [pixels([94, 94, 94]), pixels([94, 94, 94])];
	const result = await findIndexedArtwork(indexOf(...images), ["#5e5e5e"], {
		random: () => 0,
		loadSample: async (entry) => {
			if (entry.artworkId === 1) throw new Error("missing");
			return Uint8Array.from(images[1]);
		},
	});
	assert.equal(result.status, "match");
	assert.equal(result.unavailableCount, 1);
});

test("search cancellation before or during a load never returns a stale result", async () => {
	const image = pixels([255, 0, 0]);
	const controller = new AbortController();
	let loads = 0;
	const loadSample = async () => {
		loads++;
		controller.abort();
		return Uint8Array.from(image);
	};
	await assert.rejects(
		findIndexedArtwork(indexOf(image), ["#ff0000"], {
			signal: controller.signal,
			loadSample,
		}),
		{ name: "AbortError" },
	);
	assert.equal(loads, 1);
	await assert.rejects(
		findIndexedArtwork(indexOf(image), ["#ff0000"], {
			signal: controller.signal,
			loadSample,
		}),
		{ name: "AbortError" },
	);
	assert.equal(loads, 1);
});

test("locks and acceptance policy are snapshotted across awaited sample loads", async () => {
	const image = pixels([80, 80, 80]);
	const locks = ["#5e5e5e"];
	const policy = { maxDeltaE: 0.05, minCoverage: 0.01 };
	const result = await findIndexedArtwork(indexOf(image), locks, {
		policy,
		loadSample: async () => {
			locks[0] = "#505050";
			policy.maxDeltaE = 1;
			return Uint8Array.from(image);
		},
	});
	assert.equal(result.status, "no-match");
});

test("sample validation rejects wrong length, dimensions and digest, and owns its pixel bytes", async () => {
	const original = new Uint8Array([1, 2, 3, 255]);
	const descriptor = {
		width: 1,
		height: 1,
		sha256: await colorSampleDigest(original),
	};
	const verified = await readColorSample(original, descriptor);
	original[0] = 0;
	assert.equal(verified[0], 1);
	await assert.rejects(readColorSample(original, descriptor), /digest/);
	await assert.rejects(
		readColorSample(new Uint8Array(3), descriptor),
		/dimensions/,
	);
	await assert.rejects(
		readColorSample(verified, { ...descriptor, width: 0 }),
		/descriptor/,
	);
	await assert.rejects(
		readColorSample(verified, { ...descriptor, sha256: "invalid" }),
		/descriptor/,
	);
});

test("index loader rejects malformed or incompatible data rather than treating it as no-match", () => {
	const index = indexOf(pixels([255, 0, 0]));
	const first = index.entries[0];
	const bad = [
		null,
		[],
		{},
		{ ...index, version: 1 },
		{ ...index, version: 3 },
		{ ...index, generatedAt: "invalid" },
		{ ...index, corpus: " " },
		{ ...index, entries: [null] },
		{ ...index, entries: [first, first] },
		...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((artworkId) => ({
			...index,
			entries: [{ ...first, artworkId }],
		})),
		{ ...index, entries: [{ ...first, imageId: "../outside" }] },
		{ ...index, entries: [{ ...first, sourceUpdatedAt: "invalid" }] },
		{ ...index, entries: [{ ...first, sample: null }] },
		{
			...index,
			entries: [{ ...first, sample: { ...first.sample, width: 201 } }],
		},
		{
			...index,
			entries: [{ ...first, sample: { ...first.sample, sha256: "oops" } }],
		},
		...[
			{ opaquePixels: 0, bins: [] },
			{ opaquePixels: 40001, bins: [[0, 0, 0, 40001]] },
			{ opaquePixels: 1, bins: [] },
			{ opaquePixels: 1, bins: [[0, 0, 0]] },
			{ opaquePixels: 1, bins: [["0", 0, 0, 1]] },
			{ opaquePixels: 1, bins: [[0.5, 0, 0, 1]] },
			{ opaquePixels: 1, bins: [[51, 0, 0, 1]] },
			{ opaquePixels: 1, bins: [[0, -26, 0, 1]] },
			{ opaquePixels: 1, bins: [[0, 0, 26, 1]] },
			{ opaquePixels: 1, bins: [[0, 0, 0, 0]] },
			{ opaquePixels: 1, bins: [[0, 0, 0, 2]] },
			{
				opaquePixels: 2,
				bins: [
					[0, 0, 0, 1],
					[0, 0, 0, 1],
				],
			},
		].map((signature) => ({ ...index, entries: [{ ...first, signature }] })),
	];
	for (const value of bad) assert.throws(() => readColorIndex(value));
});
