/**
 * AI Palette Endpoint — uses Google Gemini to analyze artwork mood/tone
 * and suggest a curated color palette.
 *
 * POST /api/ai-palette
 *   Body: { imageUrl: string, count: number }
 *   Returns: { description: string, colors: ExtractedColor[] }
 *
 * The Gemini API key is kept server-side — never exposed to the client.
 */

import type { RequestHandler } from './$types';
import { GEMINI_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { imageUrl, count = 6 } = await request.json();

		if (!imageUrl) {
			return new Response(JSON.stringify({ error: 'Missing imageUrl' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		if (!GEMINI_API_KEY) {
			return new Response(JSON.stringify({ error: 'Gemini API key not configured' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Fetch the image as base64 for Gemini's inline_data format
		// Include browser-like headers — IIIF server may reject bare server-side fetches
		const imageRes = await fetch(imageUrl, {
			headers: {
				'Accept': 'image/jpeg,image/png,image/*',
				'User-Agent': 'Mozilla/5.0 (compatible; aic-palette-gen)',
				'Referer': 'https://www.artic.edu/'
			}
		});
		if (!imageRes.ok) {
			console.error(`Image fetch failed: ${imageRes.status} ${imageRes.statusText} for ${imageUrl}`);
			return new Response(JSON.stringify({ error: `Image not accessible (${imageRes.status})` }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const imageBuffer = await imageRes.arrayBuffer();
		const base64Image = Buffer.from(imageBuffer).toString('base64');
		const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

		// Call Gemini API with vision — retry on 429 (free tier rate limits)
		const geminiBody = JSON.stringify({
			contents: [{
				parts: [
					{
						inline_data: {
							mime_type: mimeType,
							data: base64Image
						}
					},
					{
						text: `You are an art critic and color expert. Analyze this artwork and respond with ONLY valid JSON (no markdown, no code fences, no extra text).

The JSON must have this exact structure:
{
  "description": "2-3 sentences describing the emotional tone, mood, and color atmosphere of this artwork",
  "colors": [
    { "hex": "#xxxxxx", "name": "descriptive color name" }
  ]
}

Suggest exactly ${count} colors that capture the emotional feeling of the artwork — not just the literal colors present, but colors that evoke the same mood. Each color should have a poetic or descriptive name (e.g. "twilight amber", "melancholy blue").`
					}
				]
			}]
		});

		// Retry up to 3 times on 429 (free tier rate limits)
		let geminiRes: Response | null = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			geminiRes = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: geminiBody
				}
			);

			if (geminiRes.status !== 429) break;

			// Wait before retrying — exponential backoff: 5s, 15s, 30s
			const waitMs = [5000, 15000, 30000][attempt];
			console.log(`Gemini 429 rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/3)`);
			await new Promise(r => setTimeout(r, waitMs));
		}

		if (!geminiRes || !geminiRes.ok) {
			const errText = geminiRes ? await geminiRes.text() : 'No response';
			console.error('Gemini API error:', errText);
			const isRateLimit = geminiRes?.status === 429;
			return new Response(JSON.stringify({
				error: isRateLimit
					? 'Something went wrong. Try again later.'
					: `Gemini API returned ${geminiRes?.status}`
			}), {
				status: isRateLimit ? 429 : 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const geminiData = await geminiRes.json();

		// Extract the text response from Gemini
		const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) throw new Error('No response from Gemini');

		// Parse the JSON response — strip markdown fences if present
		const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const parsed = JSON.parse(cleaned);

		// Convert to our ExtractedColor format
		const colors = parsed.colors.map((c: { hex: string; name?: string }) => {
			const hex = c.hex.toLowerCase();
			const r = parseInt(hex.slice(1, 3), 16);
			const g = parseInt(hex.slice(3, 5), 16);
			const b = parseInt(hex.slice(5, 7), 16);

			return {
				hex,
				rgb: { r, g, b },
				hsl: rgbToHsl(r, g, b),
				name: c.name
			};
		});

		return new Response(JSON.stringify({
			description: parsed.description,
			colors
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e: any) {
		console.error('AI palette generation failed:', e?.message || e);
		console.error('Stack:', e?.stack);
		return new Response(JSON.stringify({ error: 'AI palette generation failed', detail: e?.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

/** RGB to HSL conversion (server-side copy) */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
			case g: h = ((b - r) / d + 2) / 6; break;
			case b: h = ((r - g) / d + 4) / 6; break;
		}
	}
	return {
		h: Math.round(h * 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100)
	};
}
