// Real CSS preview and downloaded PNG checks, with no museum/database requests.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await playwright[engine].launch();
const errors = [];
const results = [];
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
		acceptDownloads: true,
	});
	page.setDefaultTimeout(15000);
	page.on("pageerror", (error) => errors.push(error.message));
	const images = await page.evaluate(() =>
		[false, true].map((portrait) => {
			const canvas = document.createElement("canvas");
			canvas.width = portrait ? 600 : 900;
			canvas.height = portrait ? 900 : 600;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#859aaa";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			["#ff0000", "#00ff00", "#0000ff", "#ff00ff"].forEach((color, index) => {
				ctx.fillStyle = color;
				ctx.fillRect(
					(index % 2) * canvas.width * 0.75,
					Math.floor(index / 2) * canvas.height * 0.75,
					canvas.width * 0.25,
					canvas.height * 0.25,
				);
			});
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}),
	);
	const artwork = {
		id: 101,
		title: "The Bedroom",
		artist_title: "Vincent van Gogh",
		artist_display: "Vincent van Gogh",
		date_display: "1889",
		medium_display: "Oil on canvas",
		is_public_domain: true,
		image_id: "00000000-0000-0000-0000-000000000101",
		thumbnail: {
			width: 900,
			height: 600,
			alt_text: "Four-corner landscape fixture",
		},
	};
	const state = {
		artwork,
		portrait: false,
		imageFails: false,
		fontFails: false,
	};
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: { pagination: { total: 1 }, data: [state.artwork] },
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image")
			return route.fulfill(
				state.imageFails
					? { status: 503, body: "Fixture image unavailable" }
					: {
							contentType: "image/jpeg",
							body: Buffer.from(images[Number(state.portrait)], "base64"),
						},
			);
		if (state.fontFails && url.pathname.endsWith(".ttf"))
			return route.fulfill({ status: 503, body: "Fixture font unavailable" });
		if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
			return route.abort();
		return route.continue();
	});
	const ready = () =>
		page.waitForFunction(
			() =>
				document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
					.length >= 5 && !document.querySelector("main select")?.disabled,
		);
	const close = async () => {
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Close", exact: true })
			.click();
		await page.waitForFunction(() => !document.querySelector("dialog").open);
	};
	async function capture(label, count) {
		await page
			.getByRole("navigation", { name: "Workbench tools" })
			.getByRole("button", { name: /^(Save|Save & share)$/ })
			.click();
		await page.getByRole("radio", { name: "Card", exact: true }).check();
		await page
			.locator(".artwork-card-image")
			.evaluate((image) => image.decode());
		await page.evaluate(() => document.fonts.ready);
		assert.equal(await page.locator(".artwork-card-swatch").count(), count);
		const geometry = await page.locator(".artwork-card").evaluate((card) => {
			const bounds = card.getBoundingClientRect();
			const point = (x, y) => ({
				x: (x - bounds.x) / bounds.width,
				y: (y - bounds.y) / bounds.width,
			});
			const image = card.querySelector("img"),
				imageBox = image.getBoundingClientRect();
			const border = parseFloat(getComputedStyle(image).borderLeftWidth);
			const scale = Math.min(
				(imageBox.width - border * 2) / image.naturalWidth,
				(imageBox.height - border * 2) / image.naturalHeight,
			);
			const width = image.naturalWidth * scale,
				height = image.naturalHeight * scale;
			const x = imageBox.x + (imageBox.width - width) / 2,
				y = imageBox.y + (imageBox.height - height) / 2;
			const corners = [
				[0.12, 0.12],
				[0.88, 0.12],
				[0.12, 0.88],
				[0.88, 0.88],
			].map(([a, b]) => point(x + a * width, y + b * height));
			const swatches = [...card.querySelectorAll(".artwork-card-color")].map(
				(node) => {
					const rect = node.getBoundingClientRect();
					return {
						...point(rect.x + rect.width / 2, rect.y + rect.height / 2),
						rgb: getComputedStyle(node)
							.backgroundColor.match(/\d+/g)
							.slice(0, 3)
							.map(Number),
					};
				},
			);
			return {
				corners,
				swatches,
				artworkHeight: height,
				ratio: bounds.height / bounds.width,
				overflow:
					card.scrollWidth > card.clientWidth + 1 ||
					card.scrollHeight > card.clientHeight + 1,
				titleFont: getComputedStyle(card.querySelector("h3")).fontFamily,
				fontReady:
					document.fonts.check('400 40px "Chroma Allura"') &&
					document.fonts.check('500 20px "Chroma Dancing Script"'),
			};
		});
		assert.ok(!geometry.overflow, `${label}: card content must fit`);
		assert.ok(
			geometry.artworkHeight > 30,
			`${label}: artwork must remain visible`,
		);
		assert.ok(
			Math.abs(geometry.ratio - 1.4) < 0.01,
			`${label}: card proportions`,
		);
		assert.ok(
			geometry.fontReady && geometry.titleFont.includes("Chroma Allura"),
		);
		const downloading = page.waitForEvent("download");
		await page
			.getByRole("button", {
				name: "Download card",
				exact: true,
			})
			.click();
		const download = await downloading;
		assert.equal(
			download.suggestedFilename(),
			`chroma-${state.artwork.id}-card.png`,
		);
		const png = await readFile(await download.path());
		const rendered = await page.evaluate(
			async ({ png, geometry }) => {
				const image = new Image();
				image.src = `data:image/png;base64,${png}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(image, 0, 0);
				const pixel = (point) => [
					...ctx.getImageData(
						Math.round(point.x * canvas.width),
						Math.round(point.y * canvas.width),
						1,
						1,
					).data,
				];
				return {
					width: canvas.width,
					height: canvas.height,
					corners: geometry.corners.map(pixel),
					swatches: geometry.swatches.map(pixel),
				};
			},
			{ png: png.toString("base64"), geometry },
		);
		assert.equal(rendered.width, 1200);
		assert.equal(rendered.height, 1680);
		for (const [index, expected] of [
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[255, 0, 255],
		].entries()) {
			assert.equal(
				rendered.corners[index][3],
				255,
				`${label}: original artwork must be included`,
			);
			assert.ok(
				expected.every(
					(value, channel) =>
						Math.abs(value - rendered.corners[index][channel]) <= 5,
				),
				`${label}: preserve artwork corner ${index}: ${rendered.corners[index]}`,
			);
		}
		geometry.swatches.forEach((swatch, index) => {
			assert.deepEqual(
				rendered.swatches[index],
				[...swatch.rgb, 255],
				`${label}: exact palette color ${index}`,
			);
		});
		assert.equal(
			await page.locator(".artwork-card").count(),
			1,
			"Offscreen export must be cleaned up",
		);
		if (output) {
			await download.saveAs(resolve(output, `${engine}-${label}.png`));
			await page.locator(".artwork-card").screenshot({
				path: resolve(output, `${engine}-${label}-preview.png`),
			});
		}
		results.push(label);
		await close();
	}
	async function captureClassic(label, expectDefault = false) {
		await page
			.getByRole("navigation", { name: "Workbench tools" })
			.getByRole("button", { name: /^(Save|Save & share)$/ })
			.click();
		const classic = page.getByRole("radio", { name: /^Classic/ });
		if (expectDefault) assert.ok(await classic.isChecked());
		else await classic.check();
		assert.equal(await page.locator(".artwork-card").count(), 0);
		const colors = await page
			.locator("main .desktop-color, main .mobile-swatch")
			.evaluateAll((swatches) =>
				swatches.map((swatch) => getComputedStyle(swatch).backgroundColor),
			);
		state.fontFails = true;
		const downloading = page.waitForEvent("download");
		await page
			.getByRole("button", {
				name: "Download artwork + palette card",
				exact: true,
			})
			.click();
		const download = await downloading;
		assert.equal(await download.failure(), null);
		assert.equal(
			download.suggestedFilename(),
			`chroma-${state.artwork.id}-artwork-card.png`,
		);
		const png = await readFile(await download.path());
		const rendered = await page.evaluate(
			async ({ png, count }) => {
				const image = new Image();
				image.src = `data:image/png;base64,${png}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(image, 0, 0);
				return {
					width: canvas.width,
					height: canvas.height,
					swatches: Array.from({ length: count }, (_, index) =>
						[
							...ctx.getImageData(
								Math.round(64 + ((index + 0.5) * 1072) / count),
								1150,
								1,
								1,
							).data,
						].slice(0, 3),
					),
				};
			},
			{ png: png.toString("base64"), count: colors.length },
		);
		assert.equal(rendered.width, 1200);
		assert.equal(rendered.height, 1440);
		assert.deepEqual(
			rendered.swatches,
			colors.map((color) => color.match(/\d+/g).slice(0, 3).map(Number)),
		);
		assert.equal(await page.locator(".artwork-card").count(), 0);
		state.fontFails = false;
		if (output)
			await download.saveAs(resolve(output, `${engine}-${label}.png`));
		results.push(label);
		await close();
	}
	await page.goto(base);
	await ready();
	await captureClassic("classic-default-without-fonts", true);
	await capture("landscape-five", 5);
	state.portrait = true;
	state.artwork = {
		...artwork,
		id: 202,
		image_id: "00000000-0000-0000-0000-000000000202",
		title:
			"A portrait study with a long title, an artist’s handwritten notes, and the complete original composition preserved",
		date_display: "1901–1904",
		medium_display: "Ink, watercolor, and graphite on paper",
		thumbnail: {
			width: 600,
			height: 900,
			alt_text: "Four-corner portrait fixture",
		},
	};
	await page.locator(".desktop-random").click();
	await ready();
	await page
		.getByRole("combobox", { name: "Number of colors" })
		.selectOption("8");
	await ready();
	await capture("portrait-eight-long-title", 8);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.locator(".mobile-random").waitFor();
	await page
		.getByRole("combobox", { name: "Number of colors" })
		.selectOption("5");
	await ready();
	await capture("mobile-five", 5);
	await page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name: "Save", exact: true })
		.click();
	assert.ok(
		await page.getByRole("radio", { name: "Card", exact: true }).isChecked(),
		"Format choice survives closing and reopening Save",
	);
	for (const failure of ["fontFails", "imageFails"]) {
		state[failure] = true;
		await page
			.getByRole("button", {
				name: "Download card",
				exact: true,
			})
			.click();
		await page
			.getByText("Could not create the artwork card. Please try again.", {
				exact: true,
			})
			.waitFor();
		assert.equal(await page.locator(".artwork-card").count(), 1);
		state[failure] = false;
		results.push(failure);
	}
	await close();
	await capture("retry-after-errors", 5);
	await captureClassic("switch-back-to-classic-mobile");
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{ engine, passed: results.length, results, pageErrors: errors },
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
