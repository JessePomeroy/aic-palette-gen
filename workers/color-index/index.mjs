// Public, immutable color evidence only. This Worker has one bucket and no write routes.
const ASSET =
	/^\/v3\/[a-z0-9-]{1,80}\/(?:manifest\.json|directory\.bin\.gz|tiles\/\d{1,2}_-?\d{1,2}_-?\d{1,2}\.bin\.gz|metadata\/\d{1,6}\.json\.gz|samples\/\d{1,6}\.pack)$/;
const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, HEAD, OPTIONS",
	"access-control-allow-headers": "Range",
	"access-control-expose-headers":
		"Content-Range, Content-Length, Accept-Ranges, ETag, X-Index-Cache",
	"access-control-max-age": "86400",
};
/** @param {number} status */
const failure = (status) =>
	new Response(null, {
		status,
		headers: { ...CORS, "cache-control": "no-store" },
	});

export default {
	/**
	 * @param {Request} request
	 * @param {{ INDEX_BUCKET: { get(key: string, options?: {range: {offset: number, length: number}}): Promise<{size: number, httpEtag: string, body: ReadableStream<Uint8Array>} | null> } }} env
	 * @param {{ waitUntil(promise: Promise<unknown>): void }} context
	 */
	async fetch(request, env, context) {
		const url = new URL(request.url);
		if (!ASSET.test(url.pathname) || url.search) return failure(404);
		if (request.method === "OPTIONS")
			return new Response(null, { status: 204, headers: CORS });
		if (!["GET", "HEAD"].includes(request.method)) return failure(405);
		const packed = url.pathname.endsWith(".pack"),
			header = request.headers.get("range");
		/** @type {{offset: number, length: number} | undefined} */
		let range;
		if (packed) {
			const match = /^bytes=(\d+)-(\d+)$/.exec(header || "");
			if (!match) return failure(416);
			const start = Number(match[1]),
				end = Number(match[2]);
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				end < start ||
				end - start + 1 > 161000
			)
				return failure(416);
			range = { offset: start, length: end - start + 1 };
		} else if (header) return failure(416);
		// Cache API cannot store 206 responses. Each exact range gets its own 200 cache entry.
		const key = new Request(
			`${url.origin}${url.pathname}${range ? `?range=${range.offset}-${range.length}` : ""}`,
		);
		try {
			const cache = await caches.open("chromacollection-index");
			let response = await cache.match(key);
			const hit = !!response;
			if (!response) {
				const object = await env.INDEX_BUCKET.get(
					url.pathname.slice(1),
					range ? { range } : undefined,
				);
				if (!object) return failure(404);
				if (
					(range && range.offset + range.length > object.size) ||
					(!range && object.size > 8 * 1024 * 1024)
				) {
					await object.body.cancel();
					return failure(range ? 416 : 503);
				}
				const headers = new Headers({
					...CORS,
					"content-type": url.pathname.endsWith(".json")
						? "application/json"
						: "application/octet-stream",
					"content-length": String(range?.length ?? object.size),
					"cache-control": "public, max-age=31536000, immutable, no-transform",
					"x-content-type-options": "nosniff",
					etag: object.httpEtag,
				});
				if (range) {
					headers.set("accept-ranges", "bytes");
					headers.set(
						"content-range",
						`bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
					);
				}
				response = new Response(object.body, { headers });
				context.waitUntil(cache.put(key, response.clone()));
			}
			const headers = new Headers(response.headers);
			headers.set("x-index-cache", hit ? "HIT" : "MISS");
			if (request.method === "HEAD") {
				await response.body?.cancel();
				return new Response(null, { status: range ? 206 : 200, headers });
			}
			return new Response(response.body, {
				status: range ? 206 : 200,
				headers,
			});
		} catch {
			return failure(503);
		}
	},
};
