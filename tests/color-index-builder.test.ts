import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { buildColorIndex } from "../scripts/build-color-index.ts";
import {
	findIndexedArtwork,
	readColorIndex,
} from "../src/lib/colors/color-index.ts";

async function workspace(t: TestContext) {
	const path = await mkdtemp(join(tmpdir(), "chroma-color-index-test-"));
	t.after(() => rm(path, { recursive: true, force: true }));
	return path;
}

// A local, uncompressed 24-bit bitmap: half red, half blue, no museum data.
function bitmap(width = 2, height = 1) {
	const stride = Math.ceil((width * 3) / 4) * 4;
	const data = Buffer.alloc(54 + stride * height);
	data.write("BM");
	data.writeUInt32LE(data.length, 2);
	data.writeUInt32LE(54, 10);
	data.writeUInt32LE(40, 14);
	data.writeInt32LE(width, 18);
	data.writeInt32LE(height, 22);
	data.writeUInt16LE(1, 26);
	data.writeUInt16LE(24, 28);
	data.writeUInt32LE(stride * height, 34);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			data[54 + y * stride + x * 3 + (x < width / 2 ? 2 : 0)] = 255;
	return data;
}

function manifest(...paths: string[]) {
	return {
		version: 1,
		colorSpace: "srgb",
		corpus: "Synthetic offline builder fixture, not a museum pilot",
		entries: paths.map((imagePath, i) => ({
			artworkId: i + 1,
			imageId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
			sourceUpdatedAt: null,
			imagePath,
		})),
	};
}

test("local image -> generated index -> all-lock random selection requires no network", async (t) => {
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("No network allowed");
	});
	const directory = await workspace(t);
	await writeFile(join(directory, "colors.bmp"), bitmap());
	const input = join(directory, "manifest.json");
	await writeFile(input, JSON.stringify(manifest("colors.bmp", "missing.bmp")));
	const output = join(directory, "result");
	const report = await buildColorIndex(input, output);
	assert.equal(report.selected, 2);
	assert.equal(report.analyzed, 1);
	assert.deepEqual(report.skipped, [{ artworkId: 2, reason: "read-failed" }]);
	assert.deepEqual(
		JSON.parse(await readFile(join(output, "report.json"), "utf8")),
		report,
	);
	const index = readColorIndex(
		JSON.parse(await readFile(join(output, "index.json"), "utf8")),
	);
	assert.equal(index.entries[0].signature.opaquePixels, 2);
	const loadSample = async (entry: (typeof index.entries)[number]) =>
		readFile(join(output, "samples", `${entry.sample.sha256}.rgba`));
	const result = await findIndexedArtwork(index, ["#ff0000", "#0000ff"], {
		loadSample,
		random: () => 0,
	});
	assert.equal(result.status, "match");
	if (result.status !== "match") throw new Error("Expected both colors");
	assert.equal(result.entry.artworkId, 1);
	assert.deepEqual(
		result.match.locks.map((lock) => lock.coverage),
		[0.5, 0.5],
	);
	assert.equal(
		(await findIndexedArtwork(index, ["#00ff00"], { loadSample })).status,
		"no-match",
	);
});

test("a release catalog is validated up front and contains only successfully indexed artworks", async (t) => {
	const directory = await workspace(t);
	await writeFile(join(directory, "colors.bmp"), bitmap());
	const input = manifest("colors.bmp", "missing.bmp");
	const manifestPath = join(directory, "manifest.json");
	await writeFile(manifestPath, JSON.stringify(input));
	const catalog = {
		version: 1,
		artworks: input.entries.map((entry) => ({
			id: entry.artworkId,
			title: "Synthetic",
			image_id: entry.imageId,
			is_public_domain: true,
		})),
	};
	const catalogPath = join(directory, "artworks.json");
	await writeFile(catalogPath, JSON.stringify(catalog));
	const output = join(directory, "release");
	await buildColorIndex(manifestPath, output, catalogPath);
	const released = JSON.parse(
		await readFile(join(output, "artworks.json"), "utf8"),
	);
	assert.deepEqual(
		released.artworks.map((art: { id: number }) => art.id),
		[1],
	);
	catalog.artworks[0].image_id = catalog.artworks[1].image_id;
	await writeFile(catalogPath, JSON.stringify(catalog));
	await assert.rejects(
		buildColorIndex(
			manifestPath,
			join(directory, "invalid-release"),
			catalogPath,
		),
		/does not match/,
	);
	assert.ok(!(await readdir(directory)).includes("invalid-release"));
});

