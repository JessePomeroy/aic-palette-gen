import type { Artwork } from "../api/artic";
import {
	colorSampleDigest,
	LOCKED_COLOR_MATCH_POLICY,
	matchColorPixels,
	readColorSample,
} from "./color-index";
import {
	type ArtworkDirectory,
	addTileCoverage,
	type CompressedAsset,
	lockTarget,
	METADATA_PAGE_SIZE,
	type PackedArtwork,
	readArtworkDirectory,
	readMetadataPage,
	readShardManifest,
	type ShardManifest,
	tilesForLock,
} from "./color-shards";

export const COLOR_INDEX_RELEASE_PATH = "/color-index/release.json";
const ASSET_CACHE_BYTES = 16 * 1024 * 1024;
const SAMPLE_CACHE_LIMIT = 32;
const MAX_CHECKS = 2500;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
class DownloadLimit extends Error {}
interface DownloadBudget {
	remaining: number;
}
interface SearchCounts {
	indexedCount: number;
	candidateCount: number;
	checkedCount: number;
	unavailableCount: number;
}
export type ShardedSearchResult = SearchCounts &
	(
		| { status: "match"; artwork: Artwork; repeated: boolean }
		| { status: "no-match" }
		| { status: "incomplete"; reason: "limit" | "unavailable" }
	);
interface Catalog {
	root: string;
	manifest: ShardManifest;
	directory: ArtworkDirectory;
}

