import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadColorCorpus } from "../scripts/download-color-corpus.ts";

test("extending a completed corpus reuses source files and metadata without a network request", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "chroma-corpus-reuse-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("No request expected");
	});
	const imageId = "00000000-0000-0000-0000-000000000001";
	const manifest = join(directory, "manifest.json");
	const catalog = join(directory, "artworks.json");
	const image = join(directory, "source.jpg");
	await writeFile(image, "existing source bytes");
	await writeFile(
		manifest,
		JSON.stringify({
			version: 1,
			colorSpace: "srgb",
			corpus: "Test",
			entries: [
				{
					artworkId: 1,
					imageId,
					sourceUpdatedAt: null,
					imagePath: "source.jpg",
				},
			],
		}),
	);
	await writeFile(
		catalog,
		JSON.stringify({
			version: 1,
			artworks: [
				{
					id: 1,
					title: "Existing artwork",
					image_id: imageId,
					is_public_domain: true,
					artist_id: 2,
				},
			],
		}),
	);
	const output = join(directory, "extended");
	const result = await downloadColorCorpus(output, 1, { manifest, catalog });
	assert.deepEqual(result, {
		selected: 0,
		reused: 1,
		downloaded: 0,
		total: 1,
		skipped: 0,
	});
	const saved = JSON.parse(
		await readFile(join(output, "manifest.json"), "utf8"),
	);
	assert.equal(saved.entries[0].imagePath, image);
	assert.equal(await readFile(image, "utf8"), "existing source bytes");
	assert.deepEqual(await readdir(join(output, "originals")), []);
	assert.equal(
		JSON.parse(await readFile(join(output, "artworks.json"), "utf8"))
			.artworks[0].artist_id,
		2,
	);
	await assert.rejects(
		downloadColorCorpus(output, 1, { manifest, catalog }),
		/EEXIST/,
	);
	await writeFile(catalog, JSON.stringify({ version: 1, artworks: [] }));
	await assert.rejects(
		downloadColorCorpus(join(directory, "invalid"), 1, { manifest, catalog }),
		/do not agree/,
	);
	assert.ok(!(await readdir(directory)).includes("invalid"));
});

test("download targets remain bounded before filesystem or network work", async (t) => {
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("No request expected");
	});
	for (const limit of [0, -1, 1.5, 2501, Infinity])
		await assert.rejects(
			downloadColorCorpus("unused-output", limit),
			/bounded corpus/,
		);
});

test("unusable images are replaced from the candidate pool and downloading stops at the successful target", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "chroma-corpus-refill-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	let now = 0;
	t.mock.method(Date, "now", () => (now += 1100));
	const images: string[] = [];
	const records = [1, 2, 3, 4].map((id) => ({
		id,
		title: `Artwork ${id}`,
		is_public_domain: true,
		image_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
	}));
	t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		if (url.hostname === "api.artic.edu") {
			const params = JSON.parse(url.searchParams.get("params") ?? "{}");
			return Response.json({
				data: params.q === "landscape painting" ? records : [],
			});
		}
		images.push(url.pathname);
		if (url.pathname.includes(records[0].image_id))
			return new Response("Unavailable", { status: 403 });
		const bytes = url.pathname.includes(records[1].image_id)
			? "ICC_PROFILE\0"
			: "test JPEG bytes";
		return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
	});
	const output = join(directory, "corpus");
	const result = await downloadColorCorpus(output, 1);
	assert.deepEqual(result, {
		selected: 3,
		reused: 0,
		downloaded: 1,
		total: 1,
		skipped: 2,
	});
	assert.equal(
		images.length,
		3,
		"Do not fetch the fourth candidate after the successful target is reached",
	);
	const manifest = JSON.parse(
		await readFile(join(output, "manifest.json"), "utf8"),
	);
	assert.equal(manifest.entries[0].artworkId, 3);
	assert.deepEqual(await readdir(join(output, "originals")), ["3.jpg"]);
	const report = JSON.parse(
		await readFile(join(output, "download-report.json"), "utf8"),
	);
	assert.equal(report.candidates, 4);
	assert.deepEqual(
		report.skipped.map((row: { reason: string }) => row.reason),
		["image-unavailable-403", "embedded-icc-needs-normalization"],
	);
});
