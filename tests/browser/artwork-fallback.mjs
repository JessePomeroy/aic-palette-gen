// All external responses are fixtures. This exercises the real workbench and index reader.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { shardFixture } from "../helpers/shard-fixture.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await playwright[engine].launch({ headless: true });
const hexes = ["#b88356", "#456678", "#68714d", "#c6b4a0", "#8d4652"];
const art = (id) => ({
	id,
	title: `Fallback fixture ${id}`,
	artist_title: "Fixture artist",
	artist_display: "Synthetic artwork",
	image_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
	is_public_domain: true,
	date_display: "2026",
	medium_display: "Test image",
	thumbnail: { width: 900, height: 600, alt_text: `Fallback fixture ${id}` },
});
const sample = Array.from(
	{ length: 200 * 133 },
	(_, i) => hexes[Math.floor((i % 200) / 40)],
);
const fixture = await shardFixture(
	[sample, sample],
	[art(101), art(202)],
	[
		{ width: 200, height: 133 },
		{ width: 200, height: 133 },
	],
);
const results = [],
	failures = [];

async function session(viewport) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
		acceptDownloads: true,
	});
	const page = await context.newPage();
	// WebKit's network driver does not expose Blob POST bodies. Observe the actual
	// browser upload instead, before forwarding it to our fail-closed route fixture.
	await context.addInitScript(() => {
		const originalFetch = window.fetch;
		window.fetch = async (input, init) => {
			if (
				String(input).includes("/api/ai-palette") &&
				init?.body instanceof Blob
			) {
				const bitmap = await createImageBitmap(init.body);
				window.fixtureToneUpload = {
					prefix: [
						...new Uint8Array(await init.body.arrayBuffer()).slice(0, 3),
					],
					width: bitmap.width,
					height: bitmap.height,
					type: init.body.type,
				};
				bitmap.close();
			}
			return originalFetch(input, init);
		};
	});
	page.setDefaultTimeout(12000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const jpeg = Buffer.from(
		await page.evaluate((colors) => {
			const canvas = document.createElement("canvas");
			canvas.width = 900;
			canvas.height = 600;
			const ctx = canvas.getContext("2d");
			colors.forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(i * 180, 0, 180, 600);
			});
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}, hexes),
		"base64",
	);
	const state = {
		mode: "outage",
		current: art(101),
		indexRequests: 0,
		gate: null,
		imageGate: null,
		indexFails: false,
		toneCalls: 0,
	};
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: {
					data: url.pathname.endsWith("/search")
						? [art(202), art(303)]
						: [state.current],
					pagination: { total: 1, total_pages: 1, current_page: 1, limit: 1 },
				},
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image") {
			if (state.imageGate && url.href.includes("000000000101"))
				await state.imageGate;
			const nativeImage = route.request().resourceType() === "image";
			return route.fulfill(
				state.mode === "normal" ||
					(state.mode === "proxy" && url.pathname === "/api/image") ||
					(state.mode === "display-only" && nativeImage)
					? { contentType: "image/jpeg", body: jpeg }
					: state.mode === "corrupt-image"
						? { contentType: "image/jpeg", body: "Not actually an image" }
						: { status: 403, body: "Museum image delivery unavailable" },
			);
		}
		if (url.pathname === "/api/ai-palette") {
			state.toneCalls++;
			const upload = await page.evaluate(() => window.fixtureToneUpload);
			assert.deepEqual(
				upload.prefix,
				[255, 216, 255],
				"Fallback Tone uploads are real JPEGs, never the filtered display",
			);
			assert.equal(upload.width, 200);
			assert.equal(upload.height, 133);
			assert.equal(upload.type, "image/jpeg");
			const count = Number(url.searchParams.get("count"));
			return route.fulfill({
				json: {
					description: "Fixture tone",
					colors: Array.from({ length: count }, (_, i) => ({
						hex: hexes[i % hexes.length],
						rgb: { r: 100, g: 100, b: 100 },
						hsl: { h: 0, s: 20, l: 40 },
					})),
				},
			});
		}
		if (
			url.pathname.startsWith("/color-index/") ||
			url.hostname === "index.test"
		) {
			state.indexRequests++;
			if (state.indexFails)
				return route.fulfill({ status: 503, body: "Index unavailable" });
			if (state.gate) await state.gate;
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
		if (
			url.origin !== new URL(base).origin ||
			url.pathname.startsWith("/api/") ||
			url.pathname.startsWith("/palette/")
		)
			return route.abort();
		return route.continue();
	});
	return { context, page, state, errors };
}

