import { Vibrant } from "node-vibrant/node";
import {
	analyzeColorSignature,
	COLOR_SAMPLE_SIZE,
} from "../../src/lib/colors/color-index.ts";

export class ImageAnalysisError extends Error {
	constructor(readonly reason: "empty-sample" | "decode-or-analysis-failed") {
		super(reason);
	}
}

/** The same canonical v2 pixels must drive signatures, verification and tags. */
export async function prepareColorImage(data: Buffer) {
	const ImageClass = new Vibrant(data).opts.ImageClass;
	const image = new ImageClass();
	try {
		await image.load(data);
		const width = image.getWidth(),
			height = image.getHeight();
		if (
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width < 1 ||
			height < 1
		) {
			throw new Error("Invalid image dimensions");
		}
		const ratio = Math.min(1, COLOR_SAMPLE_SIZE / Math.max(width, height));
		if (ratio < 1)
			image.resize(
				Math.max(1, Math.floor(width * ratio)),
				Math.max(1, Math.floor(height * ratio)),
				ratio,
			);
		const pixels = Uint8Array.from(image.getImageData().data);
		const signature = analyzeColorSignature(pixels);
		if (!signature.opaquePixels) throw new ImageAnalysisError("empty-sample");
		return {
			pixels,
			signature,
			width: image.getWidth(),
			height: image.getHeight(),
		};
	} catch (error) {
		if (error instanceof ImageAnalysisError) throw error;
		throw new ImageAnalysisError("decode-or-analysis-failed");
	} finally {
		image.remove();
	}
}
