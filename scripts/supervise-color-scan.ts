import { randomUUID } from "node:crypto";
import {
	lstat,
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
import { runColorScan, type ScanOptions } from "./run-color-scan.ts";

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function jsonIfPresent(path: string): Promise<unknown> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink())
			throw new Error("Unsafe monitor state file");
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (record(error) && error.code === "ENOENT") return null;
		throw error;
	}
}
export function canResumeScanPause(reason: string) {
	return (
		reason === "The operation was aborted" ||
		reason === "This operation was aborted" ||
		reason === "Less than 5 GiB free; scan paused to protect disk space" ||
		/^Scan paused: HTTP (429|5\d\d);/.test(reason) ||
		reason === "Scan paused: Download interrupted; retry this batch later"
	);
}

/** Recover only this job's regular PID locks, and only after proving the owner exited. */
export async function recoverExitedScanLock(path: string) {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch (error) {
		if (record(error) && error.code === "ENOENT") return;
		throw error;
	}
	if (!info.isFile() || info.isSymbolicLink())
		throw new Error("Unsafe scan lock");
	const saved = await readFile(path, "utf8"),
		pid = Number(saved);
	if (!/^[1-9][0-9]*$/.test(saved) || !Number.isSafeInteger(pid))
		throw new Error("Invalid scan lock PID");
	try {
		process.kill(pid, 0);
		throw new Error(`Scan lock belongs to a live process: ${pid}`);
	} catch (error) {
		if (!record(error) || error.code !== "ESRCH") throw error;
	}
	if ((await readFile(path, "utf8")) !== saved)
		throw new Error("Scan lock changed during recovery");
	await unlink(path);
}

export async function superviseColorScan(options: ScanOptions) {
	const root = resolve(options.output);
	const target = resolve(await realpath(dirname(root)), basename(root));
	const repository = await realpath(
		resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	if (target === repository || target.startsWith(repository + sep))
		throw new Error("Supervised scan must be outside the repository");
	const rootInfo = await lstat(root);
	if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
		throw new Error("Expected an existing owned scan directory");
	const plan = await jsonIfPresent(resolve(root, "plan.json"));
	if (
		!record(plan) ||
		plan.version !== 1 ||
		plan.recipe !== "canonical-v2-colorfulness-v1-gzip-v1" ||
		typeof plan.fingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(plan.fingerprint)
	)
		throw new Error("Unrecognized scan job");
	const statusPath = resolve(root, "monitor-status.json");
	const status = async (value: unknown) => {
		const temporary = `${statusPath}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
		await rename(temporary, statusPath);
	};
	for (;;) {
		options.signal?.throwIfAborted();
		const previous = await jsonIfPresent(resolve(root, "scan-status.json"));
		if (record(previous) && previous.status === "complete") {
			await status({ status: "complete", updatedAt: new Date().toISOString() });
			return;
		}
		if (
			record(previous) &&
			previous.status === "paused" &&
			(typeof previous.reason !== "string" ||
				!canResumeScanPause(previous.reason))
		) {
			await status({
				status: "attention-required",
				reason: previous.reason,
				updatedAt: new Date().toISOString(),
			});
			throw new Error(
				"Scan safety pause requires inspection; automatic restart refused",
			);
		}
		// Preserve both an upstream Retry-After and our own cooldown across restarts.
		const previousMonitor = await jsonIfPresent(statusPath);
		const retryAt = Math.max(
			...[previous, previousMonitor].map((value) =>
				record(value) &&
				typeof value.retryAt === "string" &&
				Number.isFinite(Date.parse(value.retryAt))
					? Date.parse(value.retryAt)
					: 0,
			),
		);
		if (retryAt > Date.now())
			await delay(retryAt - Date.now(), undefined, { signal: options.signal });
		await recoverExitedScanLock(`${root}.scan-lock`);
		await recoverExitedScanLock(resolve(root, ".lock"));
		await status({
			status: "running",
			pid: process.pid,
			updatedAt: new Date().toISOString(),
		});
		try {
			await runColorScan(options);
			await status({ status: "complete", updatedAt: new Date().toISOString() });
			return;
		} catch (error) {
			if (options.signal?.aborted) throw error;
			const reason =
				error instanceof Error ? error.message : "Unknown scan error";
			if (!canResumeScanPause(reason)) {
				await status({
					status: "attention-required",
					reason,
					updatedAt: new Date().toISOString(),
				});
				throw error;
			}
			await status({
				status: "waiting-to-restart",
				reason,
				pid: process.pid,
				updatedAt: new Date().toISOString(),
				retryAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
			});
			options.onProgress?.(
				`Monitor: ${reason}; retry in five minutes. Safety gates remain active.`,
			);
		}
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			catalog: { type: "string" },
			output: { type: "string" },
			"reuse-manifest": { type: "string" },
		},
	});
	if (!values.catalog || !values.output)
		throw new Error(
			"Usage: colors:supervise --catalog FILE --output EXISTING_JOB [--reuse-manifest FILE]",
		);
	const controller = new AbortController(),
		abort = () => controller.abort();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	console.log(`Scan supervisor PID ${process.pid}`);
	try {
		await superviseColorScan({
			catalog: values.catalog,
			output: values.output,
			reuseManifest: values["reuse-manifest"],
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
		console.error(
			error instanceof Error ? error.message : "Supervisor stopped",
		);
		process.exitCode =
			error instanceof Error && canResumeScanPause(error.message) ? 75 : 2;
	});
