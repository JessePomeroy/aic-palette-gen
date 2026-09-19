import { type Artwork, getImageUrl } from "../api/artic";
import { artworkIndex } from "../colors/indexed-search";

export interface ArtworkImageSource {
	/** Unfiltered pixels for extraction and explicitly requested Tone uploads. */
	blob: Blob;
	preview: boolean;
}

export async function fetchImageBlob(
	imageUrl: string,
	signal?: AbortSignal,
	validate?: (blob: Blob) => Promise<void>,
): Promise<Blob> {
	const proxyUrl = `/api/image?${new URLSearchParams({ url: imageUrl })}`;
	for (const url of [imageUrl, proxyUrl]) {
		signal?.throwIfAborted();
		try {
			const response = await fetch(url, {
				cache: "no-cache",
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(15000)])
					: AbortSignal.timeout(15000),
			});
			if (
				!response.ok ||
				!response.headers.get("content-type")?.startsWith("image/")
			)
				continue;
			const blob = await response.blob();
			await validate?.(blob);
			signal?.throwIfAborted();
			return blob;
		} catch {
			signal?.throwIfAborted();
			// Museum CORS and server access can fail independently.
		}
	}
	throw new Error("Image could not be loaded directly or through the proxy");
}

const previews = new Map<string, Blob>();

/** Museum → proxy → matching verified sample. No original images are persisted. */
export async function loadArtworkImage(
	artwork: Artwork,
	size: Parameters<typeof getImageUrl>[1] = "large",
	signal?: AbortSignal,
): Promise<ArtworkImageSource> {
	// Capture identity before awaiting: route props and selections can be reused.
	const selected = { ...artwork, thumbnail: { ...artwork.thumbnail } };
	if (!selected.image_id) throw new Error("Artwork image is unavailable.");
	try {
		const blob = await fetchImageBlob(
			getImageUrl(selected.image_id, size, selected.thumbnail?.width),
			signal,
			async (blob) => {
				const bitmap = await createImageBitmap(blob);
				bitmap.close();
			},
		);
		return { blob, preview: false };
	} catch {
		signal?.throwIfAborted();
	}
	if (selected.is_public_domain === false)
		throw new Error("Artwork image is unavailable.");
	const key = `${selected.id}/${selected.image_id}`;
	let blob = previews.get(key);
	if (!blob) {
		const deadline = AbortSignal.timeout(15000);
		const sample = await artworkIndex.sampleForArtwork(
			selected,
			signal ? AbortSignal.any([signal, deadline]) : deadline,
		);
		if (!sample)
			throw new Error("No saved preview is available for this artwork.");
		const canvas = document.createElement("canvas");
		canvas.width = sample.width;
		canvas.height = sample.height;
		const ctx = canvas.getContext("2d");
		if (!ctx)
			throw new Error("Image previews are unavailable in this browser.");
		ctx.putImageData(
			new ImageData(
				Uint8ClampedArray.from(sample.pixels),
				sample.width,
				sample.height,
			),
			0,
			0,
		);
		blob = await canvasBlob(canvas);
		signal?.throwIfAborted();
		if (previews.size >= 32) {
			const oldest = previews.keys().next().value;
			if (oldest !== undefined) previews.delete(oldest);
		}
	} else previews.delete(key);
	previews.set(key, blob);
	signal?.throwIfAborted();
	return { blob, preview: true };
}

export function canvasBlob(
	canvas: HTMLCanvasElement,
	type = "image/png",
): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Could not encode the image.")),
			type,
		),
	);
}

export function blobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === "string"
				? resolve(reader.result)
				: reject(new Error("Could not embed the image."));
		reader.onerror = () => reject(new Error("Could not read the image."));
		reader.readAsDataURL(blob);
	});
}

/** Decode without leaking object URLs, including failed or superseded loads. */
export async function decodeImage(
	blob: Blob,
	signal?: AbortSignal,
): Promise<HTMLImageElement> {
	signal?.throwIfAborted();
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		signal?.throwIfAborted();
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function toneImage(
	artwork: Artwork,
	signal?: AbortSignal,
): Promise<Blob> {
	const { blob } = await loadArtworkImage(artwork, "medium", signal);
	if (blob.type === "image/jpeg") return blob;
	const image = await decodeImage(blob, signal);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Tone image conversion is unavailable.");
	ctx.drawImage(image, 0, 0);
	const jpeg = await canvasBlob(canvas, "image/jpeg");
	signal?.throwIfAborted();
	return jpeg;
}
