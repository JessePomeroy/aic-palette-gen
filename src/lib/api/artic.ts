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
 * - IIIF images DO support CORS (access-control-allow-origin: *), but the
 *   browser's <img> tag must use crossorigin="anonymous" to avoid opaque cache
 *   entries that block subsequent fetch() calls
 */

const BASE_URL = 'https://api.artic.edu/api/v1';

/** Fields we request from the API to minimize response size */
const ARTWORK_FIELDS = 'id,title,artist_display,date_display,medium_display,image_id,thumbnail.alt_text,thumbnail.width,thumbnail.height';

/** Shape of an artwork returned by the API (trimmed to our requested fields) */
export interface Artwork {
	id: number;
	title: string;
	artist_display: string;
	date_display: string;
	medium_display: string;
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
	q?: string;        // Free-text query
	artist?: string;   // Filter by artist name
	medium?: string;   // Filter by medium (e.g. "Oil on canvas")
	style?: string;    // Filter by style (e.g. "Impressionism")
	page?: number;     // Pagination — 1-indexed
	limit?: number;    // Results per page (max 100)
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
 * The AIC IIIF server supports arbitrary sizes, but we use preset tiers
 * to keep things simple and cacheable. The URL format follows the IIIF
 * Image API 2.0 spec: {base}/{id}/{region}/{size}/{rotation}/{quality}.{format}
 */
export function getImageUrl(imageId: string, size: 'full' | 'large' | 'medium' | 'small' | 'thumb' = 'full'): string {
	const sizes: Record<string, number> = {
		full: 1686,   // Max resolution — good for detail views
		large: 843,   // Half-res — good for main display + color extraction
		medium: 400,  // Thumbnails in grid views
		small: 200,   // Small thumbnails
		thumb: 100    // Tiny previews
	};
	return `https://www.artic.edu/iiif/2/${imageId}/full/${sizes[size]},/0/default.jpg`;
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
export async function searchArtworks(params: SearchParams): Promise<SearchResponse> {
	const { q, artist, medium, style, page = 1, limit = 20 } = params;

	// Build Elasticsearch query string with field-specific filters
	const searchParts: string[] = [];
	if (q) searchParts.push(q);
	if (artist) searchParts.push(`artist_title:"${artist}"`);
	if (medium) searchParts.push(`medium_display:"${medium}"`);
	if (style) searchParts.push(`style_title:"${style}"`);

	const query = searchParts.join(' AND ') || '*';

	const paramsObj: Record<string, string | number> = {
		q: query,
		page,
		limit,
		fields: ARTWORK_FIELDS
	};

	const url = `${BASE_URL}/artworks/search?${new URLSearchParams(paramsObj as any).toString()}`;
	const res = await fetch(url);
	const json = await res.json();

	return json;
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
		limit: '1',
		fields: ARTWORK_FIELDS
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
		ids: ids.join(','),
		fields: ARTWORK_FIELDS
	}).toString()}`;
	const res = await fetch(url);
	const json = await res.json();
	return json.data;
}
