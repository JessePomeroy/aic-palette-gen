import assert from "node:assert/strict";
import { test } from "node:test";
import { containsLockedColors } from "../src/lib/colors/artwork-match.ts";

function pixels(...colors: number[][]) {
	return new Uint8ClampedArray(
		colors.flatMap((c) => [c[0], c[1], c[2], c[3] ?? 255]),
	);
}

test("every lock must occur in the image, not just one of the requested colors", () => {
	assert.equal(
		containsLockedColors(pixels([255, 0, 0]), ["#ff0000", "#0000ff"]),
		false,
	);
	assert.equal(
		containsLockedColors(pixels([255, 0, 0], [0, 0, 255]), [
			"#ff0000",
			"#0000ff",
		]),
		true,
	);
});

test("close matches have a fixed tolerance, not an automatically relaxed threshold", () => {
	assert.equal(containsLockedColors(pixels([245, 0, 0]), ["#ff0000"]), true);
	assert.equal(containsLockedColors(pixels([225, 0, 0]), ["#ff0000"]), false);
	assert.equal(
		containsLockedColors(pixels([0, 0, 0], [255, 255, 255]), [
			"#000000",
			"#ffffff",
		]),
		true,
	);
});

test("a muted brown does not qualify for a gold lock despite nearby RGB values", () => {
	assert.equal(
		containsLockedColors(pixels([170, 135, 90]), ["#bd9751"]),
		false,
	);
	assert.equal(containsLockedColors(pixels([185, 150, 85]), ["#bd9751"]), true);
});

test("muted colored locks reject gray and wrong hues while retaining nearby real colors", () => {
	assert.equal(containsLockedColors(pixels([90, 90, 90]), ["#556052"]), false);
	assert.equal(containsLockedColors(pixels([95, 86, 90]), ["#556052"]), false);
	assert.equal(containsLockedColors(pixels([84, 95, 81]), ["#556052"]), true);
	assert.equal(
		containsLockedColors(pixels([231, 193, 201]), ["#e8c0c8"]),
		true,
	);
	assert.equal(containsLockedColors(pixels([92, 91, 90]), ["#5a5a5a"]), true);
});

test("coverage must come from pixels passing both distance and hue, not separate patches", () => {
	const gray = Array.from({ length: 199 }, () => [90, 90, 90]);
	assert.equal(
		containsLockedColors(pixels(...gray, [85, 96, 82]), ["#556052"]),
		false,
	);
	assert.equal(
		containsLockedColors(
			pixels(...gray, [85, 96, 82], [85, 96, 82], [85, 96, 82]),
			["#556052"],
		),
		true,
	);
});

test("rejects isolated noise, transparent matches, empty images and invalid colors", () => {
	const background = Array.from({ length: 199 }, () => [0, 0, 255]);
	assert.equal(
		containsLockedColors(pixels(...background, [255, 0, 0]), ["#ff0000"]),
		false,
	);
	assert.equal(
		containsLockedColors(
			pixels(...background, [255, 0, 0], [255, 0, 0], [255, 0, 0]),
			["#ff0000"],
		),
		true,
	);
	assert.equal(
		containsLockedColors(pixels([255, 0, 0, 0], [0, 0, 255]), ["#ff0000"]),
		false,
	);
	assert.equal(containsLockedColors(pixels(), ["#ff0000"]), false);
	assert.equal(containsLockedColors(pixels([255, 0, 0]), ["bad"]), false);
});
