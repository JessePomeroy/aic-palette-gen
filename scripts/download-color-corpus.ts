import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Artwork } from "../src/lib/api/artic.ts";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog.ts";
import { readManifest } from "./build-color-index.ts";

// A bounded, category-balanced corpus, not a collection-wide crawl.
const QUERIES = [
	"landscape painting",
	"portrait painting",
	"still life painting",
	"Japanese color woodblock",
	"textile silk",
	"ceramic vase",
	"Chinese bronze",
	"stained glass",
	"color lithograph",
	"watercolor flowers",
];
const FIELDS = [
	"id",
	"title",
	"image_id",
	"artist_title",
	"artist_id",
	"artist_display",
	"date_display",
	"date_start",
	"date_end",
	"medium_display",
	"is_public_domain",
	"copyright_notice",
	"thumbnail",
	"source_updated_at",
];

export async function downloadColorCorpus(
	output: string,
	limit = 500,
	base?: { manifest: string; catalog: string },
) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2500)
		throw new Error("Choose a bounded corpus between 1 and 2500 artworks");
	const baseManifest = base
		? readManifest(JSON.parse(await readFile(base.manifest, "utf8")))
		: undefined;
	const baseCatalog = base
		? readArtworkCatalog(JSON.parse(await readFile(base.catalog, "utf8")))
		: new Map<number, Artwork>();
	const entries = (baseManifest?.entries ?? []).map((entry) => ({
		...entry,
		imagePath: resolve(dirname(base?.manifest ?? ""), entry.imagePath),
	}));
	const artworks: Artwork[] = [];
	for (const entry of entries) {
		const artwork = baseCatalog.get(entry.artworkId);
		if (!artwork || artwork.image_id !== entry.imageId)
			throw new Error("Base manifest and catalog do not agree");
		await access(entry.imagePath);
		artworks.push(artwork);
	}
	const reused = entries.length;
	if (reused > limit)
		throw new Error("Target must not be smaller than the existing corpus");
	const needed = limit - reused;
	const existingIds = new Set(entries.map((entry) => entry.artworkId));
	const root = resolve(output);
	await mkdir(root); // Never overwrite a previous download or release.
	await mkdir(resolve(root, "originals"));
	let lastRequest = 0;
	const request = async (url: string) => {
		await delay(Math.max(0, 1000 - (Date.now() - lastRequest)));
		lastRequest = Date.now();
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10000),
			redirect: "error",
			headers: {
				Accept: "application/json,image/jpeg",
				"User-Agent": "Mozilla/5.0 (compatible; ChromaCollection)",
				Referer: "https://www.artic.edu/",
			},
		});
		if (response.status === 429)
			throw new Error("Museum rate limit reached; stopping downloads");
		return response;
	};
	const pools: { artwork: Artwork; updatedAt: string | null }[][] = [];
	for (const query of needed ? QUERIES : []) {
		const rows: { artwork: Artwork; updatedAt: string | null }[] = [];
		// Allow overlap between categories, reused IDs, and unusable images.
		const pages = Math.max(
			base ? 2 : 1,
			2 * Math.ceil(limit / QUERIES.length / 100),
		);
		for (let page = 1; page <= pages; page++) {
			const params = {
				q: query,
				query: {
					bool: {
						filter: [
							{ term: { is_public_domain: true } },
							{ exists: { field: "image_id" } },
						],
					},
				},
				fields: FIELDS,
				limit: Math.min(100, Math.ceil(limit / QUERIES.length) + 30),
				page,
			};
			const response = await request(
				`https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({ params: JSON.stringify(params) })}`,
			);
			if (!response.ok)
				throw new Error(`Metadata request failed (${response.status})`);
			const json: unknown = await response.json();
			if (
				!json ||
				typeof json !== "object" ||
				!("data" in json) ||
				!Array.isArray(json.data)
			)
				throw new Error("Invalid museum response");
			for (const row of json.data) {
				try {
					const artwork = readIndexedArtwork(row);
					if (existingIds.has(artwork.id)) continue;
					const updatedAt =
						typeof row.source_updated_at === "string" &&
						Number.isFinite(Date.parse(row.source_updated_at))
							? row.source_updated_at
							: null;
					rows.push({ artwork, updatedAt });
				} catch {
					/* Records lacking public-domain image metadata are not eligible. */
				}
			}
			if (json.data.length < params.limit) break;
		}
		pools.push(rows);
	}
	// Round-robin categories so failures or a small limit cannot privilege one medium.
	const selected = new Map<
		number,
		{ artwork: Artwork; updatedAt: string | null }
	>();
	for (let i = 0; pools.some((pool) => i < pool.length); i++) {
		for (const pool of pools) {
			const row = pool[i];
			if (row) selected.set(row.artwork.id, row);
		}
	}
	await writeFile(
		resolve(root, "selected.json"),
		JSON.stringify(
			{ queries: QUERIES, artworks: [...selected.values()] },
			null,
			2,
		),
		{ flag: "wx" },
	);
	const skipped: { artworkId: number; reason: string }[] = [];
	let attempted = 0;
	for (const { artwork, updatedAt } of selected.values()) {
		if (entries.length >= limit) break;
		attempted++;
		const imagePath = `originals/${artwork.id}.jpg`;
		let bytes: Uint8Array;
		try {
			const response = await request(
				`https://www.artic.edu/iiif/2/${artwork.image_id}/full/843,/0/default.jpg`,
			);
			if (
				!response.ok ||
				!response.headers.get("content-type")?.startsWith("image/jpeg")
			) {
				skipped.push({
					artworkId: artwork.id,
					reason: `image-unavailable-${response.status}`,
				});
				continue;
			}
			bytes = new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			if (error instanceof Error && error.message.includes("rate limit"))
				throw error;
			skipped.push({ artworkId: artwork.id, reason: "image-request-failed" });
			continue;
		}
		// The existing decoder does not normalize ICC profiles. Do not silently
		// reinterpret tagged images as sRGB; report and leave them out of this release.
		if (Buffer.from(bytes).includes(Buffer.from("ICC_PROFILE\0"))) {
			skipped.push({
				artworkId: artwork.id,
				reason: "embedded-icc-needs-normalization",
			});
			continue;
		}
		await writeFile(resolve(root, imagePath), bytes, { flag: "wx" });
		if (!artwork.image_id)
			throw new Error("Indexed artwork lost its image identifier");
		entries.push({
			artworkId: artwork.id,
			imageId: artwork.image_id,
			sourceUpdatedAt: updatedAt,
			imagePath,
		});
		artworks.push(artwork);
		if ((entries.length + skipped.length) % 25 === 0)
			console.log(
				`Prepared ${entries.length}/${limit}; skipped ${skipped.length}; candidates ${selected.size}.`,
			);
	}
	const corpus = `${entries.length}-artwork public-domain starter corpus; ten search categories; untagged JPEGs interpreted as sRGB`;
	await writeFile(
		resolve(root, "manifest.json"),
		JSON.stringify(
			{ version: 1, colorSpace: "srgb", corpus, entries },
			null,
			2,
		),
		{ flag: "wx" },
	);
	await writeFile(
		resolve(root, "artworks.json"),
		JSON.stringify({ version: 1, artworks }),
		{ flag: "wx" },
	);
	await writeFile(
		resolve(root, "download-report.json"),
		JSON.stringify(
			{
				target: limit,
				reused,
				candidates: selected.size,
				selected: attempted,
				downloaded: entries.length - reused,
				total: entries.length,
				skipped,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	return {
		selected: attempted,
		reused,
		downloaded: entries.length - reused,
		total: entries.length,
		skipped: skipped.length,
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			output: { type: "string" },
			limit: { type: "string", default: "500" },
			"extend-manifest": { type: "string" },
			"extend-catalog": { type: "string" },
		},
	});
	if (!values.output)
		throw new Error("Provide --output <new-directory> [--limit 500]");
	if (Boolean(values["extend-manifest"]) !== Boolean(values["extend-catalog"]))
		throw new Error("Provide both --extend-manifest and --extend-catalog");
	const base =
		values["extend-manifest"] && values["extend-catalog"]
			? {
					manifest: values["extend-manifest"],
					catalog: values["extend-catalog"],
				}
			: undefined;
	console.log(
		await downloadColorCorpus(values.output, Number(values.limit), base),
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main().catch((error) => {
		console.error(
			error instanceof Error ? error.message : "Corpus download failed",
		);
		process.exitCode = 1;
	});
}
