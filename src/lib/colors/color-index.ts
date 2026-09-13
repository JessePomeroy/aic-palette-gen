/**
 * Version 2 freezes 200px-or-smaller sRGB RGBA samples alongside their Oklab
 * histograms. Retrieval accounts for bin rounding; acceptance checks the exact
 * saved pixels. Browsers must not decode/resize the museum JPEG again to verify.
 */
export const COLOR_INDEX_VERSION = 2;
export const COLOR_SAMPLE_SIZE = 200;
const BIN_WIDTH = 0.02;
const MAX_PIXELS = COLOR_SAMPLE_SIZE ** 2;

type Oklab = readonly [lightness: number, a: number, b: number];
type ColorBin = readonly [
	lightness: number,
	a: number,
	b: number,
	count: number,
];

export interface ColorSignature {
	readonly opaquePixels: number;
	readonly bins: readonly ColorBin[];
}

export interface IndexedArtwork {
	readonly artworkId: number;
	readonly imageId: string;
	readonly sourceUpdatedAt: string | null;
	readonly signature: ColorSignature;
	readonly sample: ColorSampleDescriptor;
}

export interface ColorSampleDescriptor {
	readonly width: number;
	readonly height: number;
	readonly sha256: string;
}

export interface ColorIndex {
	readonly version: typeof COLOR_INDEX_VERSION;
	readonly generatedAt: string;
	readonly corpus: string;
	readonly entries: readonly IndexedArtwork[];
}

export interface ColorMatchPolicy {
	readonly maxDeltaE: number;
	readonly minCoverage: number;
	/** Specify all three together to protect colored locks from neutral matches. */
	readonly minColoredChroma?: number;
	readonly minChromaRatio?: number;
	readonly maxHueDegrees?: number;
}

/** Experimental starting values, pending real-artwork calibration. */
export const DEFAULT_COLOR_MATCH_POLICY: ColorMatchPolicy = Object.freeze({
	maxDeltaE: 0.05,
	minCoverage: 0.01,
});

/** App policy: whole-image matching, including backgrounds, frames and cases. */
export const LOCKED_COLOR_MATCH_POLICY: ColorMatchPolicy = Object.freeze({
	maxDeltaE: 0.03,
	minCoverage: 0.01,
	minColoredChroma: 0.015,
	minChromaRatio: 0.5,
	maxHueDegrees: 25,
});

export interface ColorMatch {
	readonly matches: boolean;
	readonly locks: readonly {
		hex: string;
		coverage: number;
		nearestDistance: number | null;
	}[];
}

interface SearchCounts {
	/** Possible matches, not a count of verified artworks. Excludes current ID. */
	candidateCount: number;
	checkedCount: number;
	unavailableCount: number;
}

export type IndexedArtworkResult = SearchCounts &
	(
		| {
				status: "match";
				entry: IndexedArtwork;
				match: ColorMatch;
				repeated: boolean;
		  }
		| { status: "no-match" }
		| { status: "incomplete"; reason: "limit" | "unavailable" }
	);

/** Hash an owned snapshot, shared by the offline builder and browser verifier. */
export async function colorSampleDigest(pixels: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(pixels));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Wrong-version, truncated, or stale samples fail as unavailable, never no-match. */
export async function readColorSample(
	bytes: Uint8Array,
	descriptor: ColorSampleDescriptor,
): Promise<Uint8Array> {
	const sample = readSampleDescriptor(descriptor);
	if (bytes.length !== sample.width * sample.height * 4)
		throw new Error("Color sample dimensions do not match its bytes");
	const pixels = Uint8Array.from(bytes);
	if ((await colorSampleDigest(pixels)) !== sample.sha256)
		throw new Error("Color sample digest does not match the index");
	return pixels;
}