test("large local images are resized to the declared sample budget", async (t) => {
	const directory = await workspace(t);
	await writeFile(join(directory, "large.bmp"), bitmap(400, 200));
	const input = join(directory, "manifest.json");
	await writeFile(input, JSON.stringify(manifest("large.bmp")));
	const output = join(directory, "result");
	await buildColorIndex(input, output);
	const index = readColorIndex(
		JSON.parse(await readFile(join(output, "index.json"), "utf8")),
	);
	assert.equal(index.entries[0].signature.opaquePixels, 200 * 100);
	assert.equal(
		(
			await findIndexedArtwork(index, ["#ff0000", "#0000ff"], {
				loadSample: async (entry) =>
					readFile(join(output, "samples", `${entry.sample.sha256}.rgba`)),
			})
		).status,
		"match",
	);
});

test("existing outputs are never overwritten", async (t) => {
	const directory = await workspace(t);
	await writeFile(join(directory, "colors.bmp"), bitmap());
	const input = join(directory, "manifest.json");
	await writeFile(input, JSON.stringify(manifest("colors.bmp")));
	const output = join(directory, "result");
	await buildColorIndex(input, output);
	const original = await readFile(join(output, "index.json"), "utf8");
	await assert.rejects(buildColorIndex(input, output), { code: "EEXIST" });
	assert.equal(await readFile(join(output, "index.json"), "utf8"), original);
});

test("identical normalized pixels share one immutable sample file", async (t) => {
	const directory = await workspace(t);
	await writeFile(join(directory, "colors.bmp"), bitmap());
	const input = join(directory, "manifest.json");
	await writeFile(input, JSON.stringify(manifest("colors.bmp", "colors.bmp")));
	const output = join(directory, "result");
	await buildColorIndex(input, output);
	const index = readColorIndex(
		JSON.parse(await readFile(join(output, "index.json"), "utf8")),
	);
	assert.equal(index.entries.length, 2);
	assert.equal(index.entries[0].sample.sha256, index.entries[1].sample.sha256);
	assert.deepEqual(await readdir(join(output, "samples")), [
		`${index.entries[0].sample.sha256}.rgba`,
	]);
});

test("all-image failures produce a report, never an apparently usable empty index", async (t) => {
	const directory = await workspace(t);
	await writeFile(join(directory, "invalid.bmp"), "not an image");
	const input = join(directory, "manifest.json");
	await writeFile(
		input,
		JSON.stringify(manifest("invalid.bmp", "missing.bmp")),
	);
	const output = join(directory, "result");
	await assert.rejects(
		buildColorIndex(input, output),
		/No images could be analyzed/,
	);
	const report = JSON.parse(
		await readFile(join(output, "report.json"), "utf8"),
	);
	assert.equal(report.analyzed, 0);
	assert.deepEqual(
		report.skipped.map((row: { reason: string }) => row.reason),
		["decode-or-analysis-failed", "read-failed"],
	);
	await assert.rejects(readFile(join(output, "index.json")), {
		code: "ENOENT",
	});
});

test("remote image paths, duplicate IDs and unsupported manifests fail before creating output", async (t) => {
	const directory = await workspace(t);
	const input = join(directory, "manifest.json");
	const output = join(directory, "result");
	const duplicate = manifest("one.bmp", "two.bmp");
	duplicate.entries[1].artworkId = 1;
	for (const value of [
		manifest("https://example.com/image.jpg"),
		manifest("file:///tmp/image.jpg"),
		manifest("data:image/png;base64,abc"),
		duplicate,
		{ ...manifest("one.bmp"), colorSpace: "display-p3" },
		{ ...manifest("one.bmp"), version: 2 },
		manifest(),
	]) {
		await writeFile(input, JSON.stringify(value));
		await assert.rejects(buildColorIndex(input, output), /manifest/i);
		await assert.rejects(readFile(output), { code: "ENOENT" });
	}
});
