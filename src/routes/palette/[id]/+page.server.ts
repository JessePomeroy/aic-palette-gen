/**
 * Server load function for shared palette pages.
 * Fetches the saved palette from Neon and the artwork from the AIC API.
 */

import { error } from "@sveltejs/kit";
import { getArtwork } from "$lib/api/artic";
import { getPalette } from "$lib/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			params.id,
		)
	) {
		error(404, "Palette not found");
	}
	let palette: Awaited<ReturnType<typeof getPalette>>;
	try {
		palette = await getPalette(params.id);
	} catch {
		error(
			503,
			"Saved palettes are temporarily unavailable. Please try again shortly.",
		);
	}

	if (!palette) {
		throw error(404, "Palette not found");
	}

	// Fetch the artwork details from the AIC API
	const artwork = await getArtwork(palette.artwork_id);

	return {
		palette: {
			id: palette.id,
			colors:
				typeof palette.colors === "string"
					? JSON.parse(palette.colors)
					: palette.colors,
			mode: palette.mode,
			count: palette.count,
			created_at: palette.created_at,
		},
		artwork,
	};
};
