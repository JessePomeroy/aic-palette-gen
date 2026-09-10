import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { GET } from '../src/routes/api/image/+server.ts';

const originalFetch = globalThis.fetch;
const imageUrl = 'https://www.artic.edu/iiif/2/example/full/843,/0/default.jpg';

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function eventFor(upstreamUrl?: string): Parameters<typeof GET>[0] {
	const url = new URL('http://localhost/api/image');
	if (upstreamUrl) url.searchParams.set('url', upstreamUrl);
	return { url } as Parameters<typeof GET>[0];
}

test('proxies an AIC IIIF image with the headers required by the CDN', async () => {
	globalThis.fetch = async (input, init) => {
		assert.equal(input, imageUrl);
		assert.equal(init?.redirect, 'error');
		assert.equal(init?.headers && new Headers(init.headers).get('Accept'), 'image/jpeg,image/png,image/*');
		assert.equal(init?.headers && new Headers(init.headers).get('User-Agent'), 'Mozilla/5.0 (compatible; aic-palette-gen)');
		assert.equal(init?.headers && new Headers(init.headers).get('Referer'), 'https://www.artic.edu/');

		return new Response(new Uint8Array([1, 2, 3]), {
			headers: { 'Content-Type': 'image/jpeg' }
		});
	};

	const response = await GET(eventFor(imageUrl));

	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
	assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('rejects missing, non-AIC, and path-normalized image URLs without fetching', async () => {
	globalThis.fetch = async () => {
		throw new Error('fetch should not be called');
	};

	const invalidUrls = [
		undefined,
		'http://www.artic.edu/iiif/2/example/full/843,/0/default.jpg',
		'https://example.com/iiif/2/example/full/843,/0/default.jpg',
		'https://www.artic.edu/iiif/../robots.txt'
	];

	for (const invalidUrl of invalidUrls) {
		const response = await GET(eventFor(invalidUrl));
		assert.equal(response.status, 400);
	}
});

test('preserves the upstream failure status', async () => {
	globalThis.fetch = async () => new Response('Forbidden', { status: 403 });

	const response = await GET(eventFor(imageUrl));

	assert.equal(response.status, 403);
	assert.equal(await response.text(), 'Failed to fetch image');
});

test('rejects successful upstream responses that are not images', async () => {
	globalThis.fetch = async () => new Response('<html>challenge</html>', {
		headers: { 'Content-Type': 'text/html' }
	});

	const response = await GET(eventFor(imageUrl));

	assert.equal(response.status, 502);
	assert.equal(await response.text(), 'Upstream response was not an image');
});

test('maps upstream network failures to a bad gateway response', async () => {
	globalThis.fetch = async () => {
		throw new TypeError('network failed');
	};

	const response = await GET(eventFor(imageUrl));

	assert.equal(response.status, 502);
	assert.equal(await response.text(), 'Failed to fetch image');
});
