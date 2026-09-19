import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	LEGACY_FILE,
	LEGACY_RELEASES,
} from "../workers/color-index/legacy.mjs";
import { createS3Transport, type ObjectTransport, SAFETY_KEY } from "./r2-s3";

const archive = resolve(import.meta.dirname, "../archives/color-index");
const origin = "https://chromacollection-index.thinkingofview.workers.dev";
const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

export async function inventoryLegacy(root = archive) {
	const files: { path: string; bytes: number; sha256: string }[] = [];
	for (const release of LEGACY_RELEASES) {
		async function walk(relative = "") {
			const directory = resolve(root, release, relative);
			if (!(await lstat(directory)).isDirectory())
				throw new Error("Archive directories must not be symlinks");
			for (const name of (await readdir(directory)).sort()) {
				const path = relative ? `${relative}/${name}` : name;
				if (path === "samples") {
					await walk(path);
					continue;
				}
				const full = resolve(root, release, path);
				if (!LEGACY_FILE.test(path) || !(await lstat(full)).isFile())
					throw new Error(`Unexpected legacy asset: ${release}/${path}`);
				const bytes = await readFile(full),
					hash = sha256(bytes);
				if (
					!bytes.length ||
					bytes.length > (path.endsWith(".rgba") ? 160000 : 16 * 1024 * 1024)
				)
					throw new Error(
						`Legacy asset exceeds delivery bounds: ${release}/${path}`,
					);
				if (path.endsWith(".rgba") && path !== `samples/${hash}.rgba`)
					throw new Error(`Sample hash mismatch: ${release}/${path}`);
				files.push({
					path: `${release}/${path}`,
					bytes: bytes.length,
					sha256: hash,
				});
			}
		}
		await walk();
		for (const name of ["index.json", "artworks.json", "report.json"])
			if (!files.some((file) => file.path === `${release}/${name}`))
				throw new Error(`Missing ${release}/${name}`);
		if (!files.some((file) => file.path.startsWith(`${release}/samples/`)))
			throw new Error(`No samples for ${release}`);
	}
	return files;
}

async function verifyBytes(response: Response, bytes: Uint8Array) {
	if (
		!response.ok ||
		sha256(new Uint8Array(await response.arrayBuffer())) !== sha256(bytes)
	)
		throw new Error(
			"Existing object differs or could not be verified; nothing may be overwritten",
		);
}

