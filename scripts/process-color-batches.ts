import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import {
	analyzeColorSignature,
	colorSampleDigest,
	readColorIndex,
	readColorSample,
} from "../src/lib/colors/color-index.ts";
import { analyzeColorfulness } from "../src/lib/colors/colorfulness.ts";
import { readArtworkCatalog } from "../src/lib/colors/index-catalog.ts";
import { readManifest } from "./build-color-index.ts";
import { requestColorImage } from "./lib/color-download.ts";
import { ImageAnalysisError, prepareColorImage } from "./lib/color-image.ts";

const RECIPE = "canonical-v2-colorfulness-v1-gzip-v1";
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const digest = (data: string | Uint8Array) =>
	createHash("sha256").update(data).digest("hex");
const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function exists(path: string) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (record(error) && error.code === "ENOENT") return false;
		throw error;
	}
}
async function regular(path: string, directory = false) {
	const stat = await lstat(path);
	if (
		stat.isSymbolicLink() ||
		(directory ? !stat.isDirectory() : !stat.isFile())
	)
		throw new Error(`Unsafe staging path: ${path}`);
}
async function json(path: string): Promise<unknown> {
	await regular(path);
	return JSON.parse(await readFile(path, "utf8"));
}
async function atomic(path: string, value: unknown) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(value), { flag: "wx" });
	await rename(temporary, path);
}
export interface BatchOptions {
	catalog: string;
	output: string;
	reuseManifest?: string;
	batchSize?: number;
	allowDownload?: boolean;
	verifyOnly?: boolean;
	signal?: AbortSignal;
}

