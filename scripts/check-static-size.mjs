import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEGACY_RELEASES } from "../workers/color-index/legacy.mjs";

export const WARN_BYTES = 10_000_000;
export const MAX_BYTES = 25_000_000;

/** @param {string} directory */
export async function inspectStatic(directory) {
	/** @type {{path: string, bytes: number}[]} */
	const files = [];
	async function walk(relative = "") {
		for (const name of await readdir(resolve(directory, relative))) {
			const path = relative ? `${relative}/${name}` : name;
			const info = await lstat(resolve(directory, path));
			if (info.isSymbolicLink())
				throw new Error(`Static symlink is not allowed: ${path}`);
			if (
				path === "archives" ||
				LEGACY_RELEASES.some((release) => path === `color-index/${release}`)
			)
				throw new Error(`Legacy archive must not be deployed: ${path}`);
			if (info.isDirectory()) await walk(path);
			else if (info.isFile()) files.push({ path, bytes: info.size });
			else throw new Error(`Unexpected static entry: ${path}`);
		}
	}
	await walk();
	files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
	return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

/** @param {number} bytes */
export function enforceBudget(bytes) {
	if (bytes > MAX_BYTES)
		throw new Error(
			`Static output ${bytes} bytes exceeds ${MAX_BYTES}; review assets before changing the budget.`,
		);
	return bytes > WARN_BYTES ? "warning" : "ok";
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const directory = process.argv[2];
	if (!directory)
		throw new Error("Provide the static source or generated output directory");
	const report = await inspectStatic(directory);
	console.log(
		`${directory}: ${report.bytes} bytes, ${report.files.length} files`,
	);
	for (const file of report.files.slice(0, 10))
		console.log(`  ${file.bytes} ${file.path}`);
	if (enforceBudget(report.bytes) === "warning")
		console.warn(`WARNING: static output exceeds ${WARN_BYTES} bytes`);
}
