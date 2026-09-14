import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readColorIndex } from "../src/lib/colors/color-index";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog";
import {
	type AuditedEntry,
	sha256,
	writeShardRelease,
} from "./lib/shard-builder";

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
async function regular(path: string) {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink())
		throw new Error("Expected an ordinary scan file");
	return readFile(path);
}
async function json(path: string): Promise<unknown> {
	return JSON.parse((await regular(path)).toString("utf8"));
}

export async function packageColorScan(
	scan: string,
	catalogPath: string,
	output: string,
) {
	const root = resolve(scan),
		destination = resolve(output);
	const report = await json(resolve(root, "scan-report.json")),
		checkpoint = await json(resolve(root, "checkpoint.json")),
		plan = await json(resolve(root, "plan.json"));
	const catalog = readArtworkCatalog(await json(resolve(catalogPath)));
	if (
		!record(report) ||
		report.status !== "complete" ||
		!record(checkpoint) ||
		!record(plan) ||
		typeof plan.fingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(plan.fingerprint) ||
		plan.total !== catalog.size ||
		report.checked !== catalog.size ||
		report.total !== catalog.size ||
		checkpoint.cursor !== catalog.size ||
		typeof report.indexed !== "number" ||
		!Number.isSafeInteger(report.indexed) ||
		report.indexed < 1 ||
		report.indexed !== checkpoint.indexed ||
		report.skipped !== checkpoint.skipped ||
		report.indexed + Number(report.skipped) !== catalog.size ||
		report.originalHashesVerified !== report.indexed ||
		report.samplesVerified !== catalog.size ||
		typeof report.completedAt !== "string"
	)
		throw new Error("A complete matching scan audit is required");
	await mkdir(destination);
	const files: { path: string; bytes: number; sha256: string }[] = [];
	let accounted = 0;
	async function* entries(): AsyncGenerator<AuditedEntry> {
		for (const artwork of [...catalog.values()].sort((a, b) => a.id - b.id)) {
			const receipt = await json(
				resolve(root, "records", `${artwork.id}.json`),
			);
			if (
				!record(receipt) ||
				receipt.plan !== plan.fingerprint ||
				JSON.stringify(readIndexedArtwork(receipt.artwork)) !==
					JSON.stringify(artwork)
			)
				throw new Error("Receipt does not match audited catalog");
			accounted++;
			if (receipt.status === "skipped") continue;
			if (receipt.status !== "indexed") throw new Error("Invalid scan receipt");
			const entry = readColorIndex({
				version: 2,
				generatedAt: report.completedAt,
				corpus: "audited scan",
				entries: [receipt.entry],
			}).entries[0];
			yield {
				artwork,
				entry,
				compressedSample: await regular(
					resolve(root, "samples", `${entry.sample.sha256}.rgba.gz`),
				),
			};
			if (accounted % 5000 === 0)
				console.log(`Packaging: ${accounted}/${catalog.size} records`);
		}
	}
	const manifest = await writeShardRelease(
		entries(),
		report.indexed,
		report.completedAt,
		async (path, bytes) => {
			const target = resolve(destination, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, bytes, { flag: "wx" });
			files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
		},
	);
	const result = {
		status: "complete",
		scanFingerprint: plan.fingerprint,
		indexed: manifest.count,
		skipped: report.skipped,
		files,
		bytes: files.reduce((sum, file) => sum + file.bytes, 0),
		published: false,
	};
	await writeFile(
		resolve(destination, "release-report.json"),
		JSON.stringify(result, null, 2),
		{ flag: "wx" },
	);
	return result;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const { values } = parseArgs({
		options: {
			scan: { type: "string" },
			catalog: { type: "string" },
			output: { type: "string" },
		},
	});
	if (!values.scan || !values.catalog || !values.output)
		throw new Error("Provide --scan, --catalog and a new --output directory");
	console.log(`Packaging PID ${process.pid}`);
	packageColorScan(values.scan, values.catalog, values.output)
		.then((result) =>
			console.log(
				JSON.stringify({
					indexed: result.indexed,
					files: result.files.length,
					bytes: result.bytes,
				}),
			),
		)
		.catch((error) => {
			console.error(
				error instanceof Error ? error.message : "Packaging failed",
			);
			process.exitCode = 1;
		});
}
