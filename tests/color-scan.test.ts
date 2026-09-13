import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { runColorScan } from "../scripts/run-color-scan.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "chroma-scan-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const bitmap = Buffer.alloc(58);
	bitmap.write("BM");
	bitmap.writeUInt32LE(58, 2);
	bitmap.writeUInt32LE(54, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(1, 18);
	bitmap.writeInt32LE(1, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(24, 28);
	bitmap[56] = 255;
	const source = join(root, "source.bmp");
	await writeFile(source, bitmap);
	const artworks = [1, 2, 3].map((id) => ({
		id,
		title: `Fixture ${id}`,
		image_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
		is_public_domain: true,
	}));
	const catalog = join(root, "catalog.json"),
		reuseManifest = join(root, "reuse.json"),
		output = join(root, "scan");
	await writeFile(catalog, JSON.stringify({ version: 1, artworks }));
	await writeFile(
		reuseManifest,
		JSON.stringify({
			version: 1,
			colorSpace: "srgb",
			corpus: "test",
			entries: artworks.map((artwork) => ({
				artworkId: artwork.id,
				imageId: artwork.image_id,
				imagePath: source,
				sourceUpdatedAt: null,
			})),
		}),
	);
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("No network in cached scan fixture");
	});
	return { catalog, reuseManifest, output, source };
}

test("scan gates completion on pilot, sample audit, and original hashes", async (t) => {
	const f = await fixture(t);
	const result = await runColorScan(f);
	assert.equal(result.status, "complete");
	assert.equal(result.indexed, 3);
	assert.equal(result.originalHashesVerified, 3);
	assert.equal(result.samplesVerified, 3);
	assert.equal(result.published, false);
	assert.equal(
		JSON.parse(await readFile(join(f.output, "pilot-report.json"), "utf8"))
			.passed,
		true,
	);
	await assert.rejects(readFile(`${f.output}.scan-lock`), /ENOENT/);
	await writeFile(f.source, "corrupt original");
	await assert.rejects(runColorScan(f), /Original source no longer matches/);
});

test("failed pilot pauses without entering full scan or claiming completion", async (t) => {
	const f = await fixture(t);
	await writeFile(f.source, "bad image");
	await assert.rejects(runColorScan(f), /Pilot acceptance below/);
	assert.equal(
		JSON.parse(await readFile(join(f.output, "scan-status.json"), "utf8"))
			.status,
		"paused",
	);
	await assert.rejects(readFile(join(f.output, "scan-report.json")), /ENOENT/);
});
