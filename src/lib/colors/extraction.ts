/**
 * Color Extraction Module
 *
 * Extracts dominant colors from artwork images using the browser's Canvas API
 * and k-means clustering. Image loading tries the museum and proxy before
 * using an unfiltered, verified indexed sample when available.
 *
 * Two extraction modes:
 * - Dominant: clusters sorted by brightness (light → dark) — best for overall palette
 * - Vibrant:  clusters sorted by saturation (vivid → muted) — best for punchy accents
 *
 * Both modes use the same k-means algorithm; only the final sort order differs.
 * TODO: Reintegrate node-vibrant/browser for vibrant mode (better results)
 *
 * Pipeline:
 * 1. Load the artwork's unfiltered image through the shared image loader
 * 2. Load into an <img> element from a blob URL
 * 3. Draw to a downscaled canvas (max 100px) for performance
 * 4. Read pixel data via getImageData()
 * 5. Filter out near-black (<15) and near-white (>245) pixels
 * 6. Run k-means clustering to find dominant color groups
 * 7. Sort by brightness or saturation depending on mode
 *
 */

import type { Artwork } from "../api/artic";
import { decodeImage, loadArtworkImage } from "../images/artwork-image";

/** A single extracted color with multiple format representations */
export interface ExtractedColor {
	hex: string; // e.g. "#a83f2e"
	rgb: { r: number; g: number; b: number }; // 0-255 per channel
	hsl: { h: number; s: number; l: number }; // h: 0-360, s/l: 0-100
	name?: string; // Optional descriptive name
}

/** Which extraction algorithm to use */
export type ExtractionMode = "dominant" | "vibrant" | "ai";

/**
 * Main entry point: extract a color palette from the selected artwork.
 *
 * @param artwork  - Artwork identity and native image dimensions
 * @param mode      - 'dominant' (sorted by brightness) or 'vibrant' (sorted by saturation)
 * @param count     - Number of colors to extract (5-8)
 * @returns Array of extracted colors, or empty array on failure
 */
export async function extractColors(
	artwork: Artwork,
	mode: ExtractionMode,
	count: number,
): Promise<ExtractedColor[]> {
	try {
		const { blob } = await loadArtworkImage(artwork);
		return processImage(await decodeImage(blob), count, mode);
	} catch (e) {
		console.error("Color extraction failed:", e);
		return [];
	}
}

/**
 * Process a loaded image: draw to canvas, sample pixels, cluster, and sort.
 *
 * The image is downscaled to max 100px on either dimension for performance —
 * color extraction doesn't need full resolution, and k-means on 10k pixels
 * is much faster than on 1M pixels.
 */
function processImage(
	img: HTMLImageElement,
	count: number,
	mode: ExtractionMode,
): ExtractedColor[] {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) return [];

	// Scale down to max 100px for performance (color extraction doesn't need full res)
	const maxSize = 100;
	const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
	canvas.width = Math.max(1, Math.floor(img.width * scale));
	canvas.height = Math.max(1, Math.floor(img.height * scale));

	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

	// Read raw RGBA pixel data from canvas
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const pixels = imageData.data; // Uint8ClampedArray: [R,G,B,A, R,G,B,A, ...]

	// Collect valid pixels, filtering out transparent and extreme values
	const colorPixels: number[][] = [];
	for (let i = 0; i < pixels.length; i += 4) {
		const r = pixels[i];
		const g = pixels[i + 1];
		const b = pixels[i + 2];
		const a = pixels[i + 3];

		// Skip mostly-transparent pixels (alpha < 50%)
		if (a < 128) continue;

		// Skip near-black and near-white pixels — they add noise without
		// contributing meaningful color information to the palette
		const brightness = (r + g + b) / 3;
		if (brightness < 15 || brightness > 245) continue;

		colorPixels.push([r, g, b]);
	}

	// Edge case: not enough pixels to form requested clusters
	if (colorPixels.length < count) {
		return colorPixels.map(([r, g, b]) => colorFromRgb(r, g, b));
	}

	// Run k-means to find the dominant color clusters
	const clusters = kMeans(colorPixels, count);
	const results = clusters.map(([r, g, b]) => colorFromRgb(r, g, b));

	// Sort results based on extraction mode:
	// - Dominant: light → dark (by lightness) — shows the full tonal range
	// - Vibrant:  vivid → muted (by saturation) — highlights the most colorful parts
	if (mode === "vibrant") {
		results.sort((a, b) => b.hsl.s - a.hsl.s);
	} else {
		results.sort((a, b) => b.hsl.l - a.hsl.l);
	}

	return results;
}

