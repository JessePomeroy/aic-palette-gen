import type { Artwork } from "../api/artic";

const IMAGE_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize public museum metadata once, before releasing or loading a catalog. */
export function readIndexedArtwork(value: unknown): Artwork {
	if (
		!record(value) ||
		typeof value.id !== "number" ||
		!Number.isSafeInteger(value.id) ||
		value.id <= 0 ||
		typeof value.title !== "string" ||
		!value.title.trim() ||
		typeof value.image_id !== "string" ||
		!IMAGE_ID.test(value.image_id) ||
		value.is_public_domain !== true
	)
		throw new Error("Invalid public-domain indexed artwork");
	const text = (key: string) =>
		typeof value[key] === "string" ? value[key] : "";
	const thumbnail = record(value.thumbnail) ? value.thumbnail : {};
	const dimension = (key: string) =>
		typeof thumbnail[key] === "number" &&
		Number.isFinite(thumbnail[key]) &&
		thumbnail[key] > 0
			? thumbnail[key]
			: 0;
	return {
		id: value.id,
		title: value.title,
		image_id: value.image_id,
		is_public_domain: true,
		artist_display: text("artist_display"),
		artist_title: text("artist_title"),
		artist_id:
			typeof value.artist_id === "number" &&
			Number.isSafeInteger(value.artist_id) &&
			value.artist_id > 0
				? value.artist_id
				: null,
		date_start:
			typeof value.date_start === "number" && Number.isFinite(value.date_start)
				? value.date_start
				: undefined,
		date_end:
			typeof value.date_end === "number" && Number.isFinite(value.date_end)
				? value.date_end
				: undefined,
		date_display: text("date_display"),
		medium_display: text("medium_display"),
		copyright_notice: text("copyright_notice"),
		thumbnail: {
			alt_text:
				typeof thumbnail.alt_text === "string" ? thumbnail.alt_text : "",
			width: dimension("width"),
			height: dimension("height"),
		},
	};
}

export function readArtworkCatalog(value: unknown): Map<number, Artwork> {
	if (!record(value) || value.version !== 1 || !Array.isArray(value.artworks))
		throw new Error("Invalid artwork catalog");
	const artworks = new Map<number, Artwork>();
	for (const row of value.artworks) {
		const artwork = readIndexedArtwork(row);
		if (artworks.has(artwork.id)) throw new Error("Duplicate catalog artwork");
		artworks.set(artwork.id, artwork);
	}
	return artworks;
}
