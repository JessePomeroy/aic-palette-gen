import type { Artwork } from "../api/artic";
import {
	type ColorSampleDescriptor,
	LOCKED_COLOR_MATCH_POLICY,
	srgbToOklab,
} from "./color-index";
import { readIndexedArtwork } from "./index-catalog";

/** Packaging changes only: the audited v2 pixels, bins and acceptance policy stay unchanged. */
export const SHARD_VERSION = 3;
export const TILE_EDGE = 2;
export const METADATA_PAGE_SIZE = 256;
export const COLOR_BIN_WIDTH = 0.02;
export const DIRECTORY_MAGIC = 0x33444343;
export const TILE_MAGIC = 0x33544343;
export const MAX_ARTWORKS = 1_000_000;

export interface CompressedAsset {
	bytes: number;
	compressedBytes: number;
	sha256: string;
}
export interface SamplePack {
	bytes: number;
	sha256: string;
}
export interface ShardManifest {
	version: typeof SHARD_VERSION;
	generatedAt: string;
	count: number;
	directory: CompressedAsset;
	tiles: Record<string, CompressedAsset>;
	metadata: CompressedAsset[];
	packs: SamplePack[];
}
export interface PackedSample extends ColorSampleDescriptor {
	pack: number;
	offset: number;
	compressedBytes: number;
}
export interface PackedArtwork {
	artwork: Artwork;
	sample: PackedSample;
}
export interface ArtworkDirectory {
	ids: Uint32Array;
	opaquePixels: Uint32Array;
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= min &&
		value <= max
	);
}
function digest(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function asset(value: unknown, maxBytes: number): CompressedAsset {
	if (
		!record(value) ||
		!integer(value.bytes, 1, maxBytes) ||
		!integer(value.compressedBytes, 20, maxBytes + 65536) ||
		!digest(value.sha256)
	) {
		throw new Error("Invalid compressed index asset");
	}
	return {
		bytes: value.bytes,
		compressedBytes: value.compressedBytes,
		sha256: value.sha256,
	};
}
export function tileKey(l: number, a: number, b: number): string {
	return [l, a, b].map((n) => Math.floor(n / TILE_EDGE)).join("_");
}
export function readShardManifest(value: unknown): ShardManifest {
	if (
		!record(value) ||
		value.version !== SHARD_VERSION ||
		!integer(value.count, 1, MAX_ARTWORKS) ||
		typeof value.generatedAt !== "string" ||
		!Number.isFinite(Date.parse(value.generatedAt)) ||
		!record(value.tiles) ||
		!Array.isArray(value.metadata) ||
		!Array.isArray(value.packs)
	) {
		throw new Error("Invalid sharded color index");
	}
	const directory = asset(value.directory, 8 + MAX_ARTWORKS * 8);
	if (
		directory.bytes !== 8 + value.count * 8 ||
		value.metadata.length !== Math.ceil(value.count / METADATA_PAGE_SIZE) ||
		value.packs.length < 1 ||
		value.packs.length > value.count
	)
		throw new Error("Incomplete sharded color index");
	const tiles: Record<string, CompressedAsset> = {};
	const entries = Object.entries(value.tiles);
	if (!entries.length || entries.length > 26 * 51 * 51)
		throw new Error("Invalid color tile directory");
	for (const [key, description] of entries) {
		if (!/^(?:0|[1-9]\d?)_-?(?:0|[1-9]\d?)_-?(?:0|[1-9]\d?)$/.test(key))
			throw new Error("Invalid tile address");
		const [l, a, b] = key.split("_").map(Number);
		if (
			l > 25 ||
			a < -25 ||
			a > 25 ||
			b < -25 ||
			b > 25 ||
			key !== [l, a, b].join("_")
		)
			throw new Error("Invalid tile address");
		tiles[key] = asset(description, 8 + 8 * (10 + value.count * 6));
	}
	const packs = value.packs.map((pack) => {
		if (
			!record(pack) ||
			!integer(pack.bytes, 20, 64 * 1024 * 1024) ||
			!digest(pack.sha256)
		)
			throw new Error("Invalid sample pack");
		return { bytes: pack.bytes, sha256: pack.sha256 };
	});
	return {
		version: SHARD_VERSION,
		generatedAt: value.generatedAt,
		count: value.count,
		directory,
		tiles,
		metadata: value.metadata.map((item) => asset(item, 8 * 1024 * 1024)),
		packs,
	};
}

export function readArtworkDirectory(
	bytes: Uint8Array,
	count: number,
): ArtworkDirectory {
	if (bytes.byteLength !== 8 + count * 8)
		throw new Error("Truncated artwork directory");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		view.getUint32(0, true) !== DIRECTORY_MAGIC ||
		view.getUint32(4, true) !== count
	)
		throw new Error("Wrong artwork directory version");
	const ids = new Uint32Array(count),
		opaquePixels = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		ids[i] = view.getUint32(8 + i * 8, true);
		opaquePixels[i] = view.getUint32(12 + i * 8, true);
		if (
			!ids[i] ||
			(i > 0 && ids[i] <= ids[i - 1]) ||
			opaquePixels[i] < 1 ||
			opaquePixels[i] > 40000
		)
			throw new Error("Invalid artwork directory entry");
	}
	return { ids, opaquePixels };
}

