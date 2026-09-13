import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { processColorBatch } from "../scripts/process-color-batches.ts";
import { analyzeColorfulness } from "../src/lib/colors/colorfulness.ts";

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "chroma-batch-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
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
	await writeFile(join(directory, "source.bmp"), bitmap);
	const artworks = [1, 2, 3].map((id) => ({
		id,
		title: `Fixture ${id}`,
		image_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
		is_public_domain: true,
	}));
	const catalog = join(directory, "catalog.json"),
		reuseManifest = join(directory, "manifest.json"),
		output = join(directory, "job");
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
				imagePath: "source.bmp",
				sourceUpdatedAt: null,
			})),
		}),
	);
	return { directory, catalog, reuseManifest, output, bitmap };
}

test("colorfulness preserves tiny accents and ignores transparent colors", () => {
	assert.equal(
		analyzeColorfulness(Uint8Array.from([128, 128, 128, 255])).tag,
		"grayscale",
	);
	assert.equal(
		analyzeColorfulness(Uint8Array.from([129, 128, 128, 255])).tag,
		"grayscale",
	);
	assert.equal(
		analyzeColorfulness(Uint8Array.from([140, 110, 80, 255])).tag,
		"colorful",
	);
	const pixels = Uint8Array.from(
		Array.from({ length: 200 }, () => [128, 128, 128, 255]).flat(),
	);
	pixels.set([255, 0, 0, 255]);
	assert.equal(analyzeColorfulness(pixels).tag, "near-neutral");
	pixels.set([255, 0, 0, 255], 4);
	assert.equal(analyzeColorfulness(pixels).tag, "colorful");
	assert.equal(
		analyzeColorfulness(Uint8Array.from([128, 128, 128, 255, 255, 0, 0, 0]))
			.tag,
		"grayscale",
	);
	assert.throws(() => analyzeColorfulness(new Uint8Array()));
	assert.throws(() => analyzeColorfulness(new Uint8Array(4)));
});

test("batches resume without duplicates, audit, and retain originals", async (t) => {
	const f = await fixture(t);
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("Network forbidden");
	});
	assert.equal((await processColorBatch({ ...f, batchSize: 2 })).cursor, 2);
	assert.equal((await processColorBatch({ ...f, batchSize: 2 })).indexed, 3);
	assert.equal(
		(await processColorBatch({ ...f, verifyOnly: true })).verified,
		3,
	);
	assert.equal((await readdir(join(f.output, "records"))).length, 3);
	assert.deepEqual(await readFile(join(f.directory, "source.bmp")), f.bitmap);
});

test("receipt ahead of checkpoint rolls forward and corrupted samples stop resume", async (t) => {
	const f = await fixture(t);
	await processColorBatch({ ...f, batchSize: 1 });
	await writeFile(
		join(f.output, "checkpoint.json"),
		JSON.stringify({ cursor: 0, indexed: 0, skipped: 0 }),
	);
	await writeFile(join(f.directory, "source.bmp"), "not an image");
	assert.equal((await processColorBatch({ ...f, batchSize: 1 })).indexed, 1);
	const [sample] = await readdir(join(f.output, "samples"));
	await writeFile(join(f.output, "samples", sample), "corrupt");
	await assert.rejects(processColorBatch(f));
	assert.equal(
		JSON.parse(await readFile(join(f.output, "checkpoint.json"), "utf8"))
			.cursor,
		1,
	);
});

test("changed inputs, invalid limits, and concurrent locks are refused", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		processColorBatch({ ...f, batchSize: 101 }),
		/Batch size/,
	);
	await processColorBatch({ ...f, batchSize: 1 });
	await writeFile(join(f.output, ".lock"), "another process");
	await assert.rejects(processColorBatch(f), /EEXIST/);
	assert.equal(
		await readFile(join(f.output, ".lock"), "utf8"),
		"another process",
	);
	await rm(join(f.output, ".lock"));
	const catalog = JSON.parse(await readFile(f.catalog, "utf8"));
	catalog.artworks[0].title = "changed";
	await writeFile(f.catalog, JSON.stringify(catalog));
	await assert.rejects(processColorBatch(f), /inputs or recipe changed/);
});

test("missing cache pauses offline; rate limits pause without advancing or retries", async (t) => {
	const f = await fixture(t);
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => {
		calls++;
		return new Response(null, { status: 429 });
	});
	const options = { catalog: f.catalog, output: f.output };
	assert.equal((await processColorBatch(options)).cursor, 0);
	assert.equal(calls, 0);
	const result = await processColorBatch({ ...options, allowDownload: true });
	assert.match(result.paused ?? "", /429/);
	assert.equal(result.cursor, 0);
	assert.equal(calls, 1);
});

test("bad image is a durable skip, while cancellation releases the lock", async (t) => {
	const f = await fixture(t);
	await writeFile(join(f.directory, "source.bmp"), "bad image");
	assert.equal((await processColorBatch({ ...f, batchSize: 1 })).skipped, 1);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(processColorBatch({ ...f, signal: controller.signal }));
	assert.ok(!(await readdir(f.output)).includes(".lock"));
	assert.equal(
		(await processColorBatch({ ...f, verifyOnly: true })).verified,
		1,
	);
});

test("download response validation rejects oversized streamed bodies without saving originals", async (t) => {
	const f = await fixture(t);
	let cancelled = false;
	t.mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "image/jpeg", "content-length": "1" } },
			),
	);
	const result = await processColorBatch({
		catalog: f.catalog,
		output: f.output,
		allowDownload: true,
		batchSize: 1,
	});
	assert.equal(result.skipped, 1);
	assert.equal(cancelled, true);
	assert.deepEqual(await readdir(join(f.output, "originals")), []);
	assert.equal(
		JSON.parse(await readFile(join(f.output, "records", "1.json"), "utf8"))
			.reason,
		"invalid-image-response",
	);
});

test("invalid checkpoint and modified analysis stop before advancing", async (t) => {
	const f = await fixture(t);
	await processColorBatch({ ...f, batchSize: 1 });
	const checkpoint = join(f.output, "checkpoint.json");
	await writeFile(
		checkpoint,
		JSON.stringify({ cursor: 2, indexed: 1, skipped: 0 }),
	);
	await assert.rejects(processColorBatch(f), /checkpoint counts/);
	await writeFile(
		checkpoint,
		JSON.stringify({ cursor: 1, indexed: 1, skipped: 0 }),
	);
	const path = join(f.output, "records", "1.json");
	const receipt = JSON.parse(await readFile(path, "utf8"));
	receipt.colorfulness.tag = "grayscale";
	await writeFile(path, JSON.stringify(receipt));
	await assert.rejects(
		processColorBatch({ ...f, verifyOnly: true }),
		/analysis mismatch/,
	);
});

test("rate-limit pauses preserve the upstream Retry-After cooldown", async (t) => {
	const f = await fixture(t);
	t.mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response(null, { status: 429, headers: { "retry-after": "3600" } }),
	);
	const result = await processColorBatch({
		catalog: f.catalog,
		output: f.output,
		allowDownload: true,
		batchSize: 1,
	});
	assert.equal(result.cursor, 0);
	assert.equal(result.retryAfterMs, 3600000);
});
