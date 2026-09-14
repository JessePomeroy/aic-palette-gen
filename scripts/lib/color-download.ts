import type { Artwork } from "../../src/lib/api/artic.ts";

const SCALE_ERROR = "Requests for scales in excess of 100% are not allowed.";

async function rejectsEnlargement(response: Response): Promise<boolean> {
	const reader = response.body?.getReader();
	if (!reader) return false;
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	try {
		while (bytes < 4096) {
			const chunk = await reader.read();
			if (chunk.done) break;
			const bounded = chunk.value.subarray(0, 4096 - bytes);
			bytes += bounded.length;
			text += decoder.decode(bounded, { stream: true });
			if (text.includes(SCALE_ERROR)) return true;
		}
		return false;
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}

/** The caller owns pacing, aborts and response validation, including for a fallback. */
export async function requestColorImage(
	artwork: Pick<Artwork, "image_id"> & Partial<Pick<Artwork, "thumbnail">>,
	request: (url: string) => Promise<Response>,
): Promise<Response> {
	const nativeWidth = artwork.thumbnail?.width;
	let width = 843;
	if (
		nativeWidth &&
		Number.isSafeInteger(nativeWidth) &&
		nativeWidth > 0 &&
		nativeWidth < 843
	) {
		const height = artwork.thumbnail?.height;
		const scale =
			height && Number.isFinite(height) && height > 0
				? Math.min(1, 843 / height)
				: 1;
		width = Math.max(1, Math.floor(nativeWidth * scale));
		// Ask for a derivative, not a native-file passthrough with an embedded ICC
		// profile. The caller still rejects any response that retains such a profile.
		if (width === nativeWidth && width > 1) width--;
	}
	const base = `https://www.artic.edu/iiif/2/${artwork.image_id}/full`;
	const response = await request(`${base}/${width},/0/default.jpg`);
	// Catalog dimensions can be missing or stale. A 50% derivative cannot upscale;
	// retry only the explicit scale error, never an unrelated access denial.
	if (response.status === 403 && (await rejectsEnlargement(response))) {
		return request(`${base}/pct:50/0/default.jpg`);
	}
	return response;
}