// Björn Ottosson's public-domain linear-sRGB -> Oklab matrices:
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
export function srgbToOklab(red: number, green: number, blue: number): Oklab {
	const linearize = (channel: number) => {
		const encoded = channel / 255;
		return encoded <= 0.04045
			? encoded / 12.92
			: ((encoded + 0.055) / 1.055) ** 2.4;
	};
	const r = linearize(red);
	const g = linearize(green);
	const b = linearize(blue);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function targetsFor(hexes: readonly string[]) {
	return hexes.map((hex) => {
		if (!/^#[0-9a-f]{6}$/i.test(hex))
			throw new Error("Locked colors must be six-digit hex values");
		return {
			hex,
			lab: srgbToOklab(
				Number.parseInt(hex.slice(1, 3), 16),
				Number.parseInt(hex.slice(3, 5), 16),
				Number.parseInt(hex.slice(5, 7), 16),
			),
		};
	});
}

function validatePolicy(policy: ColorMatchPolicy) {
	if (
		!Number.isFinite(policy.maxDeltaE) ||
		policy.maxDeltaE < 0 ||
		policy.maxDeltaE > 1 ||
		!Number.isFinite(policy.minCoverage) ||
		policy.minCoverage <= 0 ||
		policy.minCoverage > 1
	)
		throw new Error("Invalid color-match policy");
	const { minColoredChroma, minChromaRatio, maxHueDegrees } = policy;
	if (
		minColoredChroma !== undefined ||
		minChromaRatio !== undefined ||
		maxHueDegrees !== undefined
	) {
		if (
			minColoredChroma === undefined ||
			!Number.isFinite(minColoredChroma) ||
			minColoredChroma <= 0 ||
			minColoredChroma > 1 ||
			minChromaRatio === undefined ||
			!Number.isFinite(minChromaRatio) ||
			minChromaRatio <= 0 ||
			minChromaRatio > 1 ||
			maxHueDegrees === undefined ||
			!Number.isFinite(maxHueDegrees) ||
			maxHueDegrees < 0 ||
			maxHueDegrees > 180
		)
			throw new Error("Invalid color-match hue/chroma policy");
	}
}

function colorGate(policy: ColorMatchPolicy) {
	const { minColoredChroma, minChromaRatio, maxHueDegrees } = policy;
	if (
		minColoredChroma === undefined ||
		minChromaRatio === undefined ||
		maxHueDegrees === undefined
	)
		return (_sample: Oklab, _target: Oklab) => true;
	const cosine = Math.cos((maxHueDegrees * Math.PI) / 180);
	return (sample: Oklab, target: Oklab) => {
		const targetChroma = Math.hypot(target[1], target[2]);
		if (targetChroma < minColoredChroma) return true;
		const sampleChroma = Math.hypot(sample[1], sample[2]);
		return (
			sampleChroma >= targetChroma * minChromaRatio &&
			sample[1] * target[1] + sample[2] * target[2] >=
				sampleChroma * targetChroma * cosine
		);
	};
}

/** Input is decoded sRGB RGBA, downscaled by the caller to at most 200 x 200. */
export function analyzeColorSignature(
	pixels: Uint8Array | Uint8ClampedArray,
): ColorSignature {
	if (pixels.length % 4 !== 0 || pixels.length > MAX_PIXELS * 4)
		throw new Error("Expected a complete RGBA sample of at most 40,000 pixels");
	const counts = new Map<string, [number, number, number, number]>();
	let opaquePixels = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] < 128) continue;
		opaquePixels++;
		const lab = srgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]);
		const l = Math.round(lab[0] / BIN_WIDTH);
		const a = Math.round(lab[1] / BIN_WIDTH) || 0;
		const b = Math.round(lab[2] / BIN_WIDTH) || 0;
		const key = `${l},${a},${b}`;
		const bin = counts.get(key);
		if (bin) bin[3]++;
		else counts.set(key, [l, a, b, 1]);
	}
	return {
		opaquePixels,
		bins: [...counts.values()].sort(
			(left, right) =>
				left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
		),
	};
}

function evaluateSignature(
	signature: ColorSignature,
	targets: ReturnType<typeof targetsFor>,
	policy: ColorMatchPolicy,
): ColorMatch {
	const acceptsColor = colorGate(policy);
	const locks = targets.map(({ hex, lab }) => {
		let matchingPixels = 0;
		let nearestSquared = Number.POSITIVE_INFINITY;
		for (const [l, a, b, count] of signature.bins) {
			const squared =
				(l * BIN_WIDTH - lab[0]) ** 2 +
				(a * BIN_WIDTH - lab[1]) ** 2 +
				(b * BIN_WIDTH - lab[2]) ** 2;
			nearestSquared = Math.min(nearestSquared, squared);
			if (
				squared <= policy.maxDeltaE ** 2 &&
				acceptsColor([l * BIN_WIDTH, a * BIN_WIDTH, b * BIN_WIDTH], lab)
			)
				matchingPixels += count;
		}
		return {
			hex,
			coverage: signature.opaquePixels
				? matchingPixels / signature.opaquePixels
				: 0,
			nearestDistance: Number.isFinite(nearestSquared)
				? Math.sqrt(nearestSquared)
				: null,
		};
	});
	return {
		matches:
			signature.opaquePixels > 0 &&
			locks.every((lock) => lock.coverage >= policy.minCoverage),
		locks,
	};
}

/**
 * Verify decoded sRGB pixels without histogram rounding. Coverage is exact for
 * this supplied sample, not a guarantee about a higher-resolution original.
 * The caller controls image loading, resizing, and where this CPU work runs.
 */
