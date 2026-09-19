import { gzipSync } from "node:zlib";
import {
	type AuditedEntry,
	sha256,
	writeShardRelease,
} from "../../scripts/lib/shard-builder.ts";
import type { Artwork } from "../../src/lib/api/artic.ts";
import {
	analyzeColorSignature,
	colorSampleDigest,
} from "../../src/lib/colors/color-index.ts";

export async function shardFixture(
	rows: readonly (readonly string[])[] = [
		["#00ff00"],
		["#777777"],
		["#ff0000", "#00ff00"],
		["#444f40"],
		["#e8c0c8"],
		["#bd9751"],
	],
	artworks?: readonly Artwork[],
	dimensions?: readonly { width: number; height: number }[],
) {
	const root = "https://index.test/v3/fixture",
		files = new Map<string, Uint8Array>();
	const asset = (path: string) => {
		const bytes = files.get(path);
		if (!bytes) throw new Error(`Missing fixture asset: ${path}`);
		return bytes;
	};
	const entries: (AuditedEntry & { pixels: Uint8Array })[] = [];
	for (let i = 0; i < rows.length; i++) {
		const pixels = new Uint8Array(
			rows[i].flatMap((hex) => [
				parseInt(hex.slice(1, 3), 16),
				parseInt(hex.slice(3, 5), 16),
				parseInt(hex.slice(5), 16),
				255,
			]),
		);
		const artwork: Artwork = artworks?.[i] ?? {
			id: i + 1,
			title: `Artwork ${i + 1}`,
			artist_display: "Fixture artist",
			date_display: "2026",
			medium_display: "Synthetic pixels",
			image_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
			is_public_domain: true,
			thumbnail: { width: rows[i].length, height: 1, alt_text: "Fixture" },
		};
		const imageId = artwork.image_id;
		if (!imageId) throw new Error("Fixture artwork needs an image");
		entries.push({
			artwork,
			pixels,
			entry: {
				artworkId: artwork.id,
				imageId,
				sourceUpdatedAt: null,
				signature: analyzeColorSignature(pixels),
				sample: {
					width: dimensions?.[i].width ?? rows[i].length,
					height: dimensions?.[i].height ?? 1,
					sha256: await colorSampleDigest(pixels),
				},
			},
			compressedSample: gzipSync(pixels),
		});
	}
	async function* source() {
		yield* entries;
	}
	const manifest = await writeShardRelease(
		source(),
		entries.length,
		"2026-09-14T12:50:54.682Z",
		async (path, bytes) => {
			files.set(path, bytes);
		},
	);
	const requests: {
		path: string;
		range: string | null;
		cache?: RequestCache;
	}[] = [];
	const unavailable = new Set<string>(),
		corrupt = new Set<string>();
	let wrongRange = false;
	const fetcher: typeof fetch = async (input, init) => {
		init?.signal?.throwIfAborted();
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const path =
			url === "/color-index/release.json"
				? "release.json"
				: url.slice(`${root}/`.length);
		const range = new Headers(init?.headers).get("range");
		requests.push({ path, range, cache: init?.cache });
		if (unavailable.has(path))
			return new Response("Unavailable", { status: 503 });
		if (path === "release.json")
			return Response.json({
				root,
				sha256: sha256(asset("manifest.json")),
			});
		const data = files.get(path);
		if (!data) return new Response("Not found", { status: 404 });
		const bytes = Uint8Array.from(data);
		if (corrupt.has(path)) bytes[bytes.length - 1] ^= 255;
		if (range) {
			const match = /^bytes=(\d+)-(\d+)$/.exec(range);
			if (!match) return new Response(null, { status: 416 });
			const start = Number(match[1]),
				end = Number(match[2]);
			return new Response(bytes.slice(start, end + 1), {
				status: 206,
				headers: {
					"content-range": `bytes ${wrongRange ? start + 1 : start}-${end}/${bytes.length}`,
				},
			});
		}
		return new Response(bytes);
	};
	return {
		root,
		files,
		asset,
		entries,
		manifest,
		fetcher,
		requests,
		unavailable,
		corrupt,
		wrongRange: (value: boolean) => {
			wrongRange = value;
		},
	};
}
