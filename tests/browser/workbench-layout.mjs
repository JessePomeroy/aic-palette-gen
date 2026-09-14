// Optional browser regression suite; see tests/browser/README.md. All museum,
// sharing, tone and index responses are fixtures. No database/provider writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { shardFixture } from "../helpers/shard-fixture.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(
	["127.0.0.1", "localhost"].includes(new URL(base).hostname),
	"Use an isolated local application",
);
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await playwright[engine].launch({ headless: true });
const errors = [];
const results = [];
const images = {};
const artwork = (id = 101) => ({
	id,
	title:
		id === 101
			? "Landscape study — browser layout fixture"
			: "Portrait study — browser layout fixture",
	artist_title: "Browser test fixture",
	artist_display: "A synthetic image for layout verification",
	artist_id: 7,
	date_display: "2026",
	medium_display: "Synthetic JPEG",
	is_public_domain: true,
	image_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
	thumbnail: {
		width: id === 101 ? 900 : 600,
		height: id === 101 ? 600 : 900,
		alt_text: `Artwork layout fixture ${id}`,
	},
});

async function alignedSaveActions(page) {
	const geometry = await page.evaluate(() => {
		const bounds = (element) => {
			const { left, right, top, height } = element.getBoundingClientRect();
			return { left, right, top, height };
		};
		return {
			rows: [
				".card-format-options",
				".artwork-export-actions > button",
				".palette-save-actions",
			].map((selector) => bounds(document.querySelector(selector))),
			buttons: [
				...document.querySelectorAll(".palette-save-actions > button"),
			].map(bounds),
		};
	});
	for (const row of geometry.rows) {
		assert.ok(
			Math.abs(row.left - geometry.rows[0].left) < 1,
			"Save rows share a left edge",
		);
		assert.ok(
			Math.abs(row.right - geometry.rows[0].right) < 1,
			"Save rows share a right edge",
		);
	}
	assert.equal(geometry.buttons.length, 5);
	for (const button of geometry.buttons) {
		assert.ok(
			Math.abs(button.top - geometry.buttons[0].top) < 1,
			"Format buttons remain on one row",
		);
		assert.ok(button.height >= 44, "Format buttons retain touch-sized targets");
	}
}

async function session(
	viewport = { width: 1440, height: 900 },
	reducedMotion = "reduce",
) {
	const context = await browser.newContext({
		viewport,
		reducedMotion,
		acceptDownloads: true,
	});
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(error.message));
	const state = {
		imageFails: false,
		toneFails: false,
		shareFails: true,
		saves: 0,
		indexUnavailable: false,
		waitForIndex: null,
		lockHex: "#ff0000",
		current: artwork(),
		randomCandidates: 0,
	};
	let indexFixture;
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu") {
			const searching = url.pathname.endsWith("/search");
			if (searching) {
				const query = JSON.parse(url.searchParams.get("params"));
				assert.ok(
					query.query.bool.must_not.some(
						(clause) => clause.term?.artwork_type_id === 45,
					),
					"Search excludes archival groupings at the museum query",
				);
			}
			const archivalCandidate =
				!searching &&
				url.searchParams.has("page") &&
				++state.randomCandidates === 1;
			const rows = searching
				? Array.from({ length: 12 }, (_, i) => ({
						...artwork(202),
						id: 202 + i,
						title: `Portrait study ${i + 1} — browser layout fixture`,
					}))
				: [
						archivalCandidate
							? {
									...state.current,
									id: 262367,
									artwork_type_id: 45,
									image_id: "archival-placeholder",
								}
							: state.current,
					];
			return route.fulfill({
				json: {
					pagination: {
						total: rows.length,
						limit: 12,
						current_page: 1,
						total_pages: 1,
					},
					data: rows,
				},
			});
		}
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image") {
			assert.ok(
				!url.href.includes("archival-placeholder"),
				"The archival placeholder is never loaded or analyzed",
			);
			if (state.imageFails)
				return route.fulfill({ status: 503, body: "Fixture unavailable" });
			return route.fulfill({
				contentType: "image/jpeg",
				body: images[url.href.includes("000000000101") ? 101 : 202],
			});
		}
		if (url.pathname === "/api/ai-palette") {
			const count = Number(url.searchParams.get("count"));
			const hexes = [
				"#e8c0c8",
				"#bd9751",
				"#444f40",
				"#556052",
				"#486b8a",
				"#725c79",
				"#bbbbbb",
				"#303030",
			];
			return route.fulfill(
				state.toneFails
					? { status: 503, json: { error: "Tone fixture unavailable" } }
					: {
							json: {
								description: "A long interpretive description. ".repeat(60),
								colors: hexes.slice(0, count).map((hex) => ({
									hex,
									rgb: {
										r: parseInt(hex.slice(1, 3), 16),
										g: parseInt(hex.slice(3, 5), 16),
										b: parseInt(hex.slice(5), 16),
									},
									hsl: { h: 0, s: 0, l: 50 },
									name: "A deliberately long descriptive color name for wrapping",
								})),
							},
						},
			);
		}
		if (url.pathname === "/api/palette") {
			state.saves++;
			return route.fulfill(
				state.shareFails
					? {
							status: 503,
							json: { error: "Sharing fixture unavailable; please try again." },
						}
					: {
							status: 201,
							json: {
								id: "11111111-1111-4111-8111-111111111111",
								url: `${base}/palette/11111111-1111-4111-8111-111111111111`,
							},
						},
			);
		}
		if (
			url.pathname.startsWith("/color-index/") ||
			url.hostname === "index.test"
		) {
			if (state.waitForIndex) await state.waitForIndex;
			if (state.indexUnavailable)
				return route.fulfill({
					status: 503,
					body: "Fixture index unavailable",
				});
			indexFixture ??= shardFixture([[state.lockHex]], [artwork(202)]);
			const fixture = await indexFixture;
			const response = await fixture.fetcher(
				url.pathname === "/color-index/release.json" ? url.pathname : url.href,
				{ headers: route.request().headers() },
			);
			return route.fulfill({
				status: response.status,
				headers: {
					...Object.fromEntries(response.headers),
					"access-control-allow-origin": "*",
					"access-control-expose-headers": "Content-Range",
				},
				body: Buffer.from(await response.arrayBuffer()),
			});
		}
		if (url.origin !== new URL(base).origin) return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await page.getByRole("button", { name: /^Lock color 1 / }).waitFor();
	return { context, page, state };
}