export function lockTarget(hex: string) {
	if (!/^#[a-f0-9]{6}$/i.test(hex))
		throw new Error("Choose valid locked colors");
	return srgbToOklab(
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5), 16),
	);
}
// Same triangle-inequality rounding margin as findColorCandidates; no hue pruning here.
const RETRIEVAL_RADIUS =
	LOCKED_COLOR_MATCH_POLICY.maxDeltaE +
	(Math.sqrt(3) * COLOR_BIN_WIDTH) / 2 +
	16 * Number.EPSILON;
type Target = ReturnType<typeof lockTarget>;
function near(l: number, a: number, b: number, target: Target) {
	const half = COLOR_BIN_WIDTH / 2 + 16 * Number.EPSILON;
	const center = [
		l * COLOR_BIN_WIDTH,
		a * COLOR_BIN_WIDTH,
		b * COLOR_BIN_WIDTH,
	];
	// Every original pixel lies in this rounding box. Reject only if the entire
	// box misses the distance sphere or cannot intersect the accepted hue cone.
	const distance = center.reduce(
		(sum, n, i) => sum + Math.max(0, Math.abs(n - target[i]) - half) ** 2,
		0,
	);
	if (distance > LOCKED_COLOR_MATCH_POLICY.maxDeltaE ** 2 + 16 * Number.EPSILON)
		return false;
	const chroma = Math.hypot(target[1], target[2]);
	const { minColoredChroma, minChromaRatio, maxHueDegrees } =
		LOCKED_COLOR_MATCH_POLICY;
	if (
		minColoredChroma === undefined ||
		minChromaRatio === undefined ||
		maxHueDegrees === undefined ||
		maxHueDegrees >= 90 ||
		chroma < minColoredChroma
	)
		return true;
	const maxChroma = Math.hypot(
		Math.abs(center[1]) + half,
		Math.abs(center[2]) + half,
	);
	if (maxChroma + 16 * Number.EPSILON < chroma * minChromaRatio) return false;
	const x = target[1] / chroma,
		y = target[2] / chroma;
	const tangent = Math.tan((maxHueDegrees * Math.PI) / 180);
	const maximum = (ca: number, cb: number) =>
		ca * center[1] + cb * center[2] + half * (Math.abs(ca) + Math.abs(cb));
	return (
		maximum(x, y) >= -16 * Number.EPSILON &&
		maximum(tangent * x + y, tangent * y - x) >= -16 * Number.EPSILON &&
		maximum(tangent * x - y, tangent * y + x) >= -16 * Number.EPSILON
	);
}
export function tilesForLock(hex: string, manifest: ShardManifest): string[] {
	const target = lockTarget(hex);
	const keys = new Set<string>();
	const low = target.map((n) =>
		Math.ceil((n - RETRIEVAL_RADIUS) / COLOR_BIN_WIDTH),
	);
	const high = target.map((n) =>
		Math.floor((n + RETRIEVAL_RADIUS) / COLOR_BIN_WIDTH),
	);
	for (let l = Math.max(0, low[0]); l <= Math.min(50, high[0]); l++) {
		for (let a = Math.max(-50, low[1]); a <= Math.min(50, high[1]); a++) {
			for (let b = Math.max(-50, low[2]); b <= Math.min(50, high[2]); b++) {
				const key = tileKey(l, a, b);
				if (manifest.tiles[key] && near(l, a, b, target)) keys.add(key);
			}
		}
	}
	return [...keys];
}

