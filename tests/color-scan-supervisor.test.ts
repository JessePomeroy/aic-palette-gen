import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	canResumeScanPause,
	recoverExitedScanLock,
} from "../scripts/supervise-color-scan.ts";

test("supervisor retries interruptions and server failures without bypassing safety gates", () => {
	for (const reason of [
		"The operation was aborted",
		"Scan paused: HTTP 521; retry this batch later",
		"Scan paused: HTTP 429; retry this batch later",
		"Scan paused: Download interrupted; retry this batch later",
		"Less than 5 GiB free; scan paused to protect disk space",
	])
		assert.equal(canResumeScanPause(reason), true);
	for (const reason of [
		"More than 20% of a batch failed; inspect skip reasons before continuing",
		"Original image checksum mismatch",
		"Invalid checkpoint",
		"Museum requested a cooldown longer than one day; resume later",
		"Scan paused: Missing local image",
		"Unknown scan error",
	])
		assert.equal(canResumeScanPause(reason), false);
});

test("only exited-owner locks are recovered; live and malformed locks are preserved", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "chroma-monitor-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const lock = join(root, "scan.lock");
	await writeFile(lock, String(process.pid));
	await assert.rejects(recoverExitedScanLock(lock), /live process/);
	assert.equal(await readFile(lock, "utf8"), String(process.pid));
	await writeFile(lock, "not a PID");
	await assert.rejects(recoverExitedScanLock(lock), /Invalid scan lock PID/);
	t.mock.method(process, "kill", () => {
		throw Object.assign(new Error("No process"), { code: "ESRCH" });
	});
	await writeFile(lock, "999999");
	await recoverExitedScanLock(lock);
	await assert.rejects(readFile(lock), /ENOENT/);
});
