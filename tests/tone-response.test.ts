import assert from "node:assert/strict";
import { test } from "node:test";
import { readToneResponse } from "../src/lib/server/tone-response.ts";

const palette = {
	description: "A quiet, cool atmosphere.",
	colors: ["#FF0000", "#00FF00", "#0000FF", "#000000", "#FFFFFF"].map(
		(hex) => ({ hex, name: "Test color" }),
	),
};
const response = (value: unknown) => ({
	candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
});

test("tone responses produce complete finite swatches usable for sharing and export", () => {
	const actual = readToneResponse(response(palette), 5);
	assert.equal(actual.description, palette.description);
	assert.deepEqual(
		actual.colors.map((c) => c.hex),
		palette.colors.map((c) => c.hex.toLowerCase()),
	);
	assert.deepEqual(actual.colors[0], {
		hex: "#ff0000",
		name: "Test color",
		rgb: { r: 255, g: 0, b: 0 },
		hsl: { h: 0, s: 100, l: 50 },
	});
	for (const c of actual.colors)
		assert.ok(
			[...Object.values(c.rgb), ...Object.values(c.hsl)].every(Number.isFinite),
		);
});

test("invalid or incomplete model output is rejected rather than returned as a successful palette", () => {
	for (const value of [
		null,
		{},
		[],
		{ ...palette, colors: [] },
		{ ...palette, description: null },
		{ ...palette, description: "" },
		{ ...palette, colors: [...palette.colors.slice(1), { hex: "invalid" }] },
		{
			...palette,
			colors: [...palette.colors.slice(1), { hex: "#123456", name: {} }],
		},
	])
		assert.throws(
			() => readToneResponse(response(value), 5),
			/incomplete palette/,
		);
	assert.throws(
		() => readToneResponse(response(palette), 8),
		/incomplete palette/,
	);
	for (const value of [
		null,
		{},
		{ candidates: [] },
		{ candidates: [{ content: { parts: [] } }] },
	]) {
		assert.throws(() => readToneResponse(value, 5), /incomplete palette/);
	}
});

test("fenced and multipart JSON is supported without treating model thoughts as output", () => {
	const text = JSON.stringify(palette);
	const value = {
		candidates: [
			{
				content: {
					parts: [
						{ thought: true, text: "Reasoning, not JSON" },
						{ text: `\`\`\`json\n${text.slice(0, 40)}` },
						{ text: `${text.slice(40)}\n\`\`\`` },
					],
				},
			},
		],
	};
	assert.equal(readToneResponse(value, 5).colors.length, 5);
});
