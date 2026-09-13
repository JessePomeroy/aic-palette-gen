import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	lstat,
	readFile,
	realpath,
	rename,
	stat,
	statfs,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	type BatchOptions,
	processColorBatch,
} from "./process-color-batches.ts";

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function atomic(path: string, value: unknown) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
	await rename(temporary, path);
}
async function readJson(path: string): Promise<unknown> {
	const status = await lstat(path);
	if (!status.isFile() || status.isSymbolicLink())
		throw new Error(`Unsafe scan file: ${path}`);
	return JSON.parse(await readFile(path, "utf8"));
}
export async function summarizeColorScan(
	options: Pick<BatchOptions, "catalog" | "output">,
	cursor: number,
) {
	const catalog = await readJson(options.catalog);
	if (!record(catalog) || !Array.isArray(catalog.artworks))
		throw new Error("Invalid scan catalog");
	const tags: Record<string, number> = {},
		skips: Record<string, number> = {};
	let originalBytes = 0,
		compressedSampleBytes = 0,
		indexed = 0,
		reused = 0;
	const samples = new Set<string>();
	for (const artwork of catalog.artworks.slice(0, cursor)) {
		if (!record(artwork) || typeof artwork.id !== "number")
			throw new Error("Invalid artwork identity");
		const receipt = await readJson(
			resolve(options.output, "records", `${artwork.id}.json`),
		);
		if (!record(receipt)) throw new Error("Invalid scan receipt");
		if (receipt.status === "skipped") {
			if (typeof receipt.reason !== "string")
				throw new Error("Invalid skip reason");
			skips[receipt.reason] = (skips[receipt.reason] ?? 0) + 1;
			continue;
		}
		if (
			receipt.status !== "indexed" ||
			!record(receipt.source) ||
			!record(receipt.colorfulness) ||
			typeof receipt.colorfulness.tag !== "string" ||
			!record(receipt.entry) ||
			!record(receipt.entry.sample) ||
			typeof receipt.entry.sample.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(receipt.entry.sample.sha256) ||
			typeof receipt.source.path !== "string" ||
			typeof receipt.source.bytes !== "number"
		)
			throw new Error("Invalid indexed scan receipt");
		const sourceStat = await lstat(receipt.source.path);
		if (
			!sourceStat.isFile() ||
			sourceStat.isSymbolicLink() ||
			sourceStat.size !== receipt.source.bytes
		)
			throw new Error("Original source no longer matches receipt");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(receipt.source.path))
			hash.update(chunk);
		if (hash.digest("hex") !== receipt.source.sha256)
			throw new Error("Original image checksum mismatch");
		indexed++;
		if (receipt.source.reused) reused++;
		originalBytes += sourceStat.size;
		tags[receipt.colorfulness.tag] = (tags[receipt.colorfulness.tag] ?? 0) + 1;
		if (!samples.has(receipt.entry.sample.sha256)) {
			samples.add(receipt.entry.sample.sha256);
			compressedSampleBytes += (
				await stat(
					resolve(
						options.output,
						"samples",
						`${receipt.entry.sample.sha256}.rgba.gz`,
					),
				)
			).size;
		}
	}
	return {
		checked: cursor,
		indexed,
		skipped: cursor - indexed,
		tags,
		skips,
		reused,
		originalBytes,
		compressedSampleBytes,
		originalHashesVerified: indexed,
	};
}
export interface ScanOptions
	extends Omit<BatchOptions, "batchSize" | "verifyOnly" | "allowDownload"> {
	pilotSize?: number;
	onProgress?: (message: string) => void;
}

/** Runs the approved local scan through a verified pilot and final audit.
 * An error pauses the job; neither the app nor the database is a write target.
 */