async function readLimited(
	stream: ReadableStream<Uint8Array> | null,
	max: number,
	signal: AbortSignal,
): Promise<Uint8Array> {
	if (!stream) throw new Error("Index response has no body");
	const reader = stream.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.length;
			if (size > max) throw new Error("Index asset exceeds its declared size");
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
async function unzip(bytes: Uint8Array, max: number, signal: AbortSignal) {
	const stream = new Blob([Uint8Array.from(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return readLimited(stream, max, signal);
}
function parse(bytes: Uint8Array): unknown {
	return JSON.parse(new TextDecoder().decode(bytes));
}
function release(value: unknown): { root: string; sha256: string } {
	if (
		!value ||
		typeof value !== "object" ||
		!("root" in value) ||
		typeof value.root !== "string" ||
		!("sha256" in value) ||
		typeof value.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.sha256)
	)
		throw new Error("Invalid color release pointer");
	const url = new URL(value.root, "https://local.invalid");
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		value.root.length > 2048 ||
		value.root.endsWith("/") ||
		!(
			value.root.startsWith("https://") ||
			/^\/color-index\/[a-z0-9/-]+$/.test(value.root)
		)
	)
		throw new Error("Invalid color release location");
	return { root: value.root, sha256: value.sha256 };
}

/** The workbench still asks one question. Packaging, bounded downloads and verification stay here. */
export function createIndexedSearch(fetcher: typeof fetch = fetch) {
	let catalog: Catalog | undefined;
	const assets = new Map<string, Uint8Array>(),
		samples = new Map<string, Uint8Array>(),
		metadata = new Map<number, PackedArtwork[]>();
	let assetBytes = 0;
	async function fetchBytes(
		url: string,
		limit: number,
		signal: AbortSignal,
		budget: DownloadBudget,
		headers?: HeadersInit,
	) {
		if (limit > budget.remaining)
			throw new DownloadLimit("Color search download limit reached");
		budget.remaining -= limit;
		const response = await fetcher(url, {
			signal,
			cache: url === COLOR_INDEX_RELEASE_PATH ? "no-cache" : "force-cache",
			credentials: "omit",
			headers,
		});
		if (!response.ok) throw new Error("Color index asset unavailable");
		const bytes = await readLimited(response.body, limit, signal);
		budget.remaining += limit - bytes.length;
		return { response, bytes };
	}
	async function compressed(
		root: string,
		path: string,
		descriptor: CompressedAsset,
		signal: AbortSignal,
		budget: DownloadBudget,
	) {
		const key = `${root}/${path}`,
			cached = assets.get(key);
		if (cached) {
			assets.delete(key);
			assets.set(key, cached);
			return cached;
		}
		const { bytes: encoded } = await fetchBytes(
			key,
			descriptor.compressedBytes,
			signal,
			budget,
		);
		if (encoded.length !== descriptor.compressedBytes)
			throw new Error("Truncated compressed index asset");
		const bytes = await unzip(encoded, descriptor.bytes, signal);
		if (
			bytes.length !== descriptor.bytes ||
			(await colorSampleDigest(bytes)) !== descriptor.sha256
		)
			throw new Error("Color index checksum mismatch");
		signal.throwIfAborted();
		if (bytes.length <= ASSET_CACHE_BYTES) {
			while (assetBytes + bytes.length > ASSET_CACHE_BYTES && assets.size) {
				const oldest = assets.keys().next().value;
				if (oldest === undefined) break;
				assetBytes -= assets.get(oldest)?.length ?? 0;
				assets.delete(oldest);
			}
			assetBytes -= assets.get(key)?.length ?? 0;
			assets.set(key, bytes);
			assetBytes += bytes.length;
		}
		return bytes;
	}
	async function loadCatalog(
		signal: AbortSignal,
		budget: DownloadBudget,
	): Promise<Catalog> {
		signal.throwIfAborted();
		if (catalog) return catalog;
		const pointer = release(
			parse(
				(await fetchBytes(COLOR_INDEX_RELEASE_PATH, 4096, signal, budget))
					.bytes,
			),
		);
		const manifestBytes = (
			await fetchBytes(
				`${pointer.root}/manifest.json`,
				2 * 1024 * 1024,
				signal,
				budget,
			)
		).bytes;
		if ((await colorSampleDigest(manifestBytes)) !== pointer.sha256)
			throw new Error("Color release checksum mismatch");
		const manifest = readShardManifest(parse(manifestBytes));
		const directory = readArtworkDirectory(
			await compressed(
				pointer.root,
				"directory.bin.gz",
				manifest.directory,
				signal,
				budget,
			),
			manifest.count,
		);
		signal.throwIfAborted();
		catalog = { root: pointer.root, manifest, directory };
		return catalog;
	}
	async function artworkAt(
		ordinal: number,
		data: Catalog,
		signal: AbortSignal,
		budget: DownloadBudget,
	) {
		const page = Math.floor(ordinal / METADATA_PAGE_SIZE);
		let rows = metadata.get(page);
		if (!rows) {
			rows = readMetadataPage(
				parse(
					await compressed(
						data.root,
						`metadata/${page}.json.gz`,
						data.manifest.metadata[page],
						signal,
						budget,
					),
				),
				page,
				data.manifest,
				data.directory,
			);
			signal.throwIfAborted();
			if (metadata.size >= 8) {
				const oldest = metadata.keys().next().value;
				if (oldest !== undefined) metadata.delete(oldest);
			}
		} else metadata.delete(page);
		metadata.set(page, rows);
		return rows[ordinal % METADATA_PAGE_SIZE];
	}
	async function pixelsFor(
		row: PackedArtwork,
		data: Catalog,
		signal: AbortSignal,
		budget: DownloadBudget,
	) {
		const sample = row.sample,
			cached = samples.get(sample.sha256);
		if (cached) {
			samples.delete(sample.sha256);
			samples.set(sample.sha256, cached);
			return cached;
		}
		const end = sample.offset + sample.compressedBytes - 1;
		const { response, bytes } = await fetchBytes(
			`${data.root}/samples/${sample.pack}.pack`,
			sample.compressedBytes,
			signal,
			budget,
			{ Range: `bytes=${sample.offset}-${end}` },
		);
		if (
			response.status !== 206 ||
			response.headers.get("content-range") !==
				`bytes ${sample.offset}-${end}/${data.manifest.packs[sample.pack].bytes}` ||
			bytes.length !== sample.compressedBytes
		)
			throw new Error("Sample range does not match the release");
		const pixels = await readColorSample(
			await unzip(bytes, sample.width * sample.height * 4, signal),
			sample,
		);
		signal.throwIfAborted();
		if (samples.size >= SAMPLE_CACHE_LIMIT) {
			const oldest = samples.keys().next().value;
			if (oldest !== undefined) samples.delete(oldest);
		}
		samples.set(sample.sha256, pixels);
		return pixels;
	}
	return {
		async search(
			hexes: readonly string[],
			options: {
				signal: AbortSignal;
				currentArtworkId?: number;
				seenArtworkIds?: readonly number[];
				onIndexReady?: (count: number) => void;
				onProgress?: (checked: number, candidates: number) => void;
			},
		): Promise<ShardedSearchResult> {
			const locks = [...hexes],
				{ signal, currentArtworkId, onIndexReady, onProgress } = options;
			const seen = new Set(options.seenArtworkIds);
			if (!locks.length || locks.length > 8)
				throw new Error("Choose one to eight valid locked colors");
			for (const hex of locks) lockTarget(hex);
			const budget: DownloadBudget = { remaining: MAX_DOWNLOAD_BYTES };
			const counts: SearchCounts = {
				indexedCount: catalog?.manifest.count ?? 0,
				candidateCount: 0,
				checkedCount: 0,
				unavailableCount: 0,
			};
			try {
				const data = await loadCatalog(signal, budget),
					{ manifest, directory } = data;
				counts.indexedCount = manifest.count;
				onIndexReady?.(manifest.count);
				const eligible = new Uint8Array(manifest.count).fill(1);
				for (let i = 0; i < manifest.count; i++)
					if (directory.ids[i] === currentArtworkId) eligible[i] = 0;
				for (const hex of locks) {
					const keys = tilesForLock(hex, manifest),
						coverage = new Uint32Array(manifest.count);
					let next = 0;
					const controller = new AbortController(),
						linked = AbortSignal.any([signal, controller.signal]);
					try {
						await Promise.all(
							Array.from({ length: Math.min(4, keys.length) }, async () => {
								while (next < keys.length) {
									const key = keys[next++];
									const bytes = await compressed(
										data.root,
										`tiles/${key}.bin.gz`,
										manifest.tiles[key],
										linked,
										budget,
									);
									linked.throwIfAborted();
									addTileCoverage(bytes, key, directory, hex, coverage);
									// Cached requests otherwise form a long microtask chain on phones.
									await new Promise((resolve) => setTimeout(resolve, 0));
									linked.throwIfAborted();
								}
							}),
						);
					} finally {
						controller.abort();
					}
					let remaining = 0;
					for (let i = 0; i < manifest.count; i++) {
						if (
							coverage[i] / directory.opaquePixels[i] <
							LOCKED_COLOR_MATCH_POLICY.minCoverage
						)
							eligible[i] = 0;
						remaining += eligible[i];
					}
					if (!remaining) break;
				}
				const pools: number[][] = [[], []];
				for (let i = 0; i < manifest.count; i++)
					if (eligible[i]) pools[Number(seen.has(directory.ids[i]))].push(i);
				counts.candidateCount = pools[0].length + pools[1].length;
				for (const pool of pools) {
					while (pool.length) {
						signal.throwIfAborted();
						if (counts.checkedCount >= MAX_CHECKS)
							return { status: "incomplete", reason: "limit", ...counts };
						// Fetch a small window together, but accept in random draw order:
						// response speed must not bias artwork selection or bypass unseen IDs.
						const ordinals: number[] = [];
						while (
							pool.length &&
							ordinals.length < Math.min(4, MAX_CHECKS - counts.checkedCount)
						) {
							const chosen = Math.floor(Math.random() * pool.length);
							ordinals.push(pool[chosen]);
							pool[chosen] = pool[pool.length - 1];
							pool.pop();
						}
						const loaded = await Promise.all(
							ordinals.map(async (ordinal) => {
								try {
									const sampleSignal = AbortSignal.any([
										signal,
										AbortSignal.timeout(5000),
									]);
									const row = await artworkAt(
										ordinal,
										data,
										sampleSignal,
										budget,
									);
									const pixels = await pixelsFor(
										row,
										data,
										sampleSignal,
										budget,
									);
									sampleSignal.throwIfAborted();
									return { ok: true as const, row, pixels };
								} catch (error) {
									return { ok: false as const, error };
								}
							}),
						);
						for (const candidate of loaded) {
							counts.checkedCount++;
							if (!candidate.ok) {
								if (candidate.error instanceof DownloadLimit)
									throw candidate.error;
								signal.throwIfAborted();
								counts.unavailableCount++;
								onProgress?.(counts.checkedCount, counts.candidateCount);
								continue;
							}
							const { row, pixels } = candidate;
							const match = matchColorPixels(
								pixels,
								locks,
								LOCKED_COLOR_MATCH_POLICY,
							);
							onProgress?.(counts.checkedCount, counts.candidateCount);
							signal.throwIfAborted();
							if (match.matches)
								return {
									status: "match",
									artwork: {
										...row.artwork,
										thumbnail: { ...row.artwork.thumbnail },
									},
									repeated: seen.has(row.artwork.id),
									...counts,
								};
						}
					}
				}
				signal.throwIfAborted();
				return counts.unavailableCount
					? { status: "incomplete", reason: "unavailable", ...counts }
					: { status: "no-match", ...counts };
			} catch (error) {
				signal.throwIfAborted();
				if (error instanceof DownloadLimit)
					return { status: "incomplete", reason: "limit", ...counts };
				throw error;
			}
		},
	};
}