const ready = (page) =>
	page.waitForFunction(
		() =>
			document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
				.length >= 5 && !document.querySelector("main select").disabled,
	);
const open = async (page, name) => {
	await page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name, exact: true })
		.click();
	await page
		.getByRole("dialog")
		.waitFor()
		.catch((error) => {
			throw new Error(`${name} panel: ${error.message}`);
		});
};
const close = async (page) => {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await page.waitForFunction(() => !document.querySelector("dialog").open);
};
async function check(name, action, viewport = { width: 1440, height: 900 }) {
	const s = await session(viewport);
	try {
		await action(s);
		assert.deepEqual(s.errors, []);
		results.push(name);
	} catch (error) {
		failures.push({ name, error: error.message });
	} finally {
		await s.context.close();
	}
}

async function fallbackCards(page, width) {
	await open(page, width < 1024 ? "Save" : "Save & share");
	await page.locator(".classic-card-preview img").waitFor();
	const labelPixels = await page
		.locator(".classic-card-preview img")
		.evaluate(async (image) => {
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = 700;
			canvas.height = 20;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 64, 972, 700, 20, 0, 0, 700, 20);
			const pixels = ctx.getImageData(0, 0, 700, 20).data;
			return Array.from(
				{ length: pixels.length / 4 },
				(_, i) => pixels[i * 4] < 100,
			).filter(Boolean).length;
		});
	assert.ok(
		labelPixels > 100,
		"The Classic PNG itself identifies the low-resolution preview",
	);
	let downloading = page.waitForEvent("download");
	await page
		.getByRole("button", {
			name: "Download artwork + palette card",
			exact: true,
		})
		.click();
	assert.equal(await (await downloading).failure(), null);
	await page.getByRole("radio", { name: "Card", exact: true }).check();
	await page.locator(".artwork-card-preview-note").waitFor();
	await page.locator(".artwork-card-image").evaluate((image) => image.decode());
	downloading = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download card", exact: true })
		.click();
	assert.equal(await (await downloading).failure(), null);
	if (output)
		await page
			.locator(".artwork-card")
			.screenshot({ path: `${output}/${engine}-preview-card-${width}.png` });
	await close(page);
}

