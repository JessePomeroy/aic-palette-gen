import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { importArtworkCatalog } from "../scripts/import-artwork-catalog.ts";
import { readArtworkCatalog } from "../src/lib/colors/index-catalog.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "chroma-catalog-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, "artworks"),
		archive = join(root, "source.tar.bz2"),
		output = join(root, "catalog");
	await mkdir(input);
	await writeFile(
		archive,
		"Synthetic archive provenance fixture; not museum data",
	);
	const row = {
		id: 1,
		title: "Fixture",
		is_public_domain: true,
		image_id: "00000000-0000-0000-0000-000000000001",
		source_updated_at: "2025-02-01T00:00:00Z",
		timestamp: "2025-02-16T00:00:00Z",
	};
	await writeFile(join(input, "1.json"), JSON.stringify(row));
	return {
		root,
		input,
		archive,
		output,
		sourceModified: "Sun, 16 Feb 2025 08:32:05 GMT",
		row,
	};
}

test("complete input catalog accounts for every exclusion and retains source dates", async (t) => {
	const f = await fixture(t);
	const rows = [
		{ ...f.row, id: 2, is_public_domain: false },
		{ ...f.row, id: 3, image_id: null },
		{ ...f.row, id: 4, image_id: "invalid" },
		{ ...f.row, id: 5, title: "" },
		{ ...f.row, id: 10 },
	];
	for (const row of rows)
		await writeFile(join(f.input, `${row.id}.json`), JSON.stringify(row));
	const report = await importArtworkCatalog(f);
	assert.equal(report.totalRecords, 6);
	assert.equal(report.eligibleArtworks, 2);
	assert.equal(report.excludedRecords, 4);
	assert.deepEqual(Object.values(report.exclusions), [1, 1, 1, 1]);
	const catalog = readArtworkCatalog(
		JSON.parse(await readFile(join(f.output, "artworks.json"), "utf8")),
	);
	assert.deepEqual([...catalog.keys()], [1, 10]);
	const provenance = JSON.parse(
		await readFile(join(f.output, "provenance.json"), "utf8"),
	);
	assert.equal(provenance.entries[0].sourceUpdatedAt, f.row.source_updated_at);
	assert.match(report.scope, /live freshness not verified/);
});

test("repeat import is deterministic and resumes missing completion artifacts", async (t) => {
	const f = await fixture(t);
	const report = await importArtworkCatalog(f);
	await rm(join(f.output, "report.json"));
	assert.deepEqual(await importArtworkCatalog(f), report);
	await writeFile(join(f.output, "artworks.json"), "corrupt");
	await assert.rejects(importArtworkCatalog(f), /Existing output differs/);
});

test("mismatched record identity, changed snapshot, and symlinks fail closed", async (t) => {
	const f = await fixture(t);
	await writeFile(join(f.input, "2.json"), JSON.stringify(f.row));
	await assert.rejects(importArtworkCatalog(f), /Invalid artwork record/);
	await rm(join(f.input, "2.json"));
	await importArtworkCatalog(f);
	await writeFile(f.archive, "changed archive");
	await assert.rejects(importArtworkCatalog(f), /different inputs/);
	await symlink(join(f.input, "1.json"), join(f.input, "2.json"));
	await assert.rejects(importArtworkCatalog(f), /Unexpected artwork file/);
});

test("existing output lock and unowned directory are preserved", async (t) => {
	const f = await fixture(t);
	await importArtworkCatalog(f);
	await writeFile(join(f.output, ".lock"), "another writer");
	await assert.rejects(importArtworkCatalog(f), /EEXIST/);
	assert.equal(
		await readFile(join(f.output, ".lock"), "utf8"),
		"another writer",
	);
	const unrelated = join(f.root, "unrelated");
	await mkdir(unrelated);
	await writeFile(join(unrelated, "keep.txt"), "preserve");
	await assert.rejects(importArtworkCatalog({ ...f, output: unrelated }));
	assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "preserve");
});
