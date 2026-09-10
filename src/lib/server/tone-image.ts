const MAX_IMAGE_BYTES = 1024 * 1024;

/** Bound the upload while reading, including requests without Content-Length. */
export async function readToneImage(request: Request): Promise<Buffer> {
	if (request.headers.get("content-type")?.split(";")[0] !== "image/jpeg") {
		throw new Error("Expected a JPEG image");
	}
	if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES) {
		throw new Error("Image exceeds 1 MB");
	}
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Missing image");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_IMAGE_BYTES) {
				await reader.cancel();
				throw new Error("Image exceeds 1 MB");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const image = Buffer.concat(chunks);
	if (
		image.length < 4 ||
		image[0] !== 0xff ||
		image[1] !== 0xd8 ||
		image[2] !== 0xff
	) {
		throw new Error("Invalid JPEG image");
	}
	return image;
}