async function fits(page, label, allowVerticalScroll = false) {
	const geometry = await page.evaluate(() => ({
		width: innerWidth,
		height: innerHeight,
		scrollWidth: document.documentElement.scrollWidth,
		scrollHeight: document.documentElement.scrollHeight,
	}));
	assert.ok(
		geometry.scrollWidth <= geometry.width + 1,
		`${label}: horizontal overflow ${JSON.stringify(geometry)}`,
	);
	if (!allowVerticalScroll)
		assert.ok(
			geometry.scrollHeight <= geometry.height + 1,
			`${label}: vertical page overflow ${JSON.stringify(geometry)}`,
		);
	results.push({ label, ...geometry });
}
async function closed(page) {
	await page.waitForFunction(
		() => !document.querySelector("#workbench-tools")?.open,
	);
}
async function openTool(page, name) {
	await page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name, exact: true })
		.click();
	await page.getByRole("dialog").waitFor();
	return page.getByRole("dialog");
}
async function paletteReady(page, count) {
	await page.waitForFunction(
		(n) =>
			document.querySelectorAll("main .desktop-lock, main .mobile-swatch")
				.length === n && !document.querySelector("main select")?.disabled,
		count,
	);
}

try {
	const fixturePage = await browser.newPage();
	for (const id of [101, 202]) {
		const base64 = await fixturePage.evaluate((id) => {
			const canvas = document.createElement("canvas");
			canvas.width = id === 101 ? 900 : 600;
			canvas.height = id === 101 ? 600 : 900;
			const ctx = canvas.getContext("2d");
			const colors = ["#e8c0c8", "#bd9751", "#444f40", "#486b8a", "#725c79"];
			colors.forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(
					(i * canvas.width) / 5,
					0,
					canvas.width / 5,
					canvas.height,
				);
			});
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}, id);
		images[id] = Buffer.from(base64, "base64");
	}
	await fixturePage.close();
	const { page, context, state } = await session();
	assert.equal(
		state.randomCandidates,
		2,
		"Random skips the archival grouping and loads the next artwork",
	);
	for (const [width, height] of [
		[1024, 768],
		[1199, 550],
		[1280, 600],
		[1366, 768],
		[1440, 900],
		[1920, 1080],
		[2560, 1440],
	]) {
		await page.setViewportSize({ width, height });
		for (const count of [5, 8]) {
			await page
				.locator("main")
				.getByRole("combobox", { name: "Number of colors" })
				.selectOption(String(count));
			await paletteReady(page, count);
			await fits(page, `desktop ${width}x${height}, ${count} colors`);
			const swatches = await page
				.locator(".desktop-swatch")
				.evaluateAll((nodes) =>
					nodes.map((node) => {
						const box = node.getBoundingClientRect();
						return { left: box.left, right: box.right, width: box.width };
					}),
				);
			assert.ok(
				swatches.every(
					(swatch) =>
						swatch.width <= 121 &&
						Math.abs(swatch.width - swatches[0].width) < 1,
				),
				"Desktop swatches should have uniform capped widths",
			);
			assert.ok(
				Math.abs((swatches[0].left + swatches.at(-1).right) / 2 - width / 2) <
					1,
				"Desktop swatch group should be centered",
			);
		}
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	let dialog = await openTool(page, "Search");
	const rect = await dialog.boundingBox();
	assert.ok(
		rect.x > 500 && rect.y >= 0 && rect.y + rect.height <= 900,
		"Desktop tools must be a bounded right drawer",
	);
	await dialog
		.getByRole("textbox", { name: "Search artworks" })
		.fill("portrait");
	await dialog.getByRole("button", { name: "search", exact: true }).click();
	await dialog.getByRole("button", { name: /Portrait study 1 —/ }).waitFor();
	await fits(page, "open search drawer");
	await page.keyboard.press("Escape");
	await closed(page);
	assert.equal(
		await page.evaluate(() => document.activeElement?.textContent?.trim()),
		"Search",
		"Close should restore opener focus",
	);
	dialog = await openTool(page, "Search");
	await page.mouse.click(20, 300);
	await closed(page);
	dialog = await openTool(page, "Search");
	await dialog.getByRole("button", { name: /Portrait study 1 —/ }).click();
	await closed(page);
	await paletteReady(page, 8);
	await fits(page, "portrait artwork selection");
	await page.getByRole("button", { name: "Read full artwork details" }).click();
	dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "More by this artist" }).click();
	await page
		.getByRole("heading", { name: "Find artwork", exact: true })
		.waitFor();
	await page.keyboard.press("Escape");
	await closed(page);

	const lock = page
		.locator("main")
		.getByRole("button", { name: /^Lock color 8 / });
	await lock.click();
	const lockedHex = (
		await page
			.locator("main")
			.getByRole("button", { name: /^Unlock color 8 / })
			.getAttribute("aria-label")
	).match(/#[a-f0-9]{6}/i)[0];
	assert.equal(
		await page
			.locator('main select[aria-label="Number of colors"] option[value="5"]')
			.isDisabled(),
		true,
	);
	dialog = await openTool(page, "Palette");
	await dialog
		.getByRole("button", { name: "Use vibrant", exact: true })
		.waitFor();
	await page.waitForFunction(
		() => !document.querySelector("dialog select")?.disabled,
	);
	await dialog
		.getByRole("button", { name: "Use vibrant", exact: true })
		.click();
	assert.ok(
		(
			await dialog
				.getByRole("button", { name: /^Unlock color 8 / })
				.getAttribute("aria-label")
		).includes(lockedHex),
	);
	await dialog
		.getByRole("combobox", { name: "Extraction mode" })
		.selectOption("ai");
	await page.waitForFunction(
		() => !document.querySelector("dialog select")?.disabled,
	);
	await dialog
		.getByRole("heading", { name: "Compare extraction modes", exact: true })
		.waitFor();
	await dialog.getByRole("button", { name: /Text color/ }).click();
	await page.getByRole("listbox").waitFor();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		() => !document.querySelector("[popover]:popover-open"),
	);
	assert.equal(await dialog.isVisible(), true);
	await fits(
		page,
		"palette drawer with long tone descriptions and eight colors",
	);
	if (output)
		await page.screenshot({
			path: resolve(output, `${engine}-palette-drawer.png`),
		});
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await closed(page);
	await fits(page, "tone remains viewport-sized outside drawer");

	dialog = await openTool(page, "Save & share");
	await alignedSaveActions(page);
	await dialog.getByRole("button", { name: "share", exact: true }).click();
	await dialog
		.getByText("Sharing fixture unavailable; please try again.")
		.waitFor();
	state.shareFails = false;
	await dialog.getByRole("button", { name: "share", exact: true }).click();
	await dialog.getByRole("link", { name: "Open saved palette" }).waitFor();
	await alignedSaveActions(page);
	assert.equal(state.saves, 2);
	for (const name of [
		"json",
		"css",
		"png",
		".ase",
		"Download artwork + palette card",
	]) {
		const download = page.waitForEvent("download");
		await dialog.getByRole("button", { name, exact: true }).click();
		await download;
	}
	await fits(page, "save drawer with share failure/retry and downloads");
	await page.keyboard.press("Escape");
	await closed(page);
	dialog = await openTool(page, "History");
	await dialog.locator(".history-item").first().click();
	await closed(page);
	await fits(page, "restored history");
	await page.getByRole("button", { name: "Read full artwork details" }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	await closed(page);
	await fits(page, "resize desktop to mobile");
	for (const [width, height] of [
		[390, 844],
		[320, 568],
	]) {
		await page.setViewportSize({ width, height });
		await fits(page, `mobile ${width}x${height}`);
		dialog = await openTool(page, "Save");
		await alignedSaveActions(page);
		await dialog.getByRole("button", { name: "share", exact: true }).waitFor();
		await fits(page, `mobile save sheet ${width}x${height}`);
		await page.keyboard.press("Escape");
		await closed(page);
	}
	await page.setViewportSize({ width: 1280, height: 390 });
	await fits(page, "short desktop accessibility fallback", true);
	await page.setViewportSize({ width: 1440, height: 900 });
	state.imageFails = true;
	await page
		.locator("main")
		.getByRole("combobox", { name: "Extraction mode" })
		.selectOption("dominant");
	await page
		.getByRole("button", { name: "Retry palette", exact: true })
		.waitFor();
	await fits(page, "image failure");
	state.imageFails = false;
	await page
		.getByRole("button", { name: "Retry palette", exact: true })
		.click();
	await paletteReady(page, 8);
	if (output)
		await page.screenshot({ path: resolve(output, `${engine}-desktop.png`) });
	await context.close();

	const matching = await session();
	matching.state.lockHex = (
		await matching.page
			.locator("main .desktop-color")
			.first()
			.getAttribute("aria-label")
	).match(/#[a-f0-9]{6}/i)[0];
	await matching.page.locator("main .desktop-lock").first().click();
	await matching.page
		.getByRole("button", { name: "Random matching art", exact: true })
		.click();
	await matching.page
		.getByRole("img", { name: "Artwork layout fixture 202", exact: true })
		.waitFor();
	await paletteReady(matching.page, 5);
	await matching.page
		.getByRole("button", { name: "Random matching art", exact: true })
		.click();
	await matching.page.getByText(/No other close match/).waitFor();
	await fits(matching.page, "matching success and complete no-match");
	await matching.context.close();
	const cancelling = await session();
	let releaseIndex;
	cancelling.state.waitForIndex = new Promise((resolve) => {
		releaseIndex = resolve;
	});
	await cancelling.page.locator("main .desktop-lock").first().click();
	await cancelling.page
		.getByRole("button", { name: "Random matching art", exact: true })
		.click();
	await cancelling.page
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	releaseIndex();
	await paletteReady(cancelling.page, 5);
	await fits(cancelling.page, "cancelled matching");
	assert.equal(
		await cancelling.page
			.getByRole("img", { name: "Artwork layout fixture 101", exact: true })
			.isVisible(),
		true,
	);
	await cancelling.context.close();

	const animated = await session({ width: 1280, height: 600 }, "no-preference");
	animated.state.current = {
		...artwork(),
		title:
			"A deliberately long artwork title with many descriptive details ".repeat(
				20,
			),
		artist_title: "An artist with a very long display name ".repeat(12),
	};
	await animated.page
		.getByRole("button", { name: "Random artwork", exact: true })
		.click();
	await paletteReady(animated.page, 5);
	await fits(animated.page, "long artwork metadata");
	await openTool(animated.page, "Search");
	await animated.page.mouse.click(20, 300);
	await closed(animated.page);
	assert.equal(
		await animated.page.evaluate(() =>
			document.activeElement?.textContent?.trim(),
		),
		"Search",
		"Animated close should restore focus",
	);
	await openTool(animated.page, "Palette");
	await animated.page
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await closed(animated.page);
	await animated.page.setViewportSize({ width: 390, height: 844 });
	await openTool(animated.page, "Search");
	await animated.page.setViewportSize({ width: 1280, height: 600 });
	await closed(animated.page);
	await fits(
		animated.page,
		"resize mobile sheet to desktop with animation enabled",
	);
	await animated.context.close();
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{ engine, checks: results.length, pageErrors: errors, results },
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
