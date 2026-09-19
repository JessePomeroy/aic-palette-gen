import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchQuery } from "../src/lib/api/artic.ts";
import {
	type DiscoverySearch,
	discoveryParams,
	parseSearchHistory,
	type RecentSearch,
	rememberSearch,
	SEARCH_HISTORY_LIMIT,
} from "../src/lib/search-history.ts";

const search = (overrides: Partial<DiscoverySearch> = {}): DiscoverySearch => ({
	q: "water lilies",
	artist: "Claude Monet",
	medium: "oil on canvas",
	period: "1900:1949",
	publicDomain: true,
	...overrides,
});

test("recent searches restore the query, every filter and the last results page", () => {
	const saved = rememberSearch([], search(), 3);
	const restored = parseSearchHistory(JSON.stringify(saved));
	assert.deepEqual(restored, saved);
	const query = buildSearchQuery(
		discoveryParams(restored[0].search, restored[0].page),
	);
	assert.equal(query.page, 3);
	assert.equal(query.limit, 12);
	assert.deepEqual(query.query.bool.must, [
		{
			multi_match: {
				query: "water lilies",
				fields: ["title", "artist_title", "medium_display"],
			},
		},
		{ match_phrase: { artist_title: "Claude Monet" } },
		{ match: { medium_display: "oil on canvas" } },
	]);
	assert.deepEqual(query.query.bool.filter, [
		{ exists: { field: "image_id" } },
		{ term: { is_public_domain: true } },
		{ range: { date_end: { gte: 1900 } } },
		{ range: { date_start: { lte: 1949 } } },
	]);
});

test("repeated searches move to the front and update their page without duplicating", () => {
	let history = rememberSearch([], search(), 1);
	history = rememberSearch(history, search({ q: "gardens" }), 1);
	history = rememberSearch(
		history,
		search({ q: "  Water Lilies  ", artist: " Claude Monet " }),
		2,
	);
	assert.equal(history.length, 2);
	assert.equal(history[0].search.q, "Water Lilies");
	assert.equal(history[0].search.artist, "Claude Monet");
	assert.equal(history[0].page, 2);
	assert.equal(history[1].search.q, "gardens");
});

test("different filters are distinct searches and history is bounded", () => {
	let history: RecentSearch[] = [];
	for (const item of [
		search(),
		search({ artist: "" }),
		search({ medium: "" }),
		search({ period: "" }),
		search({ publicDomain: false }),
	]) {
		history = rememberSearch(history, item, 1);
	}
	assert.equal(history.length, 5);
	for (let i = 0; i < 15; i++)
		history = rememberSearch(history, search({ q: `Search ${i}` }), 1);
	assert.equal(history.length, SEARCH_HISTORY_LIMIT);
	assert.equal(history[0].search.q, "Search 14");
	assert.equal(history.at(-1)?.search.q, "Search 5");
});

test("more-by-artist restores its exact artist ID and excluded artwork, not a name query", () => {
	const saved = rememberSearch(
		[],
		search({ q: "", artistId: 42, excludeId: 101, medium: "", period: "" }),
		2,
	);
	const restored = parseSearchHistory(JSON.stringify(saved))[0];
	const query = buildSearchQuery(
		discoveryParams(restored.search, restored.page),
	);
	assert.equal(restored.search.artist, "Claude Monet");
	assert.deepEqual(query.query.bool.must, []);
	assert.ok(
		query.query.bool.filter.some(
			(clause) =>
				JSON.stringify(clause) === JSON.stringify({ term: { artist_id: 42 } }),
		),
	);
	assert.ok(query.query.bool.must_not.some((clause) => clause.term.id === 101));
	assert.equal(query.page, 2);
});

test("filter-only and unfiltered searches remain restorable", () => {
	const empty = search({
		q: "",
		artist: "",
		medium: "",
		period: "",
		publicDomain: false,
	});
	const history = rememberSearch(
		rememberSearch([], empty, 1),
		{ ...empty, medium: "ink" },
		1,
	);
	assert.equal(parseSearchHistory(JSON.stringify(history)).length, 2);
	assert.deepEqual(
		buildSearchQuery(discoveryParams(empty, 1)).query.bool.must,
		[],
	);
});

test("corrupt history is ignored and malformed entries cannot produce requests", () => {
	for (const raw of [
		null,
		"not json",
		"{}",
		"null",
		"[null,{},42]",
		"x".repeat(100001),
	]) {
		assert.deepEqual(parseSearchHistory(raw), []);
	}
	const good = rememberSearch([], search(), 1)[0];
	for (const patch of [
		{ q: 7 },
		{ artist: {} },
		{ medium: null },
		{ publicDomain: "true" },
		{ period: "tomorrow" },
		{ artistId: 0 },
		{ artistId: 1.5 },
		{ excludeId: -1 },
	]) {
		assert.deepEqual(
			parseSearchHistory(
				JSON.stringify([{ ...good, search: { ...good.search, ...patch } }]),
			),
			[],
		);
	}
	for (const page of [0, -1, 1.5, 835, "2", null]) {
		assert.deepEqual(
			parseSearchHistory(JSON.stringify([{ ...good, page }])),
			[],
		);
	}
});

test("parsing preserves newest-first ordering, rebuilds identity and strips unknown fields", () => {
	const good = rememberSearch([], search(), 2)[0];
	const restored = parseSearchHistory(
		JSON.stringify([
			{
				...good,
				id: "untrusted",
				search: {
					...good.search,
					limit: 10000,
					url: "https://example.invalid",
				},
			},
			{ ...good, page: 1 },
		]),
	);
	assert.deepEqual(restored, [good]);
	const many = Array.from({ length: 15 }, (_, i) => ({
		search: search({ q: String(i) }),
		page: 1,
	}));
	const bounded = parseSearchHistory(JSON.stringify(many));
	assert.equal(bounded.length, SEARCH_HISTORY_LIMIT);
	assert.equal(bounded[0].search.q, "0");
	assert.equal(bounded.at(-1)?.search.q, "9");
});

test("remembering takes a snapshot instead of retaining the mutable form", () => {
	const draft = search();
	const history = rememberSearch([], draft, 1);
	draft.q = "edited while searching";
	assert.equal(history[0].search.q, "water lilies");
});
