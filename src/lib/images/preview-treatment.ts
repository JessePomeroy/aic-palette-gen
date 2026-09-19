import {
	type ArtworkImageSource,
	blobDataUrl,
	canvasBlob,
	decodeImage,
} from "./artwork-image";

const rendered = new WeakMap<Blob, Promise<Blob>>();

/** Presentation only. Extraction and matching must always use the original sample. */
export async function presentArtworkImage(
	source: ArtworkImageSource,
	signal?: AbortSignal,
): Promise<Blob> {
	signal?.throwIfAborted();
	if (!source.preview) return source.blob;
	let result = rendered.get(source.blob);
	if (!result) {
		result = renderFilmPreview(source.blob).catch((error) => {
			rendered.delete(source.blob);
			throw error;
		});
		rendered.set(source.blob, result);
	}
	const blob = await result;
	signal?.throwIfAborted();
	return blob;
}

async function renderFilmPreview(blob: Blob): Promise<Blob> {
	const image = await decodeImage(blob);
	const data = await blobDataUrl(blob);
	// Fixed design coordinates keep the accepted phone texture proportional in cards.
	const width = 366,
		height = (width * image.naturalHeight) / image.naturalWidth;
	const scale = 843 / Math.max(width, height);
	const pixelWidth = Math.max(1, Math.round(width * scale));
	const pixelHeight = Math.max(1, Math.round(height * scale));
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${width} ${height}">
<defs>
  <filter id="film" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation=".6"/>
    <feColorMatrix type="saturate" values=".97"/>
    <feComponentTransfer><feFuncR type="linear" slope=".96768" intercept=".02016"/><feFuncG type="linear" slope=".96768" intercept=".02016"/><feFuncB type="linear" slope=".96768" intercept=".02016"/></feComponentTransfer>
  </filter>
  <filter id="bloom" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".83" numOctaves="3" seed="24" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncR type="linear" slope="3.1" intercept="-1.05"/><feFuncG type="linear" slope="3.1" intercept="-1.05"/><feFuncB type="linear" slope="3.1" intercept="-1.05"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>
  </filter>
  <radialGradient id="vignette" cx="49%" cy="46%" r="70%">
    <stop offset="40%" stop-color="#14110c" stop-opacity="0"/><stop offset="70%" stop-color="#14110c" stop-opacity=".03"/><stop offset="100%" stop-color="#14110c" stop-opacity=".12"/>
  </radialGradient>
</defs>
<g style="isolation:isolate">
  <image href="${data}" x="${-width * 0.005}" y="${-height * 0.005}" width="${width * 1.01}" height="${height * 1.01}" filter="url(#film)"/>
  <image href="${data}" width="${width}" height="${height}" filter="url(#bloom)" opacity=".05" style="mix-blend-mode:screen"/>
  <rect width="100%" height="100%" fill="url(#vignette)"/>
  <rect width="100%" height="100%" filter="url(#grain)" opacity=".38" style="mix-blend-mode:soft-light"/>
</g></svg>`;
	const treated = await decodeImage(new Blob([svg], { type: "image/svg+xml" }));
	const canvas = document.createElement("canvas");
	canvas.width = pixelWidth;
	canvas.height = pixelHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Preview rendering is unavailable.");
	ctx.drawImage(treated, 0, 0);
	return canvasBlob(canvas);
}
