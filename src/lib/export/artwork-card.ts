import { type Artwork, getArtworkUrl, getImageUrl } from "../api/artic";
import { type ExtractedColor, fetchImageBlob } from "../colors/extraction";
import { readableText } from "../colors/workbench";

export async function exportArtworkCard(
	artwork: Artwork,
	colors: ExtractedColor[],
	signal?: AbortSignal,
): Promise<Blob> {
	if (!artwork.image_id || !colors.length)
		throw new Error("Choose an artwork and palette first.");
	const blob = await fetchImageBlob(
		getImageUrl(artwork.image_id, "large", artwork.thumbnail?.width),
		signal,
	);
	const image = await createImageBitmap(blob);
	try {
		signal?.throwIfAborted();
		const canvas = document.createElement("canvas");
		canvas.width = 1200;
		canvas.height = 1440;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Image export is unavailable in this browser.");
		ctx.fillStyle = "#f3f0e9";
		ctx.fillRect(0, 0, 1200, 1440);
		ctx.fillStyle = "#25241f";
		ctx.font = "20px system-ui";
		ctx.fillText("CHROMA COLLECTION  /  ART INSTITUTE OF CHICAGO", 64, 66);
		const scale = Math.min(1072 / image.width, 870 / image.height);
		const width = image.width * scale,
			height = image.height * scale;
		ctx.drawImage(
			image,
			(1200 - width) / 2,
			100 + (870 - height) / 2,
			width,
			height,
		);
		const fitText = (text: string, y: number, size: number) => {
			ctx.font = `${size}px system-ui`;
			let fitted = text.replace(/\s+/g, " ").trim();
			while (fitted.length && ctx.measureText(fitted).width > 1072)
				fitted = fitted.slice(0, -1);
			if (fitted.length < text.replace(/\s+/g, " ").trim().length)
				fitted = fitted.slice(0, -1) + "…";
			ctx.fillText(fitted, 64, y);
		};
		fitText(artwork.title, 1020, 30);
		fitText(
			`${artwork.artist_title || artwork.artist_display || "Artist unknown"} · ${artwork.date_display || "Date unknown"}`,
			1060,
			20,
		);
		const swatchWidth = 1072 / colors.length;
		colors.forEach((color, i) => {
			ctx.fillStyle = color.hex;
			ctx.fillRect(64 + i * swatchWidth, 1100, swatchWidth, 160);
			ctx.fillStyle = readableText(color.hex);
			ctx.font = "20px monospace";
			ctx.textAlign = "center";
			ctx.fillText(color.hex.toUpperCase(), 64 + (i + 0.5) * swatchWidth, 1230);
		});
		ctx.textAlign = "left";
		ctx.fillStyle = "#25241f";
		fitText(
			"Artwork: Art Institute of Chicago · " +
				(artwork.is_public_domain
					? "Public domain"
					: artwork.copyright_notice || "See museum page for image rights"),
			1320,
			16,
		);
		fitText(getArtworkUrl(artwork.id), 1350, 16);
		fitText("Palette created with Chroma Collection", 1380, 16);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(result) =>
					result
						? resolve(result)
						: reject(new Error("Could not export the artwork card.")),
				"image/png",
			),
		);
	} finally {
		image.close();
	}
}
