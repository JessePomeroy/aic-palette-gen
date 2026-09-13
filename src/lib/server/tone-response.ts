import type { ExtractedColor } from "../colors/extraction";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Model output is untrusted: never return a partial palette or NaN channels. */
export function readToneResponse(
	value: unknown,
	count: number,
): { description: string; colors: ExtractedColor[] } {
	const invalid = () =>
		new Error("Tone returned an incomplete palette. Please try again.");
	if (!record(value) || !Array.isArray(value.candidates)) throw invalid();
	const candidate = value.candidates[0];
	if (
		!record(candidate) ||
		!record(candidate.content) ||
		!Array.isArray(candidate.content.parts)
	)
		throw invalid();
	const text = candidate.content.parts
		.filter(record)
		.filter((part) => part.thought !== true && typeof part.text === "string")
		.map((part) => part.text)
		.join("")
		.trim();
	if (!text || text.length > 16_384) throw invalid();
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
		);
	} catch {
		throw invalid();
	}
	if (
		!record(parsed) ||
		typeof parsed.description !== "string" ||
		!parsed.description.trim() ||
		parsed.description.length > 1000 ||
		!Array.isArray(parsed.colors) ||
		parsed.colors.length !== count
	)
		throw invalid();
	const colors = parsed.colors.map((color): ExtractedColor => {
		if (
			!record(color) ||
			typeof color.hex !== "string" ||
			!/^#[0-9a-f]{6}$/i.test(color.hex) ||
			(color.name !== undefined &&
				(typeof color.name !== "string" || color.name.length > 80))
		)
			throw invalid();
		const hex = color.hex.toLowerCase();
		const r = parseInt(hex.slice(1, 3), 16),
			g = parseInt(hex.slice(3, 5), 16),
			b = parseInt(hex.slice(5, 7), 16);
		return {
			hex,
			rgb: { r, g, b },
			hsl: rgbToHsl(r, g, b),
			...(typeof color.name === "string" ? { name: color.name } : {}),
		};
	});
	return { description: parsed.description, colors };
}

function rgbToHsl(
	r: number,
	g: number,
	b: number,
): { h: number; s: number; l: number } {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	let h = 0,
		s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
				break;
			case g:
				h = ((b - r) / d + 2) / 6;
				break;
			case b:
				h = ((r - g) / d + 4) / 6;
				break;
		}
	}
	return {
		h: Math.round(h * 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100),
	};
}