export async function uploadImmutable(
	request: ObjectTransport,
	key: string,
	bytes: Uint8Array,
) {
	const existing = await request(key);
	if (existing.ok) {
		await verifyBytes(existing, bytes);
		return "existing";
	}
	await existing.body?.cancel();
	if (existing.status !== 404)
		throw new Error(`Destination check failed (HTTP ${existing.status})`);
	const response = await request(key, {
		method: "PUT",
		body: new Blob([Uint8Array.from(bytes)]),
		headers: {
			"if-none-match": "*",
			"content-type": key.endsWith(".json")
				? "application/json"
				: "application/octet-stream",
			"cache-control": "public, max-age=31536000, immutable, no-transform",
		},
	});
	if (response.status === 412) {
		await response.body?.cancel();
		await verifyBytes(await request(key), bytes);
		return "existing";
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Upload failed (HTTP ${response.status}); safe to rerun`);
	}
	await response.body?.cancel();
	await verifyBytes(await request(key), bytes);
	return "uploaded";
}

export async function verifyConditionalWrites(request: ObjectTransport) {
	const initial = await request(SAFETY_KEY);
	await initial.body?.cancel();
	if (initial.status !== 404)
		throw new Error(
			"Disposable safety key is not absent; no writes or deletes allowed",
		);
	const first = new TextEncoder().encode(
		`chroma-safety-original:${randomUUID()}`,
	);
	const second = new TextEncoder().encode(
		`chroma-safety-conflict:${randomUUID()}`,
	);
	const put = (bytes: Uint8Array) =>
		request(SAFETY_KEY, {
			method: "PUT",
			body: new Blob([Uint8Array.from(bytes)]),
			headers: { "if-none-match": "*", "content-type": "text/plain" },
		});
	let failure: unknown;
	try {
		const created = await put(first);
		await created.body?.cancel();
		if (!created.ok)
			throw new Error(`Safety object creation failed (HTTP ${created.status})`);
		await verifyBytes(await request(SAFETY_KEY), first);
		const conflict = await put(second);
		await conflict.body?.cancel();
		if (conflict.status !== 412)
			throw new Error(
				`Conditional-write safety gate failed (HTTP ${conflict.status})`,
			);
		await verifyBytes(await request(SAFETY_KEY), first);
	} catch (error) {
		failure = error;
	}
	// Only these two unguessable, task-owned bodies authorize disposable-key cleanup.
	const current = await request(SAFETY_KEY);
	if (current.status !== 404) {
		const bytes = new Uint8Array(await current.arrayBuffer());
		if (!current.ok || ![sha256(first), sha256(second)].includes(sha256(bytes)))
			throw new Error("Safety key is not verifiably task-owned; left intact");
		const removed = await request(SAFETY_KEY, { method: "DELETE" });
		await removed.body?.cancel();
		if (!removed.ok)
			throw new Error("Could not remove the task-owned safety object");
		const absent = await request(SAFETY_KEY);
		await absent.body?.cancel();
		if (absent.status !== 404)
			throw new Error("Safety object deletion is unverified");
	} else await current.body?.cancel();
	if (failure !== undefined) throw failure;
}

export async function forEachBounded<T>(
	items: T[],
	operation: (item: T) => Promise<void>,
) {
	let cursor = 0,
		failed = false,
		failure: unknown;
	await Promise.all(
		Array.from({ length: Math.min(4, items.length) }, async () => {
			while (!failed && cursor < items.length) {
				const item = items[cursor++];
				try {
					await operation(item);
				} catch (error) {
					failed = true;
					failure = error;
				}
			}
		}),
	);
	if (failed) throw failure;
}

async function main() {
	const { values } = parseArgs({
		options: {
			upload: { type: "boolean", default: false },
			"safety-test": { type: "boolean", default: false },
			"verify-public": { type: "boolean", default: false },
			"verify-old": { type: "boolean", default: false },
			"credentials-file": { type: "string" },
		},
	});
	if (
		[
			values.upload,
			values["safety-test"],
			values["verify-public"],
			values["verify-old"],
		].filter(Boolean).length > 1
	)
		throw new Error("Choose one operation");
	let uploadRequest: ObjectTransport | undefined;
	if (values.upload || values["safety-test"]) {
		if (!values["credentials-file"])
			throw new Error(
				"S3 operations require --credentials-file (owner-only file); REST authentication is not supported",
			);
		uploadRequest = await createS3Transport(values["credentials-file"]);
		await verifyConditionalWrites(uploadRequest);
		console.log(
			"S3 safety gate passed: conflict rejected with 412, original retained, disposable key removed and verified absent.",
		);
		if (values["safety-test"]) return;
	}
	const files = await inventoryLegacy();
	console.log(
		JSON.stringify({
			files: files.length,
			bytes: files.reduce((n, file) => n + file.bytes, 0),
			inventorySha256: sha256(Buffer.from(JSON.stringify(files))),
		}),
	);
	if (!values.upload && !values["verify-public"] && !values["verify-old"]) {
		console.log("Inventory only. No network requests or writes.");
		return;
	}
	const base = values["verify-old"]
		? "https://www.chromacollection.online/color-index"
		: `${origin}/v2`;
	const request: ObjectTransport = (key) =>
		fetch(`${base}/${key}`, { signal: AbortSignal.timeout(120000) });
	let completed = 0;
	// Upload entry-point JSON last. The Vercel redirect rollout is a separate approval gate.
	const processFile = async (file: (typeof files)[number]) => {
		const bytes = await readFile(resolve(archive, file.path));
		if (sha256(bytes) !== file.sha256)
			throw new Error("Local archive changed during operation");
		if (uploadRequest)
			await uploadImmutable(uploadRequest, `v2/${file.path}`, bytes);
		else {
			const response = await request(file.path);
			if (
				values["verify-old"] &&
				(!response.redirected || response.url !== `${origin}/v2/${file.path}`)
			)
				throw new Error(
					`Legacy URL did not redirect to its exact compatibility object: ${file.path}`,
				);
			if (
				response.headers.get("access-control-allow-origin") !== "*" ||
				!response.headers.get("cache-control")?.includes("immutable") ||
				!response.headers
					.get("content-type")
					?.startsWith(
						file.path.endsWith(".json")
							? "application/json"
							: "application/octet-stream",
					)
			)
				throw new Error(`Missing delivery headers: ${file.path}`);
			await verifyBytes(response, bytes);
		}
		completed++;
		if (completed % 100 === 0 || completed === files.length)
			console.log(`Verified ${completed}/${files.length}`);
	};
	await forEachBounded(
		files.filter((file) => !file.path.endsWith("/index.json")),
		processFile,
	);
	await forEachBounded(
		files.filter((file) => file.path.endsWith("/index.json")),
		processFile,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "Legacy operation failed",
		);
		process.exitCode = 1;
	});
}
