import type { Artwork } from "../api/artic";
import {
	type ColorIndex,
	findIndexedArtwork,
	type IndexedArtworkResult,
	LOCKED_COLOR_MATCH_POLICY,
	readColorIndex,
	readColorSample,
} from "./color-index";
import { readArtworkCatalog } from "./index-catalog";

export const COLOR_INDEX_ASSET_ROOT = "/color-index/expanded-2500-20260913";
const SAMPLE_CACHE_LIMIT = 32;

type SearchResult =
	| {
			status: "match";
			artwork: Artwork;
			indexedCount: number;
			repeated: boolean;
	  }
	| (Exclude<IndexedArtworkResult, { status: "match" }> & {
			indexedCount: number;
	  });

/** One workbench owns its immutable catalog and bounded sample cache. No museum
 * requests or fallback image scan occur here, even when the index is unavailable.
 */
export function createIndexedSearch(fetcher: typeof fetch = fetch) {
	let catalog:
		| { index: ColorIndex; artworks: Map<number, Artwork> }
		| undefined;
	const samples = new Map<string, Uint8Array>();

	async function loadCatalog(signal: AbortSignal) {
		signal.throwIfAborted();
		if (catalog) return catalog;
		const controller = new AbortController();
		const loadSignal = AbortSignal.any([signal, controller.signal]);
		try {
			const [indexResponse, artworkResponse] = await Promise.all([
				fetcher(`${COLOR_INDEX_ASSET_ROOT}/index.json`, {
					signal: loadSignal,
					cache: "no-cache",
				}),
				fetcher(`${COLOR_INDEX_ASSET_ROOT}/artworks.json`, {
					signal: loadSignal,
					cache: "no-cache",
				}),
			]);
			if (!indexResponse.ok || !artworkResponse.ok)
				throw new Error("Color index unavailable");
			const index = readColorIndex(await indexResponse.json());
			const artworks = readArtworkCatalog(await artworkResponse.json());
			if (!index.entries.length) throw new Error("Color index is empty");
			for (const entry of index.entries) {
				if (artworks.get(entry.artworkId)?.image_id !== entry.imageId)
					throw new Error("Color index and artwork catalog do not agree");
			}
			signal.throwIfAborted();
			catalog = { index, artworks };
			return catalog;
		} finally {
			controller.abort();
		}
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
		): Promise<SearchResult> {
			const locks = [...hexes];
			if (
				!locks.length ||
				locks.length > 8 ||
				locks.some((hex) => !/^#[0-9a-f]{6}$/i.test(hex))
			)
				throw new Error("Choose one to eight valid locked colors");
			const { signal, currentArtworkId, onIndexReady, onProgress } = options;
			const seenArtworkIds = [...(options.seenArtworkIds ?? [])];
			const { index, artworks } = await loadCatalog(signal);
			onIndexReady?.(index.entries.length);
			const result = await findIndexedArtwork(index, locks, {
				signal,
				currentArtworkId,
				seenArtworkIds,
				policy: LOCKED_COLOR_MATCH_POLICY,
				maxChecks: Math.min(2500, index.entries.length),
				onProgress,
				loadSample: async (entry, sampleSignal) => {
					const digest = entry.sample.sha256;
					const cached = samples.get(digest);
					if (cached) {
						samples.delete(digest);
						samples.set(digest, cached);
						return cached;
					}
					const response = await fetcher(
						`${COLOR_INDEX_ASSET_ROOT}/samples/${digest}.rgba`,
						{ signal: sampleSignal, cache: "force-cache" },
					);
					if (!response.ok) throw new Error("Color sample unavailable");
					const bytes = new Uint8Array(await response.arrayBuffer());
					sampleSignal.throwIfAborted();
					// Cache only verified immutable samples; corrupt loads remain retryable.
					const pixels = await readColorSample(bytes, entry.sample);
					sampleSignal.throwIfAborted();
					if (samples.size >= SAMPLE_CACHE_LIMIT) {
						const oldest = samples.keys().next().value;
						if (oldest !== undefined) samples.delete(oldest);
					}
					samples.set(digest, pixels);
					return pixels;
				},
			});
			signal.throwIfAborted();
			if (result.status !== "match")
				return { ...result, indexedCount: index.entries.length };
			const artwork = artworks.get(result.entry.artworkId);
			if (!artwork) throw new Error("Matched artwork metadata unavailable");
			return {
				status: "match",
				artwork: { ...artwork, thumbnail: { ...artwork.thumbnail } },
				indexedCount: index.entries.length,
				repeated: result.repeated,
			};
		},
	};
}
