import assert from "node:assert/strict";
import { test } from "node:test";
import type { Artwork } from "../src/lib/api/artic.ts";
import { buildSearchQuery } from "../src/lib/api/artic.ts";
import type { ExtractedColor } from "../src/lib/colors/extraction.ts";
import {
	applyLocks,
	contrastRatio,
	suggestTextColor,
} from "../src/lib/colors/workbench.ts";
import {
	parseHistory,
	type RecentPalette,
	rememberPalette,
} from "../src/lib/history.ts";

const color = (hex: string): ExtractedColor => ({
	hex,
	rgb: { r: 1, g: 2, b: 3 },
	hsl: { h: 0, s: 0, l: 0 },
});
const colors = ["#112233", "#223344", "#334455", "#445566", "#556677"].map(
	color,
);
const artwork: Artwork = {
	id: 1,
	title: "Study",
	artist_display: "Artist",
	date_display: "1900",
	medium_display: "Oil",
	image_id: "example-id",
	thumbnail: { alt_text: "", width: 1, height: 1 },
};

test("locks preserve their slots while other candidates fill the requested count", () => {
	const locked = color("#abcdef");
	const result = applyLocks(colors, [null, locked, null, null, colors[0]], 5);
	assert.equal(result.length, 5);
	assert.equal(result[1], locked);
	assert.equal(result[4], colors[0]);
	assert.deepEqual([result[0], result[2], result[3]], colors.slice(1, 4));
});

test("contrast endpoints and suggestions use the unrounded AA threshold", () => {
	assert.equal(contrastRatio("#000000", "#ffffff"), 21);
	assert.equal(contrastRatio("#345678", "#345678"), 1);
	const text = suggestTextColor("#888888", "#999999");
	assert.ok(contrastRatio(text, "#999999") >= 4.5);
});

test("history survives reload, retains locks and tone, deduplicates, and caps storage", () => {
	let history: RecentPalette[] = [];
	for (let i = 1; i <= 30; i++)
		history = rememberPalette(history, {
			artwork: { ...artwork, id: i },
			colors,
			locks: [colors[0], null],
			mode: "ai",
			description: "Quiet light",
		});
	assert.equal(history.length, 24);
	history = rememberPalette(history, history[1]);
	assert.equal(history.length, 24);
	assert.equal(history[0].artwork.id, 29);
	const restored = parseHistory(JSON.stringify(history));
	assert.equal(restored.length, 24);
	assert.equal(restored[0].locks[0]?.hex, colors[0].hex);
	assert.equal(restored[0].description, "Quiet light");
	assert.equal(restored[0].mode, "ai");
});

test("corrupt and incompatible history never crashes or restores unsafe image paths", () => {
	assert.deepEqual(parseHistory("not json"), []);
	assert.deepEqual(parseHistory("[null,{},42]"), []);
	const entries = rememberPalette([], {
		artwork: { ...artwork, image_id: "../outside" },
		colors,
		locks: [],
		mode: "dominant",
		description: "",
	});
	assert.deepEqual(parseHistory(JSON.stringify(entries)), []);
});

test("discovery combines literal artist input, public domain, date overlap and image filters", () => {
	const query = buildSearchQuery({
		artist: 'A " OR *',
		medium: "oil",
		publicDomain: true,
		fromYear: 1800,
		toYear: 1899,
		page: 2,
	});
	assert.equal(query.page, 2);
	assert.deepEqual(query.query.bool.must[0], {
		match_phrase: { artist_title: 'A " OR *' },
	});
	assert.deepEqual(query.query.bool.filter, [
		{ exists: { field: "image_id" } },
		{ term: { is_public_domain: true } },
		{ range: { date_end: { gte: 1800 } } },
		{ range: { date_start: { lte: 1899 } } },
	]);
});
