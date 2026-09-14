import assert from "node:assert/strict";
import { test } from "node:test";
import { getImageUrl } from "../src/lib/api/artic.ts";

test("narrow artworks are requested at no more than their native width", () => {
	assert.equal(
		getImageUrl("shield", "large", 714),
		"https://www.artic.edu/iiif/2/shield/full/714,/0/default.jpg",
	);
	assert.equal(
		getImageUrl("study", "large", 481),
		"https://www.artic.edu/iiif/2/study/full/481,/0/default.jpg",
	);
	assert.equal(
		getImageUrl("tiny", "medium", 85),
		"https://www.artic.edu/iiif/2/tiny/full/85,/0/default.jpg",
	);
});

test("image size tiers retain their requested width when enlargement is unnecessary", () => {
	assert.ok(getImageUrl("art", "large", 1200).includes("/843,/"));
	assert.ok(getImageUrl("art", "medium", 714).includes("/400,/"));
	assert.ok(getImageUrl("art", "small", 714).includes("/200,/"));
	assert.ok(getImageUrl("art", "thumb", 714).includes("/100,/"));
	assert.ok(getImageUrl("art", "full", 714).includes("/714,/"));
});

test("missing or invalid native dimensions retain a bounded existing size", () => {
	for (const width of [undefined, 0, -1, NaN, Infinity])
		assert.ok(getImageUrl("art", "large", width).includes("/843,/"));
	assert.ok(getImageUrl("art", "large", 1).includes("/1,/"));
});
