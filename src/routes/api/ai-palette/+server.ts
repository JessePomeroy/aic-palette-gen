/**
 * POST /api/ai-palette?count=5
 * Body: JPEG bytes (maximum 1 MB). Returns a validated tone palette.
 * Provider credentials and errors stay server-side.
 */
import { env } from "$env/dynamic/private";
import { readToneImage } from "$lib/server/tone-image";
import { readToneResponse } from "$lib/server/tone-response";
import { createWriteLimiter } from "$lib/server/write-limiter";
import type { RequestHandler } from "./$types";

export const config = { maxDuration: 45 };

const limitTone = createWriteLimiter(3, 20);

export const POST: RequestHandler = async ({
	request,
	url,
	getClientAddress,
}) => {
	const requestOrigin = request.headers.get("origin");
	if (
		(requestOrigin && requestOrigin !== url.origin) ||
		request.headers.get("sec-fetch-site") === "cross-site"
	) {
		return Response.json(
			{ error: "Generate tone from this site." },
			{ status: 403 },
		);
	}
	const count = Number(url.searchParams.get("count") ?? "6");
	if (!Number.isInteger(count) || count < 5 || count > 8) {
		return Response.json(
			{ error: "Color count must be between 5 and 8" },
			{ status: 400 },
		);
	}
	const retryAfter = limitTone(getClientAddress());
	if (retryAfter)
		return Response.json(
			{ error: "Too many tone requests. Please wait a minute and try again." },
			{ status: 429, headers: { "Retry-After": String(retryAfter) } },
		);
	let imageBuffer: Buffer;
	try {
		imageBuffer = await readToneImage(request);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "Invalid image" },
			{ status: 400 },
		);
	}
	if (!env.GEMINI_API_KEY) {
		return Response.json(
			{ error: "Tone generation is temporarily unavailable." },
			{ status: 503 },
		);
	}
	const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
	try {
		// One provider call per explicit action. Automatic retries can multiply cost
		// and hold the workbench busy long after a provider rate-limit response.
		const response = await fetch(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": env.GEMINI_API_KEY,
				},
				signal,
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{
									inline_data: {
										mime_type: "image/jpeg",
										data: imageBuffer.toString("base64"),
									},
								},
								{
									text: `You are an art critic and color expert. Analyze this artwork and respond with ONLY valid JSON.
The JSON must contain "description": 2-3 sentences describing its emotional tone, mood, and color atmosphere; and "colors": an array of exactly ${count} objects with "hex" (a six-digit #RRGGBB color) and "name" (a short descriptive color name).
Suggest colors that capture the emotional feeling of the artwork, not just the literal colors present. Each color should have a poetic or descriptive name, such as "twilight amber".`,
								},
							],
						},
					],
					generationConfig: {
						responseMimeType: "application/json",
						maxOutputTokens: 1024,
					},
				}),
			},
		);
		if (response.status === 429)
			return Response.json(
				{ error: "Tone generation is busy. Please try again in a minute." },
				{ status: 429, headers: { "Retry-After": "60" } },
			);
		if (!response.ok)
			return Response.json(
				{
					error:
						"Tone generation is temporarily unavailable. Please try again later.",
				},
				{ status: 502 },
			);
		return Response.json(readToneResponse(await response.json(), count));
	} catch {
		// Do not expose provider bodies, exception messages, stack traces, or keys.
		return Response.json(
			{
				error: signal.aborted
					? "Tone generation timed out. Please try again."
					: "Tone returned an incomplete palette. Please try again.",
			},
			{ status: signal.aborted ? 504 : 502 },
		);
	}
};