/** Add exact histogram counts without allocating millions of posting objects. */
export function addTileCoverage(
	bytes: Uint8Array,
	key: string,
	directory: ArtworkDirectory,
	hex: string,
	counts: Uint32Array,
): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 8 || view.getUint32(0, true) !== TILE_MAGIC)
		throw new Error("Wrong color tile version");
	const cells = view.getUint32(4, true),
		target = lockTarget(hex);
	if (
		cells < 1 ||
		cells > TILE_EDGE ** 3 ||
		counts.length !== directory.ids.length
	)
		throw new Error("Invalid color tile");
	const seen = new Set<string>();
	let offset = 8;
	for (let i = 0; i < cells; i++) {
		if (offset + 10 > bytes.length) throw new Error("Truncated color tile");
		const l = view.getInt16(offset, true),
			a = view.getInt16(offset + 2, true),
			b = view.getInt16(offset + 4, true),
			postings = view.getUint32(offset + 6, true);
		offset += 10;
		const cell = `${l},${a},${b}`;
		if (
			l < 0 ||
			l > 50 ||
			Math.abs(a) > 50 ||
			Math.abs(b) > 50 ||
			tileKey(l, a, b) !== key ||
			seen.has(cell) ||
			!postings ||
			postings > directory.ids.length ||
			offset + postings * 6 > bytes.length
		)
			throw new Error("Invalid tile postings");
		seen.add(cell);
		const include = near(l, a, b, target);
		let previous = -1;
		for (let j = 0; j < postings; j++) {
			const ordinal = view.getUint32(offset, true),
				pixels = view.getUint16(offset + 4, true);
			offset += 6;
			if (
				ordinal <= previous ||
				ordinal >= directory.ids.length ||
				!pixels ||
				pixels > directory.opaquePixels[ordinal]
			)
				throw new Error("Invalid color posting");
			previous = ordinal;
			if (include) {
				counts[ordinal] += pixels;
				if (counts[ordinal] > directory.opaquePixels[ordinal])
					throw new Error("Inconsistent color coverage");
			}
		}
	}
	if (offset !== bytes.length) throw new Error("Trailing color tile data");
}

export function readMetadataPage(
	value: unknown,
	page: number,
	manifest: ShardManifest,
	directory: ArtworkDirectory,
): PackedArtwork[] {
	const start = page * METADATA_PAGE_SIZE;
	if (
		!Array.isArray(value) ||
		value.length !== Math.min(METADATA_PAGE_SIZE, manifest.count - start)
	)
		throw new Error("Incomplete artwork metadata page");
	return value.map((row, offset) => {
		if (!record(row) || !record(row.sample))
			throw new Error("Invalid packed artwork");
		const artwork = readIndexedArtwork(row.artwork),
			s = row.sample;
		if (
			artwork.id !== directory.ids[start + offset] ||
			!integer(s.width, 1, 200) ||
			!integer(s.height, 1, 200) ||
			!digest(s.sha256) ||
			!integer(s.pack, 0, manifest.packs.length - 1) ||
			!integer(s.offset, 0, manifest.packs[s.pack].bytes - 1) ||
			!integer(s.compressedBytes, 20, 161000) ||
			s.offset + s.compressedBytes > manifest.packs[s.pack].bytes ||
			s.width * s.height < directory.opaquePixels[start + offset]
		)
			throw new Error("Invalid packed sample descriptor");
		return {
			artwork,
			sample: {
				width: s.width,
				height: s.height,
				sha256: s.sha256,
				pack: s.pack,
				offset: s.offset,
				compressedBytes: s.compressedBytes,
			},
		};
	});
}
