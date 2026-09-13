import { COLOR_SAMPLE_SIZE, srgbToOklab } from "./color-index";

export const COLORFULNESS_VERSION = 1;
export interface Colorfulness {
	version: typeof COLORFULNESS_VERSION;
	tag: "grayscale" | "near-neutral" | "colorful";
	opaquePixels: number;
	meanChroma: number;
	maxChroma: number;
	coloredPixelFraction: number;
}

/** Exploratory tagging only, never a reason to discard an artwork.
 * Even one pixel above the neutral-noise threshold prevents a grayscale tag;
 * accents below 1% remain near-neutral instead of being silently discarded.
 */
export function analyzeColorfulness(
	pixels: Uint8Array | Uint8ClampedArray,
): Colorfulness {
	if (
		!pixels.length ||
		pixels.length % 4 ||
		pixels.length > COLOR_SAMPLE_SIZE ** 2 * 4
	) {
		throw new Error("Expected a canonical RGBA sample");
	}
	let opaquePixels = 0,
		totalChroma = 0,
		maxChroma = 0,
		coloredPixels = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] < 128) continue;
		const [, a, b] = srgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]);
		const chroma = Math.hypot(a, b);
		opaquePixels++;
		totalChroma += chroma;
		maxChroma = Math.max(maxChroma, chroma);
		if (chroma >= 0.02) coloredPixels++;
	}
	if (!opaquePixels) throw new Error("No opaque pixels to classify");
	const coloredPixelFraction = coloredPixels / opaquePixels;
	return {
		version: COLORFULNESS_VERSION,
		tag:
			maxChroma <= 0.005
				? "grayscale"
				: coloredPixelFraction < 0.01
					? "near-neutral"
					: "colorful",
		opaquePixels,
		meanChroma: totalChroma / opaquePixels,
		maxChroma,
		coloredPixelFraction,
	};
}