export function matchColorPixels(
	pixels: Uint8Array | Uint8ClampedArray,
	hexes: readonly string[],
	policy: ColorMatchPolicy = DEFAULT_COLOR_MATCH_POLICY,
): ColorMatch {
	validatePolicy(policy);
	if (pixels.length % 4 !== 0)
		throw new Error("Expected a complete RGBA sample");
	const targets = targetsFor(hexes);
	const counts = targets.map(() => 0);
	const nearest = targets.map(() => Number.POSITIVE_INFINITY);
	let opaquePixels = 0;
	const limitSquared = policy.maxDeltaE ** 2;
	const acceptsColor = colorGate(policy);
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] < 128) continue;
		opaquePixels++;
		const sample = srgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]);
		for (let t = 0; t < targets.length; t++) {
			const target = targets[t].lab;
			const squared =
				(sample[0] - target[0]) ** 2 +
				(sample[1] - target[1]) ** 2 +
				(sample[2] - target[2]) ** 2;
			nearest[t] = Math.min(nearest[t], squared);
			if (squared <= limitSquared && acceptsColor(sample, target)) counts[t]++;
		}
	}
	const locks = targets.map(({ hex }, t) => ({
		hex,
		coverage: opaquePixels ? counts[t] / opaquePixels : 0,
		nearestDistance: Number.isFinite(nearest[t]) ? Math.sqrt(nearest[t]) : null,
	}));
	return {
		matches:
			opaquePixels > 0 &&
			locks.every((lock) => lock.coverage >= policy.minCoverage),
		locks,
	};
}

/** Every lock must pass independently. Policy never changes during a search. */
export function matchColorSignature(
	signature: ColorSignature,
	hexes: readonly string[],
	policy: ColorMatchPolicy = DEFAULT_COLOR_MATCH_POLICY,
): ColorMatch {
	validatePolicy(policy);
	return evaluateSignature(signature, targetsFor(hexes), policy);
}

/**
 * Conservative retrieval: never discard a strict pixel match on the SAME
 * sample because of bin rounding. This is not permission to accept a looser
 * match. The triangle-inequality margin covers quantization, not preprocessing.
 */
export function findColorCandidates(
	index: ColorIndex,
	hexes: readonly string[],
	policy: ColorMatchPolicy = DEFAULT_COLOR_MATCH_POLICY,
): readonly IndexedArtwork[] {
	validatePolicy(policy);
	const targets = targetsFor(hexes);
	const retrievalPolicy = {
		// Ignore hue/chroma here: rounded bins must never hide a strict pixel match.
		maxDeltaE:
			policy.maxDeltaE + (Math.sqrt(3) * BIN_WIDTH) / 2 + 16 * Number.EPSILON,
		minCoverage: policy.minCoverage,
	};
	return index.entries.filter(
		(entry) =>
			evaluateSignature(entry.signature, targets, retrievalPolicy).matches,
	);
}

/**
 * Sample candidates without replacement, unseen IDs first. Only strict pixel
 * verification may return a match. The loader must honor its abort signal and
 * return the saved RGBA bytes at samples/{sha256}.rgba, not a decoded new JPEG.
 */
