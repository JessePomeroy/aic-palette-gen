import type { Artwork } from "./api/artic";
import type { ExtractedColor, ExtractionMode } from "./colors/extraction";

export const HISTORY_KEY = "chroma-history-v1";
export const HISTORY_LIMIT = 24;
export interface RecentPalette {
	id: string;
	artwork: Artwork;
	colors: ExtractedColor[];
	locks: (ExtractedColor | null)[];
	mode: ExtractionMode;
	description: string;
}

export function rememberPalette(
	history: RecentPalette[],
	entry: Omit<RecentPalette, "id">,
): RecentPalette[] {
	const id = `${entry.artwork.id}:${entry.mode}:${entry.colors.map((c) => c.hex).join(",")}`;
	return [{ ...entry, id }, ...history.filter((item) => item.id !== id)].slice(
		0,
		HISTORY_LIMIT,
	);
}

function isColor(value: unknown): value is ExtractedColor {
	if (
		!value ||
		typeof value !== "object" ||
		!("hex" in value) ||
		typeof value.hex !== "string" ||
		!/^#[0-9a-f]{6}$/i.test(value.hex)
	)
		return false;
	if (
		!("rgb" in value) ||
		!value.rgb ||
		typeof value.rgb !== "object" ||
		!("hsl" in value) ||
		!value.hsl ||
		typeof value.hsl !== "object"
	)
		return false;
	const rgb = value.rgb,
		hsl = value.hsl;
	return (
		"r" in rgb &&
		"g" in rgb &&
		"b" in rgb &&
		[rgb.r, rgb.g, rgb.b].every(
			(x) => typeof x === "number" && x >= 0 && x <= 255,
		) &&
		"h" in hsl &&
		"s" in hsl &&
		"l" in hsl &&
		[hsl.h, hsl.s, hsl.l].every(
			(x) => typeof x === "number" && Number.isFinite(x),
		) &&
		(!("name" in value) ||
			value.name === undefined ||
			typeof value.name === "string")
	);
}

/** Treat saved browser data as untrusted; corrupt or old entries cannot break startup. */
export function parseHistory(raw: string | null): RecentPalette[] {
	try {
		if (!raw || raw.length > 500_000) return [];
		const entries: unknown = JSON.parse(raw);
		if (!Array.isArray(entries)) return [];
		return entries
			.filter((entry): entry is RecentPalette => {
				if (!entry || typeof entry !== "object") return false;
				const art = entry.artwork;
				return (
					typeof entry.id === "string" &&
					typeof entry.description === "string" &&
					["dominant", "vibrant", "ai"].includes(entry.mode) &&
					art &&
					Number.isInteger(art.id) &&
					art.id > 0 &&
					typeof art.title === "string" &&
					typeof art.image_id === "string" &&
					/^[a-zA-Z0-9-]+$/.test(art.image_id) &&
					(art.artist_display == null ||
						typeof art.artist_display === "string") &&
					(art.date_display == null || typeof art.date_display === "string") &&
					(art.artist_title == null || typeof art.artist_title === "string") &&
					(art.medium_display == null ||
						typeof art.medium_display === "string") &&
					(art.copyright_notice == null ||
						typeof art.copyright_notice === "string") &&
					(art.is_public_domain === undefined ||
						typeof art.is_public_domain === "boolean") &&
					Array.isArray(entry.colors) &&
					entry.colors.length >= 5 &&
					entry.colors.length <= 8 &&
					entry.colors.every(isColor) &&
					Array.isArray(entry.locks) &&
					entry.locks.length <= entry.colors.length &&
					entry.locks.every(
						(c: unknown, i: number) =>
							c === null || (isColor(c) && c.hex === entry.colors[i].hex),
					)
				);
			})
			.filter(
				(entry, i, entries) =>
					entries.findIndex((item) => item.id === entry.id) === i,
			)
			.slice(0, HISTORY_LIMIT);
	} catch {
		return [];
	}
}