/** Local staging only. No publication, database writes, or original-image cleanup. */
export async function processColorBatch(options: BatchOptions) {
	const batchSize = options.batchSize ?? 25;
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100)
		throw new Error("Batch size must be between 1 and 100");
	const catalog = readArtworkCatalog(
		JSON.parse(await readFile(resolve(options.catalog), "utf8")),
	);
	const artworks = [...catalog.values()];
	if (!artworks.length || artworks.length > 100000)
		throw new Error("Catalog must contain 1–100000 artworks");
	const reuse = options.reuseManifest
		? readManifest(
				JSON.parse(await readFile(resolve(options.reuseManifest), "utf8")),
			).entries.map((entry) => ({
				...entry,
				imagePath: resolve(
					dirname(resolve(options.reuseManifest ?? "")),
					entry.imagePath,
				),
			}))
		: [];
	const sources = new Map(reuse.map((entry) => [entry.artworkId, entry]));
	for (const artwork of artworks) {
		const source = sources.get(artwork.id);
		if (source && source.imageId !== artwork.image_id)
			throw new Error("Reuse manifest image does not match catalog");
	}
	const plan = {
		version: 1,
		recipe: RECIPE,
		fingerprint: digest(JSON.stringify({ artworks, reuse, recipe: RECIPE })),
		total: artworks.length,
	};
	const root = resolve(options.output);
	const repository = await realpath(
		resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	// Resolve the parent to prevent a symlink from routing staging into the app.
	const parent = await realpath(dirname(root));
	const actual = resolve(parent, root.slice(dirname(root).length + 1));
	if (actual === repository || actual.startsWith(repository + sep))
		throw new Error("Staging output must be outside the repository");
	const fresh = !(await exists(root));
	if (fresh && options.verifyOnly) throw new Error("No batch job to verify");
	if (fresh) await mkdir(root);
	await regular(root, true);
	const lock = resolve(root, ".lock");
	await writeFile(lock, String(process.pid), { flag: "wx" });
	try {
		if (fresh) {
			await writeFile(resolve(root, "plan.json"), JSON.stringify(plan), {
				flag: "wx",
			});
			for (const directory of ["records", "samples", "originals"])
				await mkdir(resolve(root, directory));
			await atomic(resolve(root, "checkpoint.json"), {
				cursor: 0,
				indexed: 0,
				skipped: 0,
			});
		}
		if (!same(await json(resolve(root, "plan.json")), plan))
			throw new Error(
				"Batch inputs or recipe changed; use a new output directory",
			);
		for (const directory of ["records", "samples", "originals"])
			await regular(resolve(root, directory), true);
		const checkpoint = await json(resolve(root, "checkpoint.json"));
		if (
			!record(checkpoint) ||
			![checkpoint.cursor, checkpoint.indexed, checkpoint.skipped].every(
				(value) =>
					typeof value === "number" &&
					Number.isSafeInteger(value) &&
					value >= 0,
			)
		)
			throw new Error("Invalid checkpoint");
		// Narrow each field rather than trusting persisted JSON as a typed object.
		let cursor = Number(checkpoint.cursor),
			indexed = Number(checkpoint.indexed),
			skipped = Number(checkpoint.skipped);
		if (cursor > artworks.length || indexed + skipped !== cursor)
			throw new Error("Invalid checkpoint counts");
		const receiptPath = (position: number) =>
			resolve(root, "records", `${artworks[position].id}.json`);
		const verify = async (position: number) => {
			const receipt = await json(receiptPath(position));
			const artwork = artworks[position];
			if (
				!record(receipt) ||
				receipt.plan !== plan.fingerprint ||
				!same(receipt.artwork, artwork)
			)
				throw new Error("Receipt does not match batch plan");
			if (receipt.status === "skipped") {
				if (
					![
						"empty-sample",
						"decode-or-analysis-failed",
						"requires-color-normalization",
						"http-403",
						"http-404",
						"invalid-image-response",
					].includes(String(receipt.reason))
				)
					throw new Error("Invalid skip receipt");
				return "skipped";
			}
			if (receipt.status !== "indexed")
				throw new Error("Invalid receipt status");
			const entry = readColorIndex({
				version: 2,
				generatedAt: "2026-01-01T00:00:00Z",
				corpus: "batch",
				entries: [receipt.entry],
			}).entries[0];
			if (
				entry.artworkId !== artwork.id ||
				entry.imageId !== artwork.image_id ||
				entry.sourceUpdatedAt !==
					(sources.get(artwork.id)?.sourceUpdatedAt ?? null)
			)
				throw new Error("Receipt image mismatch");
			const samplePath = resolve(
				root,
				"samples",
				`${entry.sample.sha256}.rgba.gz`,
			);
			await regular(samplePath);
			const pixels = await readColorSample(
				gunzipSync(await readFile(samplePath), { maxOutputLength: 160000 }),
				entry.sample,
			);
			if (
				!same(analyzeColorSignature(pixels), entry.signature) ||
				!same(analyzeColorfulness(pixels), receipt.colorfulness)
			)
				throw new Error("Receipt analysis mismatch");
			if (
				!record(receipt.source) ||
				typeof receipt.source.path !== "string" ||
				typeof receipt.source.sha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(receipt.source.sha256) ||
				typeof receipt.source.bytes !== "number" ||
				receipt.source.bytes <= 0
			)
				throw new Error("Invalid source provenance");
			return "indexed";
		};
		if (options.verifyOnly) {
			let verifiedIndexed = 0;
			for (let position = 0; position < cursor; position++) {
				options.signal?.throwIfAborted();
				if ((await verify(position)) === "indexed") verifiedIndexed++;
			}
			if (verifiedIndexed !== indexed)
				throw new Error("Checkpoint totals disagree with receipts");
			return {
				cursor,
				indexed,
				skipped,
				total: artworks.length,
				verified: cursor,
				paused: null,
				retryAfterMs: 0,
			};
		}
		if (cursor) await verify(cursor - 1);
		let attempted = 0,
			lastRequest = 0;
		let paused: string | null = null;
		let retryAfterMs = 0;
		while (cursor < artworks.length && attempted < batchSize) {
			options.signal?.throwIfAborted();
			const artwork = artworks[cursor];
			if (!(await exists(receiptPath(cursor)))) {
				const source = sources.get(artwork.id);
				const path =
					source?.imagePath ??
					resolve(root, "originals", `${artwork.id}-${artwork.image_id}.jpg`);
				let reason: string | undefined;
				if (!(await exists(path))) {
					if (!options.allowDownload || source) {
						paused =
							"Missing local image; provide a cache or explicitly enable downloads for uncached catalog entries";
						break;
					}
					let downloaded: Buffer | undefined;
					try {
						const response = await requestColorImage(artwork, async (url) => {
							await delay(
								Math.max(0, 1000 - (Date.now() - lastRequest)),
								undefined,
								{ signal: options.signal },
							);
							lastRequest = Date.now();
							return fetch(url, {
								redirect: "error",
								signal: AbortSignal.any([
									AbortSignal.timeout(10000),
									...(options.signal ? [options.signal] : []),
								]),
								headers: {
									Accept: "image/jpeg",
									"User-Agent": "Mozilla/5.0 (compatible; ChromaCollection)",
									Referer: "https://www.artic.edu/",
								},
							});
						});
						if (response.status === 403 || response.status === 404) {
							reason = `http-${response.status}`;
							await response.body?.cancel();
						} else if (!response.ok) {
							const retryAfter = response.headers.get("retry-after");
							if (retryAfter) {
								const seconds = Number(retryAfter);
								const milliseconds = Number.isFinite(seconds)
									? seconds * 1000
									: Date.parse(retryAfter) - Date.now();
								if (Number.isFinite(milliseconds))
									retryAfterMs = Math.max(0, milliseconds);
							}
							await response.body?.cancel();
							paused = `HTTP ${response.status}; retry this batch later`;
							break;
						} else if (
							!response.headers
								.get("content-type")
								?.toLowerCase()
								.startsWith("image/jpeg") ||
							Number(response.headers.get("content-length")) >
								MAX_SOURCE_BYTES ||
							!response.body
						) {
							reason = "invalid-image-response";
							await response.body?.cancel();
						} else {
							const reader = response.body.getReader(),
								chunks: Uint8Array[] = [];
							let size = 0;
							for (;;) {
								const next = await reader.read();
								if (next.done) break;
								size += next.value.length;
								if (size > MAX_SOURCE_BYTES) {
									reason = "invalid-image-response";
									await reader.cancel();
									break;
								}
								chunks.push(next.value);
							}
							if (!reason) {
								const bytes = Buffer.concat(chunks);
								if (bytes[0] !== 255 || bytes[1] !== 216)
									reason = "invalid-image-response";
								else downloaded = bytes;
							}
						}
					} catch {
						options.signal?.throwIfAborted();
						paused = "Download interrupted; retry this batch later";
						break;
					}
					if (downloaded) {
						const temporary = `${path}.${randomUUID()}.tmp`;
						await writeFile(temporary, downloaded, { flag: "wx" });
						await rename(temporary, path);
					}
				}
				let receipt: unknown;
				if (!reason) {
					await regular(path);
					const bytes = await readFile(path);
					let prepared:
						| Awaited<ReturnType<typeof prepareColorImage>>
						| undefined;
					// Do not silently interpret embedded ICC profiles as untagged sRGB.
					if (bytes.includes(Buffer.from("ICC_PROFILE\0")))
						reason = "requires-color-normalization";
					else
						try {
							prepared = await prepareColorImage(bytes);
						} catch (error) {
							if (!(error instanceof ImageAnalysisError)) throw error;
							reason = error.reason;
						}
					if (prepared) {
						const sha256 = await colorSampleDigest(prepared.pixels);
						const sample = {
							width: prepared.width,
							height: prepared.height,
							sha256,
						};
						const samplePath = resolve(root, "samples", `${sha256}.rgba.gz`);
						if (!(await exists(samplePath))) {
							const temporary = `${samplePath}.${randomUUID()}.tmp`;
							await writeFile(temporary, gzipSync(prepared.pixels), {
								flag: "wx",
							});
							await rename(temporary, samplePath);
						}
						await regular(samplePath);
						await readColorSample(
							gunzipSync(await readFile(samplePath), {
								maxOutputLength: 160000,
							}),
							sample,
						);
						receipt = {
							plan: plan.fingerprint,
							status: "indexed",
							artwork,
							entry: {
								artworkId: artwork.id,
								imageId: artwork.image_id,
								sourceUpdatedAt: source?.sourceUpdatedAt ?? null,
								signature: prepared.signature,
								sample,
							},
							colorfulness: analyzeColorfulness(prepared.pixels),
							source: {
								path,
								sha256: digest(bytes),
								bytes: bytes.length,
								reused: Boolean(source),
							},
						};
					}
				}
				options.signal?.throwIfAborted();
				await atomic(
					receiptPath(cursor),
					receipt ?? {
						plan: plan.fingerprint,
						status: "skipped",
						artwork,
						reason,
					},
				);
			}
			// A receipt written just before interruption is verified and rolled forward.
			const status = await verify(cursor);
			if (status === "indexed") indexed++;
			else skipped++;
			cursor++;
			attempted++;
			await atomic(resolve(root, "checkpoint.json"), {
				cursor,
				indexed,
				skipped,
			});
		}
		return {
			cursor,
			indexed,
			skipped,
			total: artworks.length,
			verified: null,
			paused,
			retryAfterMs,
		};
	} finally {
		await unlink(lock);
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			catalog: { type: "string" },
			output: { type: "string" },
			"reuse-manifest": { type: "string" },
			"batch-size": { type: "string" },
			"allow-download": { type: "boolean" },
			"verify-only": { type: "boolean" },
		},
	});
	if (!values.catalog || !values.output)
		throw new Error(
			"Usage: colors:batch --catalog FILE --output OUTSIDE_REPO [--reuse-manifest FILE] [--batch-size 25] [--allow-download] [--verify-only]",
		);
	const controller = new AbortController();
	const abort = () => controller.abort();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	try {
		const result = await processColorBatch({
			catalog: values.catalog,
			output: values.output,
			reuseManifest: values["reuse-manifest"],
			batchSize:
				values["batch-size"] === undefined ? 25 : Number(values["batch-size"]),
			allowDownload: values["allow-download"],
			verifyOnly: values["verify-only"],
			signal: controller.signal,
		});
		console.log(JSON.stringify(result));
		if (result.paused) process.exitCode = 2;
	} finally {
		process.removeListener("SIGINT", abort);
		process.removeListener("SIGTERM", abort);
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "Batch failed");
		process.exitCode = 1;
	});