export async function findIndexedArtwork(
	index: ColorIndex,
	hexes: readonly string[],
	options: {
		loadSample: (
			entry: IndexedArtwork,
			signal: AbortSignal,
		) => Promise<Uint8Array>;
		signal?: AbortSignal;
		currentArtworkId?: number;
		seenArtworkIds?: readonly number[];
		policy?: ColorMatchPolicy;
		random?: () => number;
		maxChecks?: number;
		onProgress?: (checked: number, candidates: number) => void;
	},
): Promise<IndexedArtworkResult> {
	const signal = options.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	// Snapshot caller state before awaiting image bytes.
	const policy = { ...(options.policy ?? DEFAULT_COLOR_MATCH_POLICY) };
	const locks = [...hexes];
	const maxChecks = options.maxChecks ?? 16;
	if (!Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 2500)
		throw new Error("maxChecks must be an integer from 1 to 2500");
	const candidates = findColorCandidates(index, locks, policy).filter(
		(entry) => entry.artworkId !== options.currentArtworkId,
	);
	const seen = new Set(options.seenArtworkIds);
	const pools = [
		candidates.filter((entry) => !seen.has(entry.artworkId)),
		candidates.filter((entry) => seen.has(entry.artworkId)),
	];
	const counts: SearchCounts = {
		candidateCount: candidates.length,
		checkedCount: 0,
		unavailableCount: 0,
	};
	for (const pool of pools) {
		while (pool.length) {
			signal.throwIfAborted();
			if (counts.checkedCount >= maxChecks)
				return { status: "incomplete", reason: "limit", ...counts };
			const random = (options.random ?? Math.random)();
			if (!Number.isFinite(random) || random < 0 || random >= 1)
				throw new Error("Random source must return a number in [0, 1)");
			const chosen = Math.floor(random * pool.length);
			const entry = pool[chosen];
			pool[chosen] = pool[pool.length - 1];
			pool.pop();
			counts.checkedCount++;
			let pixels: Uint8Array;
			try {
				const sampleSignal = AbortSignal.any([
					signal,
					AbortSignal.timeout(5000),
				]);
				const bytes = await options.loadSample(entry, sampleSignal);
				sampleSignal.throwIfAborted();
				pixels = await readColorSample(bytes, entry.sample);
				sampleSignal.throwIfAborted();
			} catch {
				signal.throwIfAborted();
				counts.unavailableCount++;
				options.onProgress?.(counts.checkedCount, counts.candidateCount);
				signal.throwIfAborted();
				continue;
			}
			signal.throwIfAborted();
			const match = matchColorPixels(pixels, locks, policy);
			options.onProgress?.(counts.checkedCount, counts.candidateCount);
			signal.throwIfAborted();
			if (match.matches)
				return {
					status: "match",
					entry,
					match,
					repeated: seen.has(entry.artworkId),
					...counts,
				};
		}
	}
	return counts.unavailableCount
		? { status: "incomplete", reason: "unavailable", ...counts }
		: { status: "no-match", ...counts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function readSampleDescriptor(value: unknown): ColorSampleDescriptor {
	if (
		!isRecord(value) ||
		!isInteger(value.width) ||
		!isInteger(value.height) ||
		value.width < 1 ||
		value.height < 1 ||
		value.width > COLOR_SAMPLE_SIZE ||
		value.height > COLOR_SAMPLE_SIZE ||
		typeof value.sha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(value.sha256)
	)
		throw new Error("Invalid color sample descriptor");
	return { width: value.width, height: value.height, sha256: value.sha256 };
}

function readSignature(value: unknown): ColorSignature {
	if (
		!isRecord(value) ||
		typeof value.opaquePixels !== "number" ||
		!Number.isInteger(value.opaquePixels) ||
		value.opaquePixels <= 0 ||
		value.opaquePixels > MAX_PIXELS ||
		!Array.isArray(value.bins) ||
		value.bins.length > value.opaquePixels
	)
		throw new Error("Invalid color signature");
	const seen = new Set<string>();
	const bins: ColorBin[] = [];
	let total = 0;
	for (const row of value.bins) {
		if (!Array.isArray(row) || row.length !== 4)
			throw new Error("Invalid histogram bin");
		const [l, a, b, count]: unknown[] = row;
		if (!isInteger(l) || !isInteger(a) || !isInteger(b) || !isInteger(count))
			throw new Error("Invalid histogram bin");
		const key = `${l},${a},${b}`;
		if (
			l < 0 ||
			l > 50 ||
			Math.abs(a) > 25 ||
			Math.abs(b) > 25 ||
			count <= 0 ||
			count > value.opaquePixels ||
			seen.has(key)
		)
			throw new Error("Invalid or duplicate histogram bin");
		seen.add(key);
		total += count;
		bins.push([l, a, b, count]);
	}
	if (total !== value.opaquePixels)
		throw new Error("Histogram populations do not match the sample size");
	return { opaquePixels: value.opaquePixels, bins };
}

/** Validate JSON once at the loading seam; queries accept the resulting index. */
export function readColorIndex(value: unknown): ColorIndex {
	if (
		!isRecord(value) ||
		value.version !== COLOR_INDEX_VERSION ||
		!isTimestamp(value.generatedAt) ||
		typeof value.corpus !== "string" ||
		!value.corpus.trim() ||
		!Array.isArray(value.entries)
	)
		throw new Error("Invalid or unsupported color index");
	const ids = new Set<number>();
	const entries: IndexedArtwork[] = [];
	for (const entry of value.entries) {
		if (
			!isRecord(entry) ||
			typeof entry.artworkId !== "number" ||
			!Number.isSafeInteger(entry.artworkId) ||
			entry.artworkId <= 0 ||
			ids.has(entry.artworkId) ||
			typeof entry.imageId !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				entry.imageId,
			) ||
			!(entry.sourceUpdatedAt === null || isTimestamp(entry.sourceUpdatedAt))
		)
			throw new Error("Invalid or duplicate indexed artwork");
		ids.add(entry.artworkId);
		const signature = readSignature(entry.signature);
		const sample = readSampleDescriptor(entry.sample);
		if (signature.opaquePixels > sample.width * sample.height)
			throw new Error("Color signature exceeds its sample dimensions");
		entries.push({
			artworkId: entry.artworkId,
			imageId: entry.imageId,
			sourceUpdatedAt: entry.sourceUpdatedAt,
			signature,
			sample,
		});
	}
	return {
		version: COLOR_INDEX_VERSION,
		generatedAt: value.generatedAt,
		corpus: value.corpus,
		entries,
	};
}
