// Direct-image comparison helpers for calibration. The app searches indexed samples.
import { getImageUrl } from "../api/artic";
import { LOCKED_COLOR_MATCH_POLICY, matchColorPixels } from "./color-index";
import { fetchImageBlob } from "./extraction";

export function containsLockedColors(
	pixels: Uint8ClampedArray,
	hexes: string[],
): boolean {
	if (!hexes.length) return true;
	if (hexes.some((hex) => !/^#[0-9a-f]{6}$/i.test(hex))) return false;
	if (pixels.length % 4 !== 0) return false;
	return matchColorPixels(pixels, hexes, LOCKED_COLOR_MATCH_POLICY).matches;
}

export async function imageContainsLockedColors(
	imageId: string,
	hexes: string[],
	signal: AbortSignal,
): Promise<boolean> {
	const blob = await fetchImageBlob(getImageUrl(imageId, "small"), signal);
	const bitmap = await createImageBitmap(blob);
	try {
		signal.throwIfAborted();
		const canvas = document.createElement("canvas");
		const scale = Math.min(100 / bitmap.width, 100 / bitmap.height, 1);
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return false;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		return containsLockedColors(
			ctx.getImageData(0, 0, canvas.width, canvas.height).data,
			hexes,
		);
	} finally {
		bitmap.close();
	}
}
