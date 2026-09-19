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
import { test } from "node:test";
import {
	enforceBudget,
	inspectStatic,
	MAX_BYTES,
	WARN_BYTES,
} from "../scripts/check-static-size.mjs";
import { LEGACY_RELEASES } from "../workers/color-index/legacy.mjs";

test("static budget measures nested output and reports its largest files", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "chroma-static-budget-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "_app"));
	await writeFile(join(root, "_app", "app.js"), "abcdef");
	await writeFile(join(root, "robots.txt"), "ab");
	assert.deepEqual(await inspectStatic(root), {
		bytes: 8,
		files: [
			{ path: "_app/app.js", bytes: 6 },
			{ path: "robots.txt", bytes: 2 },
		],
	});
	assert.equal(enforceBudget(WARN_BYTES), "ok");
	assert.equal(enforceBudget(WARN_BYTES + 1), "warning");
	assert.equal(enforceBudget(MAX_BYTES), "warning");
	assert.throws(() => enforceBudget(MAX_BYTES + 1), /exceeds/);
	await symlink(join(root, "robots.txt"), join(root, "linked"));
	await assert.rejects(inspectStatic(root), /symlink/);
});

test("each legacy directory is rejected even when empty; redirects preserve the exact old prefixes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "chroma-static-legacy-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = JSON.parse(
		await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
	);
	assert.equal(config.redirects.length, LEGACY_RELEASES.length);
	for (const release of LEGACY_RELEASES) {
		const directory = join(root, "color-index", release);
		await mkdir(directory, { recursive: true });
		await assert.rejects(inspectStatic(root), /Legacy archive/);
		await rm(directory, { recursive: true });
		assert.deepEqual(
			config.redirects.find(
				(r: { source: string }) =>
					r.source === `/color-index/${release}/:path*`,
			),
			{
				source: `/color-index/${release}/:path*`,
				destination: `https://chromacollection-index.thinkingofview.workers.dev/v2/${release}/:path*`,
				permanent: false,
			},
		);
	}
});
