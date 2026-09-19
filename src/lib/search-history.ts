import type { SearchParams } from "./api/artic";

export const SEARCH_HISTORY_KEY = "chroma-search-history-v1";
export const SEARCH_HISTORY_LIMIT = 10;
export const SEARCH_PERIODS = [
	{ value: "", label: "Any period" },
	{ value: "-5000:1799", label: "Before 1800" },
	{ value: "1800:1899", label: "1800–1899" },
	{ value: "1900:1949", label: "1900–1949" },
	{ value: "1950:2026", label: "1950–present" },
] as const;

export interface DiscoverySearch {
	q: string;
	artist: string;
	medium: string;
	period: (typeof SEARCH_PERIODS)[number]["value"];
	publicDomain: boolean;
	/** More-by-artist keeps its exact ID; artist is then a display label only. */
	artistId?: number;
	excludeId?: number;
}

export interface RecentSearch {
	id: string;
	search: DiscoverySearch;
	page: number;
}

export function discoveryParams(
	search: DiscoverySearch,
	page: number,
): SearchParams {
	const years = search.period ? search.period.split(":").map(Number) : [];
	return {
		q: search.q,
		artist: search.artistId ? undefined : search.artist,
		medium: search.medium,
		publicDomain: search.publicDomain,
		fromYear: years[0],
		toYear: years[1],
		artistId: search.artistId,
		excludeId: search.excludeId,
		page,
		limit: 12,
	};
}

function entry(search: DiscoverySearch, page: number): RecentSearch {
	const normalized = {
		...search,
		q: search.q.trim(),
		artist: search.artist.trim(),
		medium: search.medium.trim(),
	};
	// Pagination changes the saved position, not the identity of the search.
	const id = JSON.stringify([
		normalized.q.toLowerCase(),
		normalized.artistId ? "" : normalized.artist.toLowerCase(),
		normalized.medium.toLowerCase(),
		normalized.period,
		normalized.publicDomain,
		normalized.artistId ?? null,
		normalized.excludeId ?? null,
	]);
	return { id, search: normalized, page };
}

export function rememberSearch(
	history: RecentSearch[],
	search: DiscoverySearch,
	page: number,
): RecentSearch[] {
	const next = entry(search, page);
	return [next, ...history.filter((item) => item.id !== next.id)].slice(
		0,
		SEARCH_HISTORY_LIMIT,
	);
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalId(value: unknown): value is number | undefined {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isSafeInteger(value) && value > 0)
	);
}

/** Rebuild only supported fields; stale or corrupt browser data cannot become a request. */
export function parseSearchHistory(raw: string | null): RecentSearch[] {
	try {
		if (!raw || raw.length > 100_000) return [];
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values)) return [];
		const result: RecentSearch[] = [];
		for (const value of values) {
			if (!record(value) || !record(value.search)) continue;
			const search = value.search;
			const period = SEARCH_PERIODS.find(
				(item) => item.value === search.period,
			);
			if (
				typeof search.q !== "string" ||
				typeof search.artist !== "string" ||
				typeof search.medium !== "string" ||
				typeof search.publicDomain !== "boolean" ||
				!period ||
				!optionalId(search.artistId) ||
				!optionalId(search.excludeId) ||
				typeof value.page !== "number" ||
				!Number.isInteger(value.page) ||
				value.page < 1 ||
				value.page > Math.ceil(10000 / 12)
			)
				continue;
			const next = entry(
				{
					q: search.q,
					artist: search.artist,
					medium: search.medium,
					period: period.value,
					publicDomain: search.publicDomain,
					...(search.artistId !== undefined
						? { artistId: search.artistId }
						: {}),
					...(search.excludeId !== undefined
						? { excludeId: search.excludeId }
						: {}),
				},
				value.page,
			);
			if (!result.some((item) => item.id === next.id)) result.push(next);
			if (result.length === SEARCH_HISTORY_LIMIT) break;
		}
		return result;
	} catch {
		return [];
	}
}
