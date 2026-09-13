import type { ExtractedColor, ExtractionMode } from "../colors/extraction";

export const MAX_PALETTE_BYTES = 16 * 1024;

export class PaletteRequestError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 403 | 413 | 415,
	) {
		super(message);
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberIn(value: unknown, max: number): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= max
	);
}

export function parsePalette(value: unknown): {
	artworkId: number;
	colors: ExtractedColor[];
	mode: ExtractionMode;
	count: number;
} {
	const invalid = () =>
		new PaletteRequestError(
			"Choose an artwork and 5–8 valid colors before sharing.",
			400,
		);
	if (
		!record(value) ||
		typeof value.artworkId !== "number" ||
		!Number.isSafeInteger(value.artworkId) ||
		value.artworkId < 1 ||
		value.artworkId > 2147483647 ||
		typeof value.count !== "number" ||
		!Number.isInteger(value.count) ||
		value.count < 5 ||
		value.count > 8 ||
		!Array.isArray(value.colors) ||
		value.colors.length !== value.count ||
		(value.mode !== "dominant" &&
			value.mode !== "vibrant" &&
			value.mode !== "ai")
	)
		throw invalid();
	const colors = value.colors.map((color): ExtractedColor => {
		if (
			!record(color) ||
			typeof color.hex !== "string" ||
			!/^#[0-9a-f]{6}$/i.test(color.hex) ||
			!record(color.rgb) ||
			!record(color.hsl)
		)
			throw invalid();
		const { r, g, b } = color.rgb;
		const { h, s, l } = color.hsl;
		if (
			!numberIn(r, 255) ||
			!Number.isInteger(r) ||
			!numberIn(g, 255) ||
			!Number.isInteger(g) ||
			!numberIn(b, 255) ||
			!Number.isInteger(b) ||
			!numberIn(h, 360) ||
			!numberIn(s, 100) ||
			!numberIn(l, 100)
		)
			throw invalid();
		if (
			r !== parseInt(color.hex.slice(1, 3), 16) ||
			g !== parseInt(color.hex.slice(3, 5), 16) ||
			b !== parseInt(color.hex.slice(5, 7), 16)
		)
			throw invalid();
		if (
			color.name !== undefined &&
			(typeof color.name !== "string" || color.name.length > 80)
		)
			throw invalid();
		return {
			hex: color.hex,
			rgb: { r, g, b },
			hsl: { h, s, l },
			...(typeof color.name === "string" ? { name: color.name } : {}),
		};
	});
	return {
		artworkId: value.artworkId,
		colors,
		mode: value.mode,
		count: value.count,
	};
}

/** Read a bounded JSON body even when the caller omits or lies about Content-Length. */
export async function readPaletteRequest(request: Request, origin: string) {
	const requestOrigin = request.headers.get("origin");
	if (
		(requestOrigin && requestOrigin !== origin) ||
		request.headers.get("sec-fetch-site") === "cross-site"
	) {
		throw new PaletteRequestError("Share palettes from this site.", 403);
	}
	if (
		request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
		"application/json"
	) {
		throw new PaletteRequestError("Expected a JSON palette.", 415);
	}
	const tooLarge = () =>
		new PaletteRequestError("Palette exceeds the 16 KB size limit.", 413);
	if (Number(request.headers.get("content-length")) > MAX_PALETTE_BYTES)
		throw tooLarge();
	const reader = request.body?.getReader();
	if (!reader) throw new PaletteRequestError("Missing palette.", 400);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_PALETTE_BYTES) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	let value: unknown;
	try {
		value = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
		);
	} catch {
		throw new PaletteRequestError("Invalid palette JSON.", 400);
	}
	return parsePalette(value);
}
