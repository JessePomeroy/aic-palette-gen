/**
 * Palette API — save palettes for shareable links.
 *
 * POST /api/palette
 *   Body: { artworkId, colors, mode, count }
 *   Returns: { id, url } — the UUID and shareable URL
 */

import { randomUUID } from "node:crypto";
import { savePalette } from "$lib/db";
import {
	PaletteRequestError,
	readPaletteRequest,
} from "$lib/server/palette-request";
import { createWriteLimiter } from "$lib/server/write-limiter";
import type { RequestHandler } from "./$types";

const limitSave = createWriteLimiter(10, 100);

export const POST: RequestHandler = async ({
	request,
	url,
	getClientAddress,
}) => {
	try {
		const retryAfter = limitSave(getClientAddress());
		if (retryAfter)
			return Response.json(
				{
					error: "Too many share requests. Please wait a minute and try again.",
				},
				{ status: 429, headers: { "Retry-After": String(retryAfter) } },
			);
		const palette = await readPaletteRequest(request, url.origin);

		// Generate a UUID for the shareable link
		const id = randomUUID();

		await savePalette({ id, ...palette });

		// Build the shareable URL
		const paletteUrl = `${url.origin}/palette/${id}`;

		return new Response(JSON.stringify({ id, url: paletteUrl }), {
			status: 201,
			headers: { "Content-Type": "application/json" },
		});
	} catch (e) {
		if (e instanceof PaletteRequestError)
			return Response.json({ error: e.message }, { status: e.status });
		// Database exceptions may contain connection details; do not log them.
		console.error("Palette persistence unavailable");
		return Response.json(
			{
				error:
					"Sharing is temporarily unavailable. Your palette is still here; please try again shortly.",
			},
			{ status: 503, headers: { "Retry-After": "30" } },
		);
	}
};
