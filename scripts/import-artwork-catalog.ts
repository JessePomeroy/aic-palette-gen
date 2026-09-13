import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Artwork } from "../src/lib/api/artic.ts";
import {
	readArtworkCatalog,
	readIndexedArtwork,
} from "../src/lib/colors/index-catalog.ts";

const SOURCE_URL =
	"https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2";
const IMAGE_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const digest = (bytes: string) =>
	createHash("sha256").update(bytes).digest("hex");
const date = (value: unknown) =>
	typeof value === "string" && Number.isFinite(Date.parse(value))
		? value
		: null;

export interface CatalogImportOptions {
	input: string;
	output: string;
	archive: string;
	sourceModified: string;
}

/** Import the complete artwork folder from a pinned official bulk snapshot.
 * Completeness is relative to that archive, never a claim of live API freshness.
 */
export async function importArtworkCatalog(options: CatalogImportOptions) {
	if (!date(options.sourceModified))
		throw new Error("A valid archive Last-Modified date is required");
	const input = await realpath(options.input);
	const root = resolve(options.output);
	const parent = await realpath(dirname(root));
	const repository = await realpath(
		resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	);
	const target = resolve(parent, basename(root));
	if (target === repository || target.startsWith(repository + sep))
		throw new Error("Catalog staging must be outside the repository");
	const archiveStat = await lstat(options.archive);
	if (!archiveStat.isFile() || archiveStat.isSymbolicLink())
		throw new Error("Expected a regular source archive");
	const archiveHash = createHash("sha256");
	for await (const chunk of createReadStream(options.archive))
		archiveHash.update(chunk);
	const archiveSha256 = archiveHash.digest("hex");
	const files = await readdir(input, { withFileTypes: true });
	if (!files.length || files.length > 500000)
		throw new Error("Unexpected artwork folder size");
	for (const file of files) {
		if (!file.isFile() || !/^[1-9][0-9]*\.json$/.test(file.name))
			throw new Error(`Unexpected artwork file: ${file.name}`);
	}
	files.sort(
		(a, b) => Number.parseInt(a.name, 10) - Number.parseInt(b.name, 10),
	);
	const artworks: Artwork[] = [];
	const provenance: {
		artworkId: number;
		sourceUpdatedAt: string | null;
		apiUpdatedAt: string | null;
		snapshotTimestamp: string | null;
	}[] = [];
	const excluded: {
		artworkId: number;
		reason:
			| "not-public-domain"
			| "no-image"
			| "invalid-image-id"
			| "invalid-title";
	}[] = [];
	const ids = new Set<number>();
	let publicDomain = 0;
	for (const file of files) {
		const row: unknown = JSON.parse(
			await readFile(resolve(input, file.name), "utf8"),
		);
		if (
			!record(row) ||
			!Number.isSafeInteger(row.id) ||
			row.id !== Number.parseInt(file.name, 10) ||
			ids.has(Number(row.id)) ||
			typeof row.is_public_domain !== "boolean"
		)
			throw new Error(`Invalid artwork record: ${file.name}`);
		const id = Number(row.id);
		ids.add(id);
		if (!row.is_public_domain) {
			excluded.push({ artworkId: id, reason: "not-public-domain" });
			continue;
		}
		publicDomain++;
		if (
			row.image_id === null ||
			row.image_id === undefined ||
			row.image_id === ""
		) {
			excluded.push({ artworkId: id, reason: "no-image" });
			continue;
		}
		if (typeof row.image_id !== "string" || !IMAGE_ID.test(row.image_id)) {
			excluded.push({ artworkId: id, reason: "invalid-image-id" });
			continue;
		}
		if (typeof row.title !== "string" || !row.title.trim()) {
			excluded.push({ artworkId: id, reason: "invalid-title" });
			continue;
		}
		artworks.push(readIndexedArtwork(row));
		provenance.push({
			artworkId: id,
			sourceUpdatedAt: date(row.source_updated_at),
			apiUpdatedAt: date(row.updated_at),
			snapshotTimestamp: date(row.timestamp),
		});
	}
	if (!artworks.length)
		throw new Error("Snapshot contains no eligible artworks");
	const catalog = { version: 1, artworks };
	readArtworkCatalog(catalog);
	const serialized = JSON.stringify(catalog);
	const exclusions = Object.fromEntries(
		["not-public-domain", "no-image", "invalid-image-id", "invalid-title"].map(
			(reason) => [
				reason,
				excluded.filter((row) => row.reason === reason).length,
			],
		),
	);
	const report = {
		version: 1,
		scope:
			"Complete extracted artwork folder from official bulk snapshot; live freshness not verified",
		source: {
			url: SOURCE_URL,
			lastModified: new Date(options.sourceModified).toISOString(),
			archiveSha256,
			archiveBytes: archiveStat.size,
		},
		totalRecords: files.length,
		publicDomainRecords: publicDomain,
		eligibleArtworks: artworks.length,
		excludedRecords: excluded.length,
		exclusions,
		catalogSha256: digest(serialized),
		catalogBytes: Buffer.byteLength(serialized),
	};
	// Deterministic files let an interrupted import resume without overwriting data.
	// Existing unrelated output is refused before acquiring a lock or writing files.
	const plan = {
		version: 1,
		recipe: "public-domain-image-catalog-v1",
		archiveSha256,
		catalogSha256: report.catalogSha256,
		sourceModified: report.source.lastModified,
	};
	let fresh = false;
	try {
		await mkdir(root);
		fresh = true;
	} catch (error) {
		if (!record(error) || error.code !== "EEXIST") throw error;
	}
	const rootStat = await lstat(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
		throw new Error("Unsafe output directory");
	const planPath = resolve(root, "plan.json");
	if (!fresh) {
		const stat = await lstat(planPath);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			(await readFile(planPath, "utf8")) !== JSON.stringify(plan)
		)
			throw new Error(
				"Output belongs to different inputs; choose a new directory",
			);
	}
	const lock = resolve(root, ".lock");
	await writeFile(lock, String(process.pid), { flag: "wx" });
	try {
		if (fresh) await writeFile(planPath, JSON.stringify(plan), { flag: "wx" });
		const save = async (name: string, data: string) => {
			const path = resolve(root, name);
			try {
				const stat = await lstat(path);
				if (
					!stat.isFile() ||
					stat.isSymbolicLink() ||
					(await readFile(path, "utf8")) !== data
				)
					throw new Error(`Existing output differs: ${name}`);
			} catch (error) {
				if (!record(error) || error.code !== "ENOENT") throw error;
				const temporary = `${path}.${process.pid}.tmp`;
				await writeFile(temporary, data, { flag: "wx" });
				await rename(temporary, path);
			}
		};
		await save("artworks.json", serialized);
		await save(
			"provenance.json",
			JSON.stringify({
				version: 1,
				source: report.source,
				entries: provenance,
			}),
		);
		await save(
			"excluded.json",
			JSON.stringify({ version: 1, entries: excluded }),
		);
		// report.json is the completion marker, written after all companion files.
		await save("report.json", JSON.stringify(report, null, 2));
		return report;
	} finally {
		await unlink(lock);
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			input: { type: "string" },
			output: { type: "string" },
			archive: { type: "string" },
			"source-modified": { type: "string" },
		},
	});
	if (
		!values.input ||
		!values.output ||
		!values.archive ||
		!values["source-modified"]
	)
		throw new Error(
			"Usage: colors:catalog --input EXTRACTED_ARTWORK_FOLDER --archive FILE --source-modified HTTP_LAST_MODIFIED --output OUTSIDE_REPO",
		);
	console.log(
		JSON.stringify(
			await importArtworkCatalog({
				input: values.input,
				output: values.output,
				archive: values.archive,
				sourceModified: values["source-modified"],
			}),
		),
	);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "Catalog import failed",
		);
		process.exitCode = 1;
	});