// ─── K-Means Clustering ─────────────────────────────────────────────────────

/**
 * K-means clustering for color quantization.
 *
 * Groups similar pixels into k clusters, then returns the centroid (average color)
 * of each cluster. This is the same basic algorithm used by tools like Photoshop's
 * "Posterize" and most color palette extractors.
 *
 * We run 10 iterations, which is enough for convergence on small (100px) images.
 * Centroids are initialized randomly from existing pixels to avoid empty clusters.
 *
 * @param pixels - Array of [r, g, b] pixel values
 * @param k      - Number of clusters (= number of palette colors)
 * @returns Array of [r, g, b] centroid values
 */
function kMeans(pixels: number[][], k: number): number[][] {
	if (pixels.length === 0) return [];

	// Initialize centroids by picking k random unique pixels
	const centroids: number[][] = [];
	const used = new Set<number>();

	while (centroids.length < k) {
		const idx = Math.floor(Math.random() * pixels.length);
		if (!used.has(idx)) {
			used.add(idx);
			centroids.push([...pixels[idx]]);
		}
	}

	// Iterate: assign pixels to nearest centroid, then recalculate centroids
	for (let iter = 0; iter < 10; iter++) {
		// Create empty cluster buckets
		const clusters: number[][][] = Array.from({ length: k }, () => []);

		// Assign each pixel to its nearest centroid
		for (const pixel of pixels) {
			let minDist = Infinity;
			let closest = 0;

			for (let i = 0; i < centroids.length; i++) {
				const dist = colorDistance(pixel, centroids[i]);
				if (dist < minDist) {
					minDist = dist;
					closest = i;
				}
			}

			clusters[closest].push(pixel);
		}

		// Recalculate centroids as the mean of all pixels in each cluster
		for (let i = 0; i < k; i++) {
			if (clusters[i].length > 0) {
				centroids[i] = [
					Math.round(
						clusters[i].reduce((s, p) => s + p[0], 0) / clusters[i].length,
					),
					Math.round(
						clusters[i].reduce((s, p) => s + p[1], 0) / clusters[i].length,
					),
					Math.round(
						clusters[i].reduce((s, p) => s + p[2], 0) / clusters[i].length,
					),
				];
			}
		}
	}

	return centroids;
}

// ─── Color Math Utilities ────────────────────────────────────────────────────

/** Euclidean distance between two colors in RGB space */
function colorDistance(a: number[], b: number[]): number {
	return Math.sqrt(
		(a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
	);
}

/** Create an ExtractedColor object from raw RGB values */
function colorFromRgb(r: number, g: number, b: number): ExtractedColor {
	return {
		hex: rgbToHex(r, g, b),
		rgb: { r, g, b },
		hsl: rgbToHsl(r, g, b),
	};
}

/** Convert RGB (0-255) to hex string (e.g. "#ff8800") */
function rgbToHex(r: number, g: number, b: number): string {
	return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Convert RGB (0-255) to HSL.
 * Returns h: 0-360 (degrees), s: 0-100 (percent), l: 0-100 (percent).
 */
function rgbToHsl(
	r: number,
	g: number,
	b: number,
): { h: number; s: number; l: number } {
	// Normalize to 0-1
	r /= 255;
	g /= 255;
	b /= 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
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
