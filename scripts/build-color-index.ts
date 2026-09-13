import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	COLOR_INDEX_VERSION,
	colorSampleDigest,
	type IndexedArtwork,
	readColorIndex,
} from "../src/lib/colors/color-index.ts";
import { readArtworkCatalog } from "../src/lib/colors/index-catalog.ts";
import { ImageAnalysisError, prepareColorImage } from "./lib/color-image.ts";

interface ManifestEntry {
	artworkId: number;
	imageId: string;
	imagePath: string;
	sourceUpdatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readManifest(value: unknown) {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		value.colorSpace !== "srgb" ||
		typeof value.corpus !== "string" ||
		!value.corpus.trim() ||
		!Array.isArray(value.entries) ||
		value.entries.length === 0
	)
		throw new Error(
			"Expected a version 1 sRGB manifest with a corpus name and entries",
		);
	const entries: ManifestEntry[] = [];
	const ids = new Set<number>();
	for (const row of value.entries) {
		if (
			!isRecord(row) ||
			typeof row.artworkId !== "number" ||
			!Number.isSafeInteger(row.artworkId) ||
			row.artworkId <= 0 ||
			ids.has(row.artworkId) ||
			typeof row.imageId !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				row.imageId,
			) ||
			typeof row.imagePath !== "string" ||
			!row.imagePath.trim() ||
			/^[a-z][a-z0-9+.-]*:/i.test(row.imagePath) ||
			!(
				row.sourceUpdatedAt === null ||
				(typeof row.sourceUpdatedAt === "string" &&
					Number.isFinite(Date.parse(row.sourceUpdatedAt)))
			)
		)
			throw new Error(
				"Invalid manifest entry: use unique artwork IDs and local image paths",
			);
		ids.add(row.artworkId);
		entries.push({
			artworkId: row.artworkId,
			imageId: row.imageId,
			imagePath: row.imagePath,
			sourceUpdatedAt: row.sourceUpdatedAt,
		});
	}
	return { corpus: value.corpus, entries };
}

/** Offline only: the decoder receives file bytes, never a URL or user string. */
export async function buildColorIndex(
	manifestPath: string,
	outputDirectory: string,
	catalogPath?: string,
) {
	const inputPath = resolve(manifestPath);
	const outputPath = resolve(outputDirectory);
	const manifest = readManifest(JSON.parse(await readFile(inputPath, "utf8")));
	const catalog = catalogPath
		? readArtworkCatalog(
				JSON.parse(await readFile(resolve(catalogPath), "utf8")),
			)
		: undefined;
	if (catalog) {
		for (const entry of manifest.entries) {
			if (catalog.get(entry.artworkId)?.image_id !== entry.imageId)
				throw new Error("Artwork catalog does not match the manifest");
		}
	}
	// An existing directory is an error, including one from an interrupted run.
	// This keeps a previously built index and its failure report recoverable.
	await mkdir(outputPath);
	await mkdir(resolve(outputPath, "samples"));
	const savedSamples = new Set<string>();
	const entries: IndexedArtwork[] = [];
	const skipped: { artworkId: number; reason: string }[] = [];
	for (const source of manifest.entries) {
		let data: Buffer;
		try {
			data = await readFile(resolve(dirname(inputPath), source.imagePath));
		} catch {
			skipped.push({ artworkId: source.artworkId, reason: "read-failed" });
			continue;
		}
		let prepared: Awaited<ReturnType<typeof prepareColorImage>> | undefined;
		try {
			prepared = await prepareColorImage(data);
		} catch (error) {
			skipped.push({
				artworkId: source.artworkId,
				reason:
					error instanceof ImageAnalysisError
						? error.reason
						: "decode-or-analysis-failed",
			});
		}
		if (!prepared) continue;
		// Storage failures stop the build; they are not bad-image skips.
		const sha256 = await colorSampleDigest(prepared.pixels);
		if (!savedSamples.has(sha256)) {
			await writeFile(
				resolve(outputPath, "samples", `${sha256}.rgba`),
				prepared.pixels,
				{ flag: "wx" },
			);
			savedSamples.add(sha256);
		}
		entries.push({
			artworkId: source.artworkId,
			imageId: source.imageId,
			sourceUpdatedAt: source.sourceUpdatedAt,
			signature: prepared.signature,
			sample: { width: prepared.width, height: prepared.height, sha256 },
		});
	}
	const generatedAt = new Date().toISOString();
	const report = {
		version: COLOR_INDEX_VERSION,
		generatedAt,
		corpus: manifest.corpus,
		selected: manifest.entries.length,
		analyzed: entries.length,
		skipped,
	};
	await writeFile(
		resolve(outputPath, "report.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	if (!entries.length)
		throw new Error(
			"No images could be analyzed; see report.json. No index was published.",
		);
	const index = readColorIndex({
		version: COLOR_INDEX_VERSION,
		generatedAt,
		corpus: manifest.corpus,
		entries: entries.sort((left, right) => left.artworkId - right.artworkId),
	});
	await writeFile(resolve(outputPath, "index.json"), JSON.stringify(index), {
		flag: "wx",
	});
	if (catalog)
		await writeFile(
			resolve(outputPath, "artworks.json"),
			JSON.stringify({
				version: 1,
				artworks: index.entries.map((entry) => catalog.get(entry.artworkId)),
			}),
			{ flag: "wx" },
		);
	return report;
}

async function main() {
	const { values } = parseArgs({
		options: {
			manifest: { type: "string" },
			output: { type: "string" },
			catalog: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(
			"pnpm colors:index --manifest <local-manifest.json> --output <new-directory> [--catalog <artworks.json>]",
		);
		return;
	}
	if (!values.manifest || !values.output)
		throw new Error(
			"Provide --manifest <local-manifest.json> and --output <new-directory>",
		);
	const report = await buildColorIndex(
		values.manifest,
		values.output,
		values.catalog,
	);
	console.log(
		`Indexed ${report.analyzed} of ${report.selected} images; skipped ${report.skipped.length}.`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "Color indexing failed",
		);
		process.exitCode = 1;
	});
}
