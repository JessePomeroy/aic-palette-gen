/**
 * Art Institute of Chicago API Client
 * Docs: https://api.artic.edu/docs/
 *
 * The AIC provides a free, public REST API with access to their full collection
 * (~131k artworks). Images are served via IIIF (International Image Interoperability
 * Framework) from their own CDN at www.artic.edu/iiif/2/.
 *
 * Important notes:
 * - Not all artworks have images (image_id can be null)
 * - Some images return 403 (restricted/copyrighted) even with a valid image_id
 * - The search endpoint (`/artworks/search`) does NOT support `q=*` for browsing
 *   — use the main `/artworks` endpoint with pagination for random browsing
 * - Image access can differ between browsers and servers; extraction uses a fallback.
 */

const BASE_URL = "https://api.artic.edu/api/v1";

/** Fields we request from the API to minimize response size */
const ARTWORK_FIELDS =
	"id,title,artist_title,artist_id,artist_display,date_display,date_start,date_end,medium_display,is_public_domain,copyright_notice,image_id,thumbnail.alt_text,thumbnail.width,thumbnail.height";

/** Shape of an artwork returned by the API (trimmed to our requested fields) */
export interface Artwork {
	id: number;
	title: string;
	artist_display: string;
	date_display: string;
	medium_display: string;
	artist_title?: string | null;
	artist_id?: number | null;
	date_start?: number | null;
	date_end?: number | null;
	is_public_domain?: boolean;
	copyright_notice?: string | null;
	/** IIIF image identifier — null if no image exists for this artwork */
	image_id: string | null;
	thumbnail: {
		alt_text: string;
		width: number;
		height: number;
	};
}

/** Parameters for searching the collection */
export interface SearchParams {
	q?: string; // Free-text query
	artist?: string; // Filter by artist name
	medium?: string; // Filter by medium (e.g. "Oil on canvas")
	style?: string; // Filter by style (e.g. "Impressionism")
	artistId?: number;
	publicDomain?: boolean;
	fromYear?: number;
	toYear?: number;
	excludeId?: number;
	page?: number; // Pagination — 1-indexed
	limit?: number; // Results per page (max 100)
}

/** Paginated response wrapper from the API */
export interface SearchResponse {
	pagination: {
		total: number;
		limit: number;
		offset: number;
		total_pages: number;
		current_page: number;
	};
	data: Artwork[];
}

/**
 * Build a IIIF image URL for a given artwork image.
 *
 * AIC rejects enlargement, so cap preset widths at the known source width.
 * Missing dimensions retain the existing size tiers. The URL follows the IIIF
 * Image API 2.0 spec: {base}/{id}/{region}/{size}/{rotation}/{quality}.{format}
 */
export function getImageUrl(
	imageId: string,
	size: "full" | "large" | "medium" | "small" | "thumb" = "full",
	nativeWidth?: number,
): string {
	const sizes: Record<string, number> = {
		full: 1686, // Max resolution — good for detail views
		large: 843, // Half-res — good for main display + color extraction
		medium: 400, // Thumbnails in grid views
		small: 200, // Small thumbnails
		thumb: 100, // Tiny previews
	};
	const width =
		typeof nativeWidth === "number" &&
		Number.isFinite(nativeWidth) &&
		nativeWidth >= 1
			? Math.min(sizes[size], Math.floor(nativeWidth))
			: sizes[size];
	return `https://www.artic.edu/iiif/2/${imageId}/full/${width},/0/default.jpg`;
}

/**
 * Search artworks using the Elasticsearch-backed search endpoint.
 *
 * Supports free-text queries and field-specific filters that get combined
 * with AND logic. Returns paginated results sorted by relevance.
 *
 * Note: This uses /artworks/search (Elasticsearch), NOT /artworks (database).
 * The search endpoint does NOT work with `q=*` — use getRandomArtwork() for browsing.
 */
export async function searchArtworks(
	params: SearchParams,
): Promise<SearchResponse> {
	const res = await fetch(
		`${BASE_URL}/artworks/search?${new URLSearchParams({ params: JSON.stringify(buildSearchQuery(params)) })}`,
	);
	if (!res.ok) throw new Error(`Artwork search failed (${res.status})`);
	return res.json();
}

/** Structured clauses keep literal user input out of Elasticsearch query syntax. */
export function buildSearchQuery(params: SearchParams) {
	const must: object[] = [];
	const filter: object[] = [{ exists: { field: "image_id" } }];
	if (params.q?.trim())
		must.push({
			multi_match: {
				query: params.q.trim(),
				fields: ["title", "artist_title", "medium_display"],
			},
		});
	if (params.artist?.trim())
		must.push({ match_phrase: { artist_title: params.artist.trim() } });
	if (params.medium?.trim())
		must.push({ match: { medium_display: params.medium.trim() } });
	if (params.style?.trim())
		must.push({ match: { style_titles: params.style.trim() } });
	if (params.artistId) filter.push({ term: { artist_id: params.artistId } });
	if (params.publicDomain) filter.push({ term: { is_public_domain: true } });
	if (params.fromYear !== undefined)
		filter.push({ range: { date_end: { gte: params.fromYear } } });
	if (params.toYear !== undefined)
		filter.push({ range: { date_start: { lte: params.toYear } } });
	return {
		query: {
			bool: {
				must,
				filter,
				must_not: params.excludeId ? [{ term: { id: params.excludeId } }] : [],
			},
		},
		page: params.page ?? 1,
		limit: params.limit ?? 20,
		fields: ARTWORK_FIELDS,
	};
}

export function getArtworkUrl(id: number): string {
	return `https://www.artic.edu/artworks/${id}`;
}

/**
 * Get a single artwork by its numeric ID.
 */
export async function getArtwork(id: number): Promise<Artwork> {
	const url = `${BASE_URL}/artworks/${id}?fields=${ARTWORK_FIELDS}`;
	const res = await fetch(url);
	const json = await res.json();
	return json.data;
}

/**
 * Get a random artwork from the collection.
 *
 * Uses the main /artworks endpoint (not /search) with a random page number.
 * We cap at page 10000 to avoid edge cases with very high offsets.
 *
 * The caller should check if the returned artwork has an accessible image —
 * some artworks have no image_id, and some with image_id return 403.
 */
export async function getRandomArtwork(): Promise<Artwork> {
	// First request: get the total count of artworks in the collection
	const countUrl = `${BASE_URL}/artworks?fields=id&limit=1`;
	const countRes = await fetch(countUrl);
	const countJson = await countRes.json();
	const total = countJson.pagination.total;

	// Pick a random page (each page = 1 artwork since limit=1)
	const maxPage = Math.min(Math.floor(total / 1), 10000);
	const randomPage = Math.floor(Math.random() * maxPage) + 1;

	const url = `${BASE_URL}/artworks?${new URLSearchParams({
		page: String(randomPage),
		limit: "1",
		fields: ARTWORK_FIELDS,
	}).toString()}`;
	const res = await fetch(url);
	const json = await res.json();

	return json.data[0];
}

/**
 * Get multiple artworks by their IDs in a single request.
 * Useful for batch loading (e.g. saved palettes referencing multiple artworks).
 */
export async function getArtworks(ids: number[]): Promise<Artwork[]> {
	const url = `${BASE_URL}/artworks?${new URLSearchParams({
		ids: ids.join(","),
		fields: ARTWORK_FIELDS,
	}).toString()}`;
	const res = await fetch(url);
	const json = await res.json();
	return json.data;
}
