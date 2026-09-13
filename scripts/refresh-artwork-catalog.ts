import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog.ts";
import { readManifest } from "./build-color-index.ts";

const ENDPOINT = "https://api.artic.edu/api/v1/artworks/search";
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
	"updated_at",
];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function timestamp(value: unknown) {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
		throw new Error("Invalid source timestamp");
	return value;
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
		throw new Error(`Unsafe catalog path: ${path}`);
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
async function immutable(path: string, value: unknown) {
	if (await exists(path)) {
		if (JSON.stringify(await json(path)) !== JSON.stringify(value))
			throw new Error(`Saved output differs: ${basename(path)}`);
	} else await atomic(path, value);
}
function responsePage(value: unknown) {
	if (
		!record(value) ||
		!record(value.pagination) ||
		!integer(value.pagination.total) ||
		!Array.isArray(value.data)
	)
		throw new Error("Invalid museum page");
	const rows = value.data.map((row) => {
		if (!record(row)) throw new Error("Invalid artwork row");
		return {
			artwork: readIndexedArtwork(row),
			sourceUpdatedAt: timestamp(row.source_updated_at),
			apiUpdatedAt: timestamp(row.updated_at),
		};
	});
	return { total: value.pagination.total, rows };
}
type Page = ReturnType<typeof responsePage>;
function savedPage(
	value: unknown,
): Page & { afterId: number; fetchedAt: string } {
	if (
		!record(value) ||
		!integer(value.afterId) ||
		typeof value.fetchedAt !== "string" ||
		!timestamp(value.fetchedAt) ||
		!integer(value.total) ||
		!Array.isArray(value.rows)
	)
		throw new Error("Invalid saved page");
	return {
		afterId: value.afterId,
		fetchedAt: value.fetchedAt,
		total: value.total,
		rows: value.rows.map((row) => {
			if (!record(row)) throw new Error("Invalid saved artwork");
			return {
				artwork: readIndexedArtwork(row.artwork),
				sourceUpdatedAt: timestamp(row.sourceUpdatedAt),
				apiUpdatedAt: timestamp(row.apiUpdatedAt),
			};
		}),
	};
}
export interface RefreshOptions {
	output: string;
	baselineCatalog: string;
	reuseManifest: string;
	maxPages?: number;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}

/** A live observation window, not a point-in-time database snapshot. */
export async function refreshArtworkCatalog(options: RefreshOptions) {
	const maxPages = options.maxPages ?? 1000;
	if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000)
		throw new Error("Choose 1–1000 pages per run");
	const baseline = readArtworkCatalog(
		await json(resolve(options.baselineCatalog)),
	);
	const cached = readManifest(
		await json(resolve(options.reuseManifest)),
	).entries.map((entry) => ({
		...entry,
		imagePath: resolve(
			dirname(resolve(options.reuseManifest)),
			entry.imagePath,
		),
	}));
	const plan = {
		version: 1,
		recipe: "live-eligible-id-keyset-v1",
		baselineSha256: sha(JSON.stringify([...baseline.values()])),
		reuseSha256: sha(JSON.stringify(cached)),
	};
	const root = resolve(options.output);
	const target = resolve(await realpath(dirname(root)), basename(root));
	const repository = await realpath(
		resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	if (target === repository || target.startsWith(repository + sep))
		throw new Error("Live catalog must be outside the repository");
	const fresh = !(await exists(root));
	if (fresh) await mkdir(root);
	await regular(root, true);
	const lock = resolve(root, ".lock");
	await writeFile(lock, String(process.pid), { flag: "wx" });
	try {
		if (fresh) {
			await immutable(resolve(root, "plan.json"), plan);
			await mkdir(resolve(root, "pages"));
		}
		if (
			JSON.stringify(await json(resolve(root, "plan.json"))) !==
			JSON.stringify(plan)
		)
			throw new Error("Live catalog inputs changed");
		await regular(resolve(root, "pages"), true);
		let lastRequest = Date.now();
		const request = async (
			afterId: number,
			upperId?: number,
			descending = false,
		): Promise<Page> => {
			await delay(Math.max(0, 1000 - (Date.now() - lastRequest)), undefined, {
				signal: options.signal,
			});
			lastRequest = Date.now();
			const params = {
				query: {
					bool: {
						filter: [
							{ term: { is_public_domain: true } },
							{ exists: { field: "image_id" } },
							{
								range: {
									id: {
										gt: afterId,
										...(upperId === undefined ? {} : { lte: upperId }),
									},
								},
							},
						],
					},
				},
				sort: [{ id: descending ? "desc" : "asc" }],
				fields: FIELDS,
				limit: descending ? 1 : 100,
			};
			const response = await fetch(
				`${ENDPOINT}?${new URLSearchParams({ params: JSON.stringify(params) })}`,
				{
					redirect: "error",
					signal: AbortSignal.any([
						AbortSignal.timeout(20000),
						...(options.signal ? [options.signal] : []),
					]),
					headers: { Accept: "application/json" },
				},
			);
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error(
					`Metadata HTTP ${response.status}; saved pages retained, retry later`,
				);
			}
			if (
				!response.headers.get("content-type")?.includes("application/json") ||
				!response.body
			) {
				await response.body?.cancel();
				throw new Error("Invalid metadata response type");
			}
			const reader = response.body.getReader(),
				chunks: Uint8Array[] = [];
			let bytes = 0;
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.length;
				if (bytes > 2 * 1024 * 1024) {
					await reader.cancel();
					throw new Error("Metadata page exceeds 2 MiB");
				}
				chunks.push(next.value);
			}
			return responsePage(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		};
		const snapshotPath = resolve(root, "snapshot.json");
		if (!(await exists(snapshotPath))) {
			const first = await request(0, undefined, true);
			if (first.rows.length !== 1 || first.total < 1 || first.total > 100000)
				throw new Error("Unexpected eligible collection size");
			await immutable(snapshotPath, {
				startedAt: new Date().toISOString(),
				upperId: first.rows[0].artwork.id,
				expected: first.total,
			});
		}
		const snapshot = await json(snapshotPath);
		if (
			!record(snapshot) ||
			!integer(snapshot.upperId) ||
			snapshot.upperId < 1 ||
			!integer(snapshot.expected) ||
			snapshot.expected < 1 ||
			snapshot.expected > 100000 ||
			typeof snapshot.startedAt !== "string" ||
			!timestamp(snapshot.startedAt)
		)
			throw new Error("Invalid snapshot bounds");
		let afterId = 0,
			count = 0,
			pages = 0;
		const collected: Page["rows"] = [];
		const consume = (page: ReturnType<typeof savedPage>) => {
			if (
				page.afterId !== afterId ||
				page.total !== Number(snapshot.expected) - count ||
				!page.rows.length ||
				page.rows.length > 100 ||
				page.rows.length !== Math.min(100, page.total)
			)
				throw new Error(
					"Collection drift or incomplete page; do not freeze this catalog",
				);
			for (const row of page.rows) {
				if (
					row.artwork.id <= afterId ||
					row.artwork.id > Number(snapshot.upperId)
				)
					throw new Error("Museum did not honor ordered ID bounds");
				afterId = row.artwork.id;
				collected.push(row);
				count++;
			}
			pages++;
		};
		const files = (await readdir(resolve(root, "pages")))
			.filter((name) => name.endsWith(".json"))
			.sort();
		for (const [index, name] of files.entries()) {
			if (name !== `${String(index).padStart(5, "0")}.json`)
				throw new Error("Non-contiguous saved pages");
			consume(savedPage(await json(resolve(root, "pages", name))));
		}
		let fetched = 0;
		while (count < snapshot.expected && fetched < maxPages) {
			options.signal?.throwIfAborted();
			const page = {
				afterId,
				fetchedAt: new Date().toISOString(),
				...(await request(afterId, snapshot.upperId)),
			};
			const filename = `${String(pages).padStart(5, "0")}.json`;
			consume(page);
			await immutable(resolve(root, "pages", filename), page);
			fetched++;
			if (pages % 25 === 0 || count === snapshot.expected)
				options.onProgress?.(
					`Catalog: ${count}/${snapshot.expected} records; ${pages} pages saved`,
				);
		}
		if (count < snapshot.expected)
			return {
				status: "partial" as const,
				count,
				expected: snapshot.expected,
				pages,
			};
		// Recheck both ends of the ID interval and the total before freezing anything.
		const finalCheckPath = resolve(root, "coverage-check.json");
		if (!(await exists(finalCheckPath))) {
			const check = await request(0, snapshot.upperId, true);
			const beyond = await request(snapshot.upperId, undefined, true);
			if (
				check.total !== count ||
				check.rows[0]?.artwork.id !== afterId ||
				beyond.total !== 0
			)
				throw new Error(
					"Collection changed during refresh; coverage check failed",
				);
			await immutable(finalCheckPath, {
				finishedAt: new Date().toISOString(),
				count: check.total,
				upperId: afterId,
				aboveUpperBound: beyond.total,
			});
		}
		const coverage = await json(finalCheckPath);
		if (
			!record(coverage) ||
			coverage.count !== count ||
			coverage.upperId !== afterId ||
			coverage.aboveUpperBound !== 0 ||
			typeof coverage.finishedAt !== "string" ||
			!timestamp(coverage.finishedAt)
		)
			throw new Error("Invalid saved coverage check");
		const artworks = collected.map((row) => row.artwork),
			catalog = { version: 1, artworks };
		const current = readArtworkCatalog(catalog);
		const added: number[] = [],
			removed: number[] = [],
			changedImages: number[] = [],
			changedMetadata: number[] = [];
		for (const artwork of artworks) {
			const previous = baseline.get(artwork.id);
			if (!previous) added.push(artwork.id);
			else {
				if (previous.image_id !== artwork.image_id)
					changedImages.push(artwork.id);
				if (JSON.stringify(previous) !== JSON.stringify(artwork))
					changedMetadata.push(artwork.id);
			}
		}
		for (const id of baseline.keys()) if (!current.has(id)) removed.push(id);
		const liveDates = new Map(
			collected.map((row) => [row.artwork.id, row.sourceUpdatedAt]),
		);
		const reuse = [];
		for (const entry of cached) {
			if (
				current.get(entry.artworkId)?.image_id === entry.imageId &&
				liveDates.get(entry.artworkId) === entry.sourceUpdatedAt &&
				(await exists(entry.imagePath))
			) {
				await regular(entry.imagePath);
				reuse.push(entry);
			}
		}
		const report = {
			version: 1,
			startedAt: snapshot.startedAt,
			finishedAt: coverage.finishedAt,
			count,
			pages,
			upperId: snapshot.upperId,
			catalogSha256: sha(JSON.stringify(catalog)),
			added: added.length,
			removed: removed.length,
			changedImages: changedImages.length,
			changedMetadata: changedMetadata.length,
			reusableOriginals: reuse.length,
			coverage:
				"Strict ascending IDs, exact remaining counts on every page, and final bounded/unbounded total checks; live observation window, not an atomic snapshot",
		};
		await immutable(resolve(root, "artworks.json"), catalog);
		await immutable(resolve(root, "provenance.json"), {
			version: 1,
			entries: collected.map(({ artwork, ...dates }) => ({
				artworkId: artwork.id,
				...dates,
			})),
		});
		await immutable(resolve(root, "reconciliation.json"), {
			version: 1,
			added,
			removed,
			changedImages,
			changedMetadata,
		});
		if (reuse.length)
			await immutable(resolve(root, "reuse-manifest.json"), {
				version: 1,
				colorSpace: "srgb",
				corpus:
					"Cached originals with matching live image IDs and source timestamps",
				entries: reuse,
			});
		await immutable(resolve(root, "report.json"), report);
		return { status: "complete" as const, ...report };
	} finally {
		await unlink(lock);
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			output: { type: "string" },
			baseline: { type: "string" },
			"reuse-manifest": { type: "string" },
			"max-pages": { type: "string" },
		},
	});
	if (!values.output || !values.baseline || !values["reuse-manifest"])
		throw new Error(
			"Usage: colors:refresh --output OUTSIDE_REPO --baseline FILE --reuse-manifest FILE [--max-pages 1000]",
		);
	const controller = new AbortController(),
		abort = () => controller.abort();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	console.log(`Catalog refresh PID ${process.pid}`);
	try {
		console.log(
			JSON.stringify(
				await refreshArtworkCatalog({
					output: values.output,
					baselineCatalog: values.baseline,
					reuseManifest: values["reuse-manifest"],
					maxPages:
						values["max-pages"] === undefined
							? undefined
							: Number(values["max-pages"]),
					signal: controller.signal,
					onProgress: console.log,
				}),
			),
		);
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
		console.error(error instanceof Error ? error.message : "Refresh failed");
		process.exitCode = 1;
	});
