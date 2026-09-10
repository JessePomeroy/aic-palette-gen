import type { RequestHandler } from './$types';

/**
 * Server-side image proxy for IIIF images.
 *
 * Palette extraction uses this endpoint so browser clients do not depend on the
 * IIIF server's CORS behavior. Display-only images can still load directly.
 *
 * Usage: GET /api/image?url=<iiif-url>
 *
 * Security: Only allows URLs from the Art Institute's IIIF domain to prevent
 * abuse as an open proxy.
 */
export const GET: RequestHandler = async ({ url }) => {
	const imageUrl = url.searchParams.get('url');

	if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
		return new Response('Invalid or missing image URL', { status: 400 });
	}

	let res: Response;
	try {
		res = await fetch(imageUrl, {
			redirect: 'error',
			headers: {
				'Accept': 'image/jpeg,image/png,image/*',
				'User-Agent': 'Mozilla/5.0 (compatible; aic-palette-gen)',
				'Referer': 'https://www.artic.edu/'
			}
		});
	} catch {
		return new Response('Failed to fetch image', { status: 502 });
	}

	if (!res.ok) {
		return new Response('Failed to fetch image', { status: res.status });
	}

	const contentType = res.headers.get('content-type') || 'image/jpeg';
	if (!contentType.toLowerCase().startsWith('image/')) {
		return new Response('Upstream response was not an image', { status: 502 });
	}

	return new Response(res.body, {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
		}
	});
};

function isAllowedImageUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:'
			&& parsed.hostname === 'www.artic.edu'
			&& parsed.port === ''
			&& parsed.username === ''
			&& parsed.password === ''
			&& parsed.pathname.startsWith('/iiif/2/');
	} catch {
		return false;
	}
}