try {
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1440, height: 900 },
	]) {
		const s = await session(viewport);
		try {
			await s.page.goto(base);
			await s.page.waitForFunction(
				() =>
					document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
						.length === 5 ||
					document.body.textContent.includes("Could not generate this palette"),
			);
			assert.equal(
				await s.page
					.locator("main .desktop-swatch, main .mobile-swatch")
					.count(),
				5,
				"Museum failure with an indexed sample must still generate five colors",
			);
			await s.page
				.locator("main")
				.getByText("Museum image unavailable", { exact: false })
				.waitFor();
			await s.page.locator("main img").evaluate((image) => image.decode());
			assert.equal(
				await s.page
					.locator("main img")
					.evaluate((image) => image.complete && image.naturalWidth > 0),
				true,
			);
			if (output)
				await s.page.screenshot({
					path: `${output}/${engine}-fallback-${viewport.width}.png`,
				});
			await fallbackCards(s.page, viewport.width);
			assert.equal(
				s.state.toneCalls,
				0,
				"Preview/extraction/export must not call Tone",
			);
			await s.page
				.locator("main")
				.getByRole("combobox", { name: "Extraction mode" })
				.selectOption("ai");
			await ready(s.page);
			assert.equal(s.state.toneCalls, 1);
			// Retrying display restores the sharp image without changing the chosen palette.
			const paletteBefore = await s.page
				.locator("main .desktop-color, main .mobile-hex")
				.allTextContents();
			s.state.mode = "normal";
			await s.page
				.locator("main")
				.getByRole("button", { name: /Retry museum image/ })
				.click();
			await s.page.waitForFunction(
				() => document.querySelector("main img")?.naturalWidth === 900,
			);
			assert.equal(
				await s.page.locator("main .artwork-media-notice").count(),
				0,
			);
			assert.deepEqual(
				await s.page
					.locator("main .desktop-color, main .mobile-hex")
					.allTextContents(),
				paletteBefore,
			);
			assert.deepEqual(s.errors, []);
			results.push({ viewport, status: "preview" });
		} catch (error) {
			failures.push({ viewport, error: error.message });
		} finally {
			await s.context.close();
		}
	}
	for (const mode of ["normal", "proxy", "display-only", "corrupt-image"])
		await check(mode, async (s) => {
			s.state.mode = mode;
			if (mode === "normal") s.state.current.thumbnail.alt_text = "";
			await s.page.goto(base);
			await ready(s.page);
			assert.equal(
				await s.page.locator("main img").getAttribute("alt"),
				s.state.current.thumbnail.alt_text || s.state.current.title,
			);
			if (mode === "corrupt-image")
				await s.page.locator("main .artwork-media-notice").waitFor();
			else {
				await s.page.waitForFunction(
					() => document.querySelector("main img")?.naturalWidth === 900,
				);
				assert.equal(
					await s.page.locator("main .artwork-media-notice").count(),
					0,
				);
				if (mode !== "display-only")
					assert.equal(
						s.state.indexRequests,
						0,
						"Healthy image paths do not download the index",
					);
			}
		});
	for (const mode of [
		"unindexed",
		"changed-image",
		"non-public-domain",
		"index-unavailable",
	])
		await check(mode, async (s) => {
			if (mode === "unindexed") s.state.current = art(303);
			if (mode === "changed-image")
				s.state.current = { ...art(101), image_id: art(303).image_id };
			if (mode === "non-public-domain")
				s.state.current = { ...art(101), is_public_domain: false };
			if (mode === "index-unavailable") s.state.indexFails = true;
			await s.page.goto(base);
			await s.page.locator("main .artwork-media-error").waitFor();
			await s.page
				.getByText("Could not generate this palette. Please try again.", {
					exact: true,
				})
				.waitFor();
			assert.equal(
				await s.page.locator("main .artwork-media-notice").count(),
				0,
			);
			assert.equal(await s.page.locator("main img").count(), 0);
			if (mode === "non-public-domain")
				assert.equal(
					s.state.indexRequests,
					0,
					"A current non-public-domain flag prevents saved-preview lookup",
				);
			s.state.mode = "normal";
			await s.page
				.getByRole("button", { name: "Retry image", exact: true })
				.click();
			await s.page.waitForFunction(
				() => document.querySelector("main img")?.naturalWidth === 900,
			);
		});
	await check("late artwork A cannot replace preview B", async (s) => {
		let release;
		s.state.imageGate = new Promise((resolve) => {
			release = resolve;
		});
		await s.page.goto(base);
		await s.page.waitForFunction(
			() =>
				document.querySelector(".desktop-title")?.textContent ===
				"Fallback fixture 101",
		);
		await open(s.page, "Search");
		await s.page
			.getByRole("dialog")
			.getByRole("button", { name: "search", exact: true })
			.click();
		await s.page.getByRole("button", { name: /Fallback fixture 202/ }).click();
		await ready(s.page);
		await s.page.locator("main .artwork-media-notice").waitFor();
		release();
		await s.page.waitForLoadState("networkidle");
		assert.equal(
			await s.page.locator("main img").getAttribute("alt"),
			art(202).thumbnail.alt_text,
		);
		assert.equal(await s.page.locator("main .artwork-media-notice").count(), 1);
		await open(s.page, "History");
		await s.page
			.locator(".history-item .artwork-media-preview-mark")
			.first()
			.waitFor();
		await close(s.page);
	});
	await check(
		"duplicate native errors share the pending recovery",
		async (s) => {
			let release;
			s.state.gate = new Promise((resolve) => {
				release = resolve;
			});
			await s.page.goto(base);
			await s.page.waitForFunction(
				() =>
					document
						.querySelector("main .artwork-media")
						?.getAttribute("aria-busy") === "true",
			);
			await s.page.locator("main img").dispatchEvent("error");
			release();
			await ready(s.page);
			await s.page.locator("main .artwork-media-notice").waitFor();
			assert.equal(
				await s.page.locator("main .artwork-media-error").count(),
				0,
			);
		},
	);
	await check(
		"shared palette preview, recovery and saved colors",
		async (s) => {
			await s.page.goto(base);
			await ready(s.page);
			await s.page.evaluate(async (artwork) => {
				const { mount } = await import(
					"/node_modules/svelte/src/index-client.js"
				);
				const { default: Shared } = await import(
					"/src/routes/palette/[id]/+page.svelte"
				);
				const target = document.createElement("div");
				target.id = "shared-fallback-fixture";
				document.body.append(target);
				mount(Shared, {
					target,
					props: {
						data: {
							artwork,
							palette: {
								id: "11111111-1111-4111-8111-111111111111",
								mode: "dominant",
								count: 5,
								colors: Array.from({ length: 5 }, () => ({
									hex: "#123456",
									rgb: { r: 18, g: 52, b: 86 },
									hsl: { h: 210, s: 65, l: 20 },
								})),
							},
						},
					},
				});
			}, art(101));
			const shared = s.page.locator("#shared-fallback-fixture");
			await shared
				.locator(".artwork-media-notice")
				.waitFor()
				.catch(async (error) => {
					throw new Error(
						`${error.message}; shared image state: ${await shared.locator(".artwork-media").innerText()}`,
					);
				});
			await shared.locator("img").evaluate((image) => image.decode());
			assert.equal(await shared.locator("button[title^='copy']").count(), 5);
			s.state.mode = "normal";
			await shared.getByRole("button", { name: /Retry museum image/ }).click();
			await s.page.waitForFunction(
				() =>
					document.querySelector("#shared-fallback-fixture img")
						?.naturalWidth === 900,
			);
			assert.equal(await shared.locator(".artwork-media-notice").count(), 0);
			assert.equal(await shared.locator("button[title^='copy']").count(), 5);
		},
	);
	await check(
		"presentation never changes source pixels or palette extraction",
		async (s) => {
			await s.page.goto(base);
			await ready(s.page);
			const result = await s.page.evaluate(async (artwork) => {
				const { loadArtworkImage, decodeImage } = await import(
					"/src/lib/images/artwork-image.ts"
				);
				const { presentArtworkImage } = await import(
					"/src/lib/images/preview-treatment.ts"
				);
				const { extractColors } = await import("/src/lib/colors/extraction.ts");
				const source = await loadArtworkImage(artwork);
				const before = [...new Uint8Array(await source.blob.arrayBuffer())];
				const originalRandom = Math.random;
				const palette = async () => {
					let seed = 17;
					Math.random = () => {
						seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
						return seed / 4294967296;
					};
					return (await extractColors(artwork, "dominant", 5)).map(
						(color) => color.hex,
					);
				};
				try {
					const colorsBefore = await palette();
					const presented = await presentArtworkImage(source);
					const rawImage = await decodeImage(source.blob),
						displayImage = await decodeImage(presented);
					return {
						before,
						after: [...new Uint8Array(await source.blob.arrayBuffer())],
						colorsBefore,
						colorsAfter: await palette(),
						rawWidth: rawImage.naturalWidth,
						displayWidth: displayImage.naturalWidth,
					};
				} finally {
					Math.random = originalRandom;
				}
			}, art(101));
			assert.deepEqual(result.before, result.after);
			assert.deepEqual(result.colorsBefore, result.colorsAfter);
			assert.equal(result.rawWidth, 200);
			assert.equal(result.displayWidth, 843);
		},
	);
	await check(
		"small phone notice and controls remain visible",
		async (s) => {
			await s.page.goto(base);
			await ready(s.page);
			await s.page.locator("main .artwork-media-notice").waitFor();
			const geometry = await s.page.evaluate(() => {
				const notice = document
					.querySelector("main .artwork-media-notice")
					.getBoundingClientRect();
				const caption = document
					.querySelector(".mobile-caption")
					.getBoundingClientRect();
				return {
					overflow: document.documentElement.scrollWidth > innerWidth,
					left: notice.left,
					right: notice.right,
					bottom: notice.bottom,
					captionTop: caption.top,
					viewport: innerWidth,
				};
			});
			assert.equal(geometry.overflow, false);
			assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport);
			assert.ok(geometry.bottom <= geometry.captionTop);
		},
		{ width: 320, height: 568 },
	);
	console.log(
		JSON.stringify(
			{
				engine,
				passed: results.length,
				failed: failures.length,
				results,
				failures,
			},
			null,
			2,
		),
	);
	if (failures.length) process.exitCode = 1;
} finally {
	await browser.close();
}