export async function runColorScan(options: ScanOptions) {
	const pilotSize = options.pilotSize ?? 300;
	if (!Number.isSafeInteger(pilotSize) || pilotSize < 1 || pilotSize > 1000)
		throw new Error("Pilot size must be 1–1000");
	const root = resolve(options.output),
		parent = await realpath(dirname(root));
	const repository = await realpath(
		resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	const target = resolve(parent, basename(root));
	if (target === repository || target.startsWith(repository + sep))
		throw new Error("Scan output must be outside the repository");
	// A separate lock covers gaps between the batch processor's own short-lived locks.
	const lock = `${root}.scan-lock`;
	await writeFile(lock, String(process.pid), { flag: "wx" });
	let lastCursor = 0,
		retries = 0;
	const startedAt = new Date().toISOString();
	let pilotPassed = false;
	let mayWriteStatus = false;
	const statusPath = resolve(root, "scan-status.json");
	try {
		try {
			const pilot = await readJson(resolve(root, "pilot-report.json"));
			pilotPassed = record(pilot) && pilot.passed === true;
		} catch (error) {
			if (!record(error) || error.code !== "ENOENT") throw error;
		}
		for (;;) {
			options.signal?.throwIfAborted();
			const disk = await statfs(parent);
			if (disk.bavail * disk.bsize < 5 * 1024 ** 3)
				throw new Error(
					"Less than 5 GiB free; scan paused to protect disk space",
				);
			const checkpoint = await (async () => {
				try {
					return await readJson(resolve(root, "checkpoint.json"));
				} catch (error) {
					if (record(error) && error.code === "ENOENT") return null;
					throw error;
				}
			})();
			const cursor =
				record(checkpoint) && typeof checkpoint.cursor === "number"
					? checkpoint.cursor
					: 0;
			const previousSkipped =
				record(checkpoint) && typeof checkpoint.skipped === "number"
					? checkpoint.skipped
					: 0;
			const batchSize = pilotPassed
				? 100
				: Math.max(1, Math.min(100, pilotSize - cursor));
			const batchStarted = Date.now();
			const result = await processColorBatch({
				...options,
				batchSize,
				allowDownload: true,
			});
			mayWriteStatus = true;
			await atomic(statusPath, {
				status: result.paused ? "waiting" : pilotPassed ? "scanning" : "pilot",
				pid: process.pid,
				startedAt,
				updatedAt: new Date().toISOString(),
				...result,
			});
			options.onProgress?.(
				`${pilotPassed ? "Scan" : "Pilot"}: ${result.cursor}/${result.total}; indexed ${result.indexed}; skipped ${result.skipped}; batch ${((Date.now() - batchStarted) / 1000).toFixed(1)}s${result.paused ? `; ${result.paused}` : ""}`,
			);
			if (
				result.cursor - cursor >= 20 &&
				(result.skipped - previousSkipped) / (result.cursor - cursor) > 0.2
			)
				throw new Error(
					"More than 20% of a batch failed; inspect skip reasons before continuing",
				);
			if (result.paused) {
				if (result.cursor > lastCursor) retries = 0;
				lastCursor = result.cursor;
				if (result.paused.startsWith("Missing local") || ++retries > 6)
					throw new Error(`Scan paused: ${result.paused}`);
				// Never turn a server error into a tight retry loop. Honor a conservative
				// 15-minute cooldown for rate limits; other transient pauses back off.
				const backoffMs = result.paused.includes("429")
					? 15 * 60 * 1000
					: Math.min(15 * 60 * 1000, 60000 * 2 ** (retries - 1));
				const waitMs = Math.max(backoffMs, result.retryAfterMs);
				if (waitMs > 24 * 60 * 60 * 1000)
					throw new Error(
						"Museum requested a cooldown longer than one day; resume later",
					);
				await atomic(statusPath, {
					status: "waiting",
					pid: process.pid,
					updatedAt: new Date().toISOString(),
					...result,
					retry: retries,
					retryAt: new Date(Date.now() + waitMs).toISOString(),
				});
				await delay(waitMs, undefined, { signal: options.signal });
				continue;
			}
			retries = 0;
			lastCursor = result.cursor;
			if (!pilotPassed && result.cursor >= Math.min(pilotSize, result.total)) {
				await processColorBatch({ ...options, verifyOnly: true });
				const pilot = await summarizeColorScan(options, result.cursor);
				const passed = pilot.indexed / pilot.checked >= 0.9;
				await atomic(resolve(root, "pilot-report.json"), {
					...pilot,
					passed,
					verifiedAt: new Date().toISOString(),
					elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000,
				});
				if (!passed)
					throw new Error(
						"Pilot acceptance below 90%; full scan was not started",
					);
				pilotPassed = true;
				options.onProgress?.(
					`Pilot passed: ${pilot.indexed}/${pilot.checked} indexed; samples and original hashes verified. Continuing the approved full scan.`,
				);
			}
			if (result.cursor === result.total) {
				await atomic(statusPath, {
					status: "verifying",
					pid: process.pid,
					updatedAt: new Date().toISOString(),
					...result,
				});
				const audit = await processColorBatch({ ...options, verifyOnly: true });
				const summary = await summarizeColorScan(options, audit.cursor);
				const report = {
					status: "complete",
					completedAt: new Date().toISOString(),
					total: audit.total,
					...summary,
					samplesVerified: audit.verified,
					published: false,
					originalsRetained: true,
				};
				await atomic(resolve(root, "scan-report.json"), report);
				await atomic(statusPath, report);
				options.onProgress?.(
					`Complete: ${summary.indexed} indexed; ${summary.skipped} explicit skips; full audit passed.`,
				);
				return report;
			}
			// Keep request spacing conservative even across batch invocation boundaries.
			await delay(1000, undefined, { signal: options.signal });
		}
	} catch (error) {
		try {
			if (mayWriteStatus)
				await atomic(statusPath, {
					status: "paused",
					pid: process.pid,
					updatedAt: new Date().toISOString(),
					reason: error instanceof Error ? error.message : "Scan error",
				});
		} catch {
			/* The batch may have failed before creating its directory. */
		}
		throw error;
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
			"pilot-size": { type: "string" },
		},
	});
	if (!values.catalog || !values.output)
		throw new Error(
			"Usage: colors:scan --catalog FILE --output OUTSIDE_REPO [--reuse-manifest FILE] [--pilot-size 300]",
		);
	const controller = new AbortController(),
		abort = () => controller.abort();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	console.log(`Full scan PID ${process.pid}`);
	try {
		await runColorScan({
			catalog: values.catalog,
			output: values.output,
			reuseManifest: values["reuse-manifest"],
			pilotSize:
				values["pilot-size"] === undefined
					? undefined
					: Number(values["pilot-size"]),
			signal: controller.signal,
			onProgress: console.log,
		});
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
		console.error(error instanceof Error ? error.message : "Scan failed");
		process.exitCode = 1;
	});
