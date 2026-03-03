/**
 * Palette API — save palettes for shareable links.
 *
 * POST /api/palette
 *   Body: { artworkId, colors, mode, count }
 *   Returns: { id, url } — the UUID and shareable URL
 */

import type { RequestHandler } from './$types';
import { savePalette } from '$lib/db';
import { randomUUID } from 'crypto';

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const body = await request.json();
		const { artworkId, colors, mode, count } = body;

		// Validate required fields
		if (!artworkId || !colors || !mode || !count) {
			return new Response(JSON.stringify({ error: 'Missing required fields' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Generate a UUID for the shareable link
		const id = randomUUID();

		await savePalette({ id, artworkId, colors, mode, count });

		// Build the shareable URL
		const paletteUrl = `${url.origin}/palette/${id}`;

		return new Response(JSON.stringify({ id, url: paletteUrl }), {
			status: 201,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		console.error('Failed to save palette:', e);
		return new Response(JSON.stringify({ error: 'Failed to save palette' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
