import { mount, tick, unmount } from "svelte";
import type { Artwork } from "../api/artic";
import alluraUrl from "../assets/fonts/allura-400.ttf?url";
import dancingScriptUrl from "../assets/fonts/dancing-script-500.ttf?url";
import type { ExtractedColor } from "../colors/extraction";
import ArtworkCard from "../components/ArtworkCard.svelte";
import cardStyles from "../components/artwork-card.css?inline";
import { blobDataUrl, loadArtworkImage } from "../images/artwork-image";
import { presentArtworkImage } from "../images/preview-treatment";

async function embeddedFont(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!response.ok) throw new Error("Could not load the card fonts.");
	return blobDataUrl(await response.blob());
}

/** The same HTML/CSS as the preview; canvas only encodes the rendered card to PNG. */
export async function exportCard(
	artwork: Artwork,
	colors: ExtractedColor[],
): Promise<Blob> {
	if (!artwork.image_id || !colors.length)
		throw new Error("Choose an artwork and palette first.");
	const [source, allura, dancingScript] = await Promise.all([
		loadArtworkImage(artwork),
		embeddedFont(alluraUrl),
		embeddedFont(dancingScriptUrl),
	]);
	const imageUrl = await blobDataUrl(await presentArtworkImage(source));
	const width = 1200;
	const target = document.createElement("div");
	target.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;pointer-events:none;`;
	target.setAttribute("aria-hidden", "true");
	target.inert = true;
	document.body.append(target);
	const component = mount(ArtworkCard, {
		target,
		props: { artwork, colors, imageUrl, imagePreview: source.preview },
	});
	try {
		await tick();
		await Promise.all([
			document.fonts.load('400 80px "Chroma Allura"'),
			document.fonts.load('500 40px "Chroma Dancing Script"'),
		]);
		const card = target.firstElementChild;
		if (!(card instanceof HTMLElement))
			throw new Error("Could not render the artwork card.");
		const artworkImage = card.querySelector("img");
		if (!artworkImage) throw new Error("Could not render the artwork image.");
		await artworkImage.decode();
		const cardBounds = card.getBoundingClientRect();
		const imageBounds = artworkImage.getBoundingClientRect();
		const imageStyle = getComputedStyle(artworkImage);
		const borderX = parseFloat(imageStyle.borderLeftWidth);
		const borderY = parseFloat(imageStyle.borderTopWidth);
		const imageWidth =
			imageBounds.width - borderX - parseFloat(imageStyle.borderRightWidth);
		const imageHeight =
			imageBounds.height - borderY - parseFloat(imageStyle.borderBottomWidth);
		const imageScale = Math.min(
			imageWidth / artworkImage.naturalWidth,
			imageHeight / artworkImage.naturalHeight,
		);
		const drawnWidth = artworkImage.naturalWidth * imageScale;
		const drawnHeight = artworkImage.naturalHeight * imageScale;
		const height = Math.ceil(card.getBoundingClientRect().height);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", String(width));
		svg.setAttribute("height", String(height));
		const content = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"foreignObject",
		);
		content.setAttribute("width", "100%");
		content.setAttribute("height", "100%");
		const style = document.createElement("style");
		style.textContent = cardStyles
			.replaceAll(alluraUrl, allura)
			.replaceAll(dancingScriptUrl, dancingScript);
		const snapshot = card.cloneNode(true);
		if (!(snapshot instanceof HTMLElement))
			throw new Error("Could not capture the artwork card.");
		// WebKit can omit nested images inside foreignObject. Keep the CSS frame,
		// then composite the original at the exact object-fit bounds measured above.
		const imagePlaceholder = document.createElement("div");
		imagePlaceholder.className = artworkImage.className;
		snapshot.querySelector("img")?.replaceWith(imagePlaceholder);
		snapshot.insertBefore(style, snapshot.firstChild);
		content.append(snapshot);
		svg.append(content);
		const rendered = new Image();
		rendered.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
		await rendered.decode();
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Image export is unavailable in this browser.");
		ctx.drawImage(rendered, 0, 0);
		ctx.drawImage(
			artworkImage,
			imageBounds.left -
				cardBounds.left +
				borderX +
				(imageWidth - drawnWidth) / 2,
			imageBounds.top -
				cardBounds.top +
				borderY +
				(imageHeight - drawnHeight) / 2,
			drawnWidth,
			drawnHeight,
		);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) =>
					blob
						? resolve(blob)
						: reject(new Error("Could not export the artwork card.")),
				"image/png",
			),
		);
	} finally {
		await unmount(component);
		target.remove();
	}
}
