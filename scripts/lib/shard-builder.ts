import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Artwork } from "../../src/lib/api/artic";
import {
	type IndexedArtwork,
	readColorIndex,
	readColorSample,
} from "../../src/lib/colors/color-index";
import {
	type CompressedAsset,
	DIRECTORY_MAGIC,
	MAX_ARTWORKS,
	METADATA_PAGE_SIZE,
	type PackedArtwork,
	readShardManifest,
	type SamplePack,
	SHARD_VERSION,
	type ShardManifest,
	TILE_MAGIC,
	tileKey,
} from "../../src/lib/colors/color-shards";
import { readIndexedArtwork } from "../../src/lib/colors/index-catalog";

export interface AuditedEntry {
	artwork: Artwork;
	entry: IndexedArtwork;
	compressedSample: Uint8Array;
}
export const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

/** Repackage audited evidence; never decode source JPEGs or change color acceptance. */
export async function writeShardRelease(
	input: AsyncIterable<AuditedEntry>,
	count: number,
	generatedAt: string,
	write: (path: string, bytes: Uint8Array) => Promise<void>,
): Promise<ShardManifest> {
	if (!Number.isSafeInteger(count) || count < 1 || count > MAX_ARTWORKS)
		throw new Error("Invalid release size");
	const directory = Buffer.alloc(8 + count * 8);
	directory.writeUInt32LE(DIRECTORY_MAGIC, 0);
	directory.writeUInt32LE(count, 4);
	const tiles = new Map<string, Map<string, number[]>>();
	const metadata: PackedArtwork[] = [];
	const samples = new Map<
		string,
		{ pack: number; offset: number; compressedBytes: number }
	>();
	const packs: SamplePack[] = [];
	let packParts: Uint8Array[] = [],
		packBytes = 0,
		ordinal = 0,
		previousId = 0;
	async function flushPack() {
		if (!packParts.length) return;
		const bytes = Buffer.concat(packParts);
		await write(`samples/${packs.length}.pack`, bytes);
		packs.push({ bytes: bytes.length, sha256: sha256(bytes) });
		packParts = [];
		packBytes = 0;
	}
	for await (const source of input) {
		const artwork = readIndexedArtwork(source.artwork);
		const entry = readColorIndex({
			version: 2,
			generatedAt,
			corpus: "audited full scan",
			entries: [source.entry],
		}).entries[0];
		if (
			ordinal >= count ||
			artwork.id <= previousId ||
			artwork.id > 0xffffffff ||
			artwork.id !== entry.artworkId ||
			artwork.image_id !== entry.imageId ||
			!entry.signature.opaquePixels
		)
			throw new Error("Audited index identities do not agree");
		previousId = artwork.id;
		const pixels = gunzipSync(source.compressedSample, {
			maxOutputLength: 160000,
		});
		await readColorSample(pixels, entry.sample);
		let location = samples.get(entry.sample.sha256);
		if (!location) {
			if (
				packParts.length >= 256 ||
				packBytes + source.compressedSample.length > 32 * 1024 * 1024
			)
				await flushPack();
			location = {
				pack: packs.length,
				offset: packBytes,
				compressedBytes: source.compressedSample.length,
			};
			packParts.push(source.compressedSample);
			packBytes += source.compressedSample.length;
			samples.set(entry.sample.sha256, location);
		}
		directory.writeUInt32LE(artwork.id, 8 + ordinal * 8);
		directory.writeUInt32LE(entry.signature.opaquePixels, 12 + ordinal * 8);
		metadata.push({ artwork, sample: { ...entry.sample, ...location } });
		for (const [l, a, b, pixels] of entry.signature.bins) {
			const key = tileKey(l, a, b),
				cell = `${l},${a},${b}`;
			let tile = tiles.get(key);
			if (!tile) {
				tile = new Map();
				tiles.set(key, tile);
			}
			let postings = tile.get(cell);
			if (!postings) {
				postings = [];
				tile.set(cell, postings);
			}
			postings.push(ordinal, pixels);
		}
		ordinal++;
	}
	if (ordinal !== count)
		throw new Error("Audited artwork count does not match release");
	await flushPack();
	async function compressed(
		path: string,
		bytes: Uint8Array,
	): Promise<CompressedAsset> {
		const packed = gzipSync(bytes, { level: 9 });
		await write(path, packed);
		return {
			bytes: bytes.length,
			compressedBytes: packed.length,
			sha256: sha256(bytes),
		};
	}
	const manifest: ShardManifest = {
		version: SHARD_VERSION,
		generatedAt,
		count,
		directory: await compressed("directory.bin.gz", directory),
		tiles: {},
		metadata: [],
		packs,
	};
	for (const key of [...tiles.keys()].sort()) {
		const cells = tiles.get(key);
		if (!cells) throw new Error("Missing release tile");
		const size =
			8 +
			[...cells.values()].reduce(
				(total, postings) => total + 10 + postings.length * 3,
				0,
			);
		const bytes = Buffer.alloc(size);
		bytes.writeUInt32LE(TILE_MAGIC, 0);
		bytes.writeUInt32LE(cells.size, 4);
		let offset = 8;
		for (const [cell, postings] of [...cells].sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			const [l, a, b] = cell.split(",").map(Number);
			bytes.writeInt16LE(l, offset);
			bytes.writeInt16LE(a, offset + 2);
			bytes.writeInt16LE(b, offset + 4);
			bytes.writeUInt32LE(postings.length / 2, offset + 6);
			offset += 10;
			for (let i = 0; i < postings.length; i += 2) {
				bytes.writeUInt32LE(postings[i], offset);
				bytes.writeUInt16LE(postings[i + 1], offset + 4);
				offset += 6;
			}
		}
		manifest.tiles[key] = await compressed(`tiles/${key}.bin.gz`, bytes);
		// The large posting arrays have served their purpose; release them as we encode.
		tiles.delete(key);
	}
	for (let start = 0; start < metadata.length; start += METADATA_PAGE_SIZE) {
		manifest.metadata.push(
			await compressed(
				`metadata/${start / METADATA_PAGE_SIZE}.json.gz`,
				Buffer.from(
					JSON.stringify(metadata.slice(start, start + METADATA_PAGE_SIZE)),
				),
			),
		);
	}
	readShardManifest(manifest);
	// Last write is the publication marker. Incomplete builds have no manifest.
	await write("manifest.json", Buffer.from(JSON.stringify(manifest)));
	return manifest;
}
