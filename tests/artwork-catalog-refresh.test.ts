import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { refreshArtworkCatalog } from "../scripts/refresh-artwork-catalog.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "chroma-refresh-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let time = 1000;
	t.mock.method(Date, "now", () => {
		time += 1100;
		return time;
	});
	const rows = Array.from({ length: 105 }, (_, index) => ({
		id: index + 1,
		title: `Fixture ${index + 1}`,
		is_public_domain: true,
		image_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
		source_updated_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-02T00:00:00Z",
	}));
	const baselineCatalog = join(root, "baseline.json"),
		reuseManifest = join(root, "reuse.json"),
		output = join(root, "live");
	await writeFile(
		baselineCatalog,
		JSON.stringify({ version: 1, artworks: rows.slice(0, 100) }),
	);
	await writeFile(join(root, "source.jpg"), "cached fixture");
	await writeFile(
		reuseManifest,
		JSON.stringify({
			version: 1,
			colorSpace: "srgb",
			corpus: "test",
			entries: [
				{
					artworkId: 1,
					imageId: rows[0].image_id,
					imagePath: "source.jpg",
					sourceUpdatedAt: rows[0].source_updated_at,
				},
			],
		}),
	);
	let calls = 0;
	t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
		calls++;
		const params = JSON.parse(
			new URL(String(input)).searchParams.get("params") ?? "{}",
		);
		const range = params.query.bool.filter[2].range.id;
		const matches = rows.filter(
			(row) =>
				row.id > range.gt && (range.lte === undefined || row.id <= range.lte),
		);
		if (params.sort[0].id === "desc") matches.reverse();
		return Response.json({
			pagination: { total: matches.length },
			data: matches.slice(0, params.limit),
		});
	});
	return {
		root,
		rows,
		baselineCatalog,
		reuseManifest,
		output,
		calls: () => calls,
	};
}

test("keyset refresh resumes pages, reconciles baseline, and reuses only current originals", async (t) => {
	const f = await fixture(t);
	assert.equal(
		(await refreshArtworkCatalog({ ...f, maxPages: 1 })).status,
		"partial",
	);
	assert.equal(f.calls(), 2);
	const result = await refreshArtworkCatalog(f);
	assert.equal(result.status, "complete");
	if (result.status !== "complete") throw new Error("Expected completion");
	assert.equal(result.count, 105);
	assert.equal(result.added, 5);
	assert.equal(result.removed, 0);
	assert.equal(result.reusableOriginals, 1);
	assert.equal(f.calls(), 5);
	assert.equal(
		JSON.parse(await readFile(join(f.output, "provenance.json"), "utf8"))
			.entries.length,
		105,
	);
	await refreshArtworkCatalog(f);
	assert.equal(f.calls(), 5); // Completed frozen catalogs are offline on rerun.
});

test("count drift and corrupted saved page ordering cannot publish a complete catalog", async (t) => {
	const f = await fixture(t);
	await refreshArtworkCatalog({ ...f, maxPages: 1 });
	f.rows.pop();
	await assert.rejects(refreshArtworkCatalog(f), /drift or incomplete page/);
	const pagePath = join(f.output, "pages", "00000.json");
	const page = JSON.parse(await readFile(pagePath, "utf8"));
	page.rows.reverse();
	await writeFile(pagePath, JSON.stringify(page));
	await assert.rejects(refreshArtworkCatalog(f), /ordered ID bounds/);
	await assert.rejects(readFile(join(f.output, "report.json")), /ENOENT/);
});

test("rate limits retain completed pages and release the job lock", async (t) => {
	const f = await fixture(t);
	await refreshArtworkCatalog({ ...f, maxPages: 1 });
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response(null, { status: 429 }),
	);
	await assert.rejects(refreshArtworkCatalog(f), /HTTP 429/);
	assert.ok(await readFile(join(f.output, "pages", "00000.json")));
	await assert.rejects(readFile(join(f.output, ".lock")), /ENOENT/);
});

test("unowned directories and changed inputs are refused", async (t) => {
	const f = await fixture(t);
	await mkdir(f.output);
	await assert.rejects(refreshArtworkCatalog(f), /ENOENT/);
	await rm(f.output, { recursive: true });
	await refreshArtworkCatalog({ ...f, maxPages: 1 });
	await writeFile(
		f.baselineCatalog,
		JSON.stringify({ version: 1, artworks: f.rows }),
	);
	await assert.rejects(refreshArtworkCatalog(f), /inputs changed/);
});
