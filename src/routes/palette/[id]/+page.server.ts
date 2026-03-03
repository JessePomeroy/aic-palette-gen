/**
 * Server load function for shared palette pages.
 * Fetches the saved palette from Neon and the artwork from the AIC API.
 */

import type { PageServerLoad } from './$types';
import { getPalette } from '$lib/db';
import { getArtwork } from '$lib/api/artic';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const palette = await getPalette(params.id);

	if (!palette) {
		throw error(404, 'Palette not found');
	}

	// Fetch the artwork details from the AIC API
	const artwork = await getArtwork(palette.artwork_id);

	return {
		palette: {
			id: palette.id,
			colors: typeof palette.colors === 'string' ? JSON.parse(palette.colors) : palette.colors,
			mode: palette.mode,
			count: palette.count,
			created_at: palette.created_at
		},
		artwork
	};
};
