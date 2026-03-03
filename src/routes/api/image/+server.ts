import type { RequestHandler } from './$types';

/**
 * Server-side image proxy for IIIF images.
 *
 * Currently UNUSED — the IIIF server supports CORS (access-control-allow-origin: *)
 * and we fetch images directly from the client. This endpoint is kept as a fallback
 * in case CORS policies change, or for future use with restricted images.
 *
 * Usage: GET /api/image?url=<iiif-url>
 *
 * Security: Only allows URLs from the Art Institute's IIIF domain to prevent
 * abuse as an open proxy.
 */
export const GET: RequestHandler = async ({ url }) => {
	const imageUrl = url.searchParams.get('url');

	// Only proxy Art Institute images — reject everything else
	if (!imageUrl || !imageUrl.startsWith('https://www.artic.edu/iiif/')) {
		return new Response('Invalid or missing image URL', { status: 400 });
	}

	const res = await fetch(imageUrl);

	if (!res.ok) {
		return new Response('Failed to fetch image', { status: res.status });
	}

	const contentType = res.headers.get('content-type') || 'image/jpeg';
	const buffer = await res.arrayBuffer();

	return new Response(buffer, {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
		}
	});
};
