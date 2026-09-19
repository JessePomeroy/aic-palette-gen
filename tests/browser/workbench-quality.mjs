// Exercises real Svelte components with synthetic data; never contacts a database.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { contrastRatio } from "../../src/lib/colors/workbench.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await playwright[engine].launch({ headless: true });
const results = [];
const failures = [];
const artwork = {
	id: 101,
	title: "Dark palette regression fixture",
	artist_title: "Fixture",
	artist_display: "Fixture",
	image_id: "00000000-0000-0000-0000-000000000101",
	thumbnail: { width: 900, height: 600, alt_text: "Dark fixture" },
};

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function session(viewport = { width: 1440, height: 900 }) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const image = Buffer.from(
		await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 900;
			canvas.height = 600;
			const ctx = canvas.getContext("2d");
			["#442018", "#30282d", "#242020", "#333027", "#5a3530"].forEach(
				(color, i) => {
					ctx.fillStyle = color;
					ctx.fillRect(i * 180, 0, 180, 600);
				},
			);
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}),
		"base64",
	);
	const state = { saveGate: null, imageGate: null, saves: [], artwork, image };
	await page.addInitScript(() => {
		window.fixtureClipboard = { denied: false, copies: [] };
		Object.defineProperty(navigator, "share", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text) => {
					if (window.fixtureClipboard.denied)
						throw new DOMException(
							"Clipboard fixture denied",
							"NotAllowedError",
						);
					window.fixtureClipboard.copies.push(text);
				},
			},
		});
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: { pagination: { total: 1 }, data: [state.artwork] },
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image") {
			if (state.imageGate) await state.imageGate.promise;
			return route.fulfill({
				contentType: "image/jpeg",
				body: url.href.includes(state.artwork.image_id) ? state.image : image,
			});
		}
		if (url.pathname === "/api/palette") {
			state.saves.push(route.request().postDataJSON());
			const id = `11111111-1111-4111-8111-${String(state.saves.length).padStart(12, "0")}`;
			if (state.saveGate) await state.saveGate.promise;
			return route.fulfill({
				status: 201,
				json: { id, url: `${base}/palette/${id}` },
			});
		}
		// Unexpected APIs fail closed, including tone and real saved-palette loads.
		if (
			url.pathname.startsWith("/api/") ||
			url.pathname.startsWith("/palette/")
		)
			return route.abort();
		if (url.origin !== new URL(base).origin) return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await ready(page);
	return { page, context, state, errors };
}

async function ready(page) {
	await page.waitForFunction(
		() =>
			document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
				.length >= 5 && !document.querySelector("main select")?.disabled,
	);
}
async function open(page, name) {
	await page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name, exact: true })
		.click();
	await page.getByRole("dialog").waitFor();
}
async function close(page) {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await page.waitForFunction(() => !document.querySelector("dialog").open);
}
async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);
}
async function save(page) {
	await open(page, "Save & share");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "share", exact: true })
		.click();
}
async function mutate(page, action) {
	if (action === "count")
		await page
			.locator("main")
			.getByRole("combobox", { name: "Number of colors" })
			.selectOption("8");
	if (action === "mode")
		await page
			.locator("main")
			.getByRole("combobox", { name: "Extraction mode" })
			.selectOption("vibrant");
	if (action === "regenerate")
		await page
			.locator("main")
			.getByRole("button", { name: "Regenerate unlocked" })
			.click();
	if (action === "variant") {
		await open(page, "Palette tools");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Use vibrant", exact: true })
			.click();
		await close(page);
	}
}
async function check(name, run, viewport) {
	const fixture = await session(viewport);
	try {
		await run(fixture);
		assert.deepEqual(fixture.errors, []);
		results.push(name);
	} catch (error) {
		failures.push({ name, error: error.message });
	} finally {
		fixture.state.saveGate?.resolve();
		fixture.state.imageGate?.resolve();
		await fixture.context.close();
	}
}

async function renderedColors(locator) {
	return locator.evaluate((node) => {
		const style = getComputedStyle(node);
		const hex = (rgb) =>
			"#" +
			rgb
				.match(/\d+/g)
				.slice(0, 3)
				.map((value) => Number(value).toString(16).padStart(2, "0"))
				.join("");
		return {
			text: hex(style.color),
			background: hex(style.backgroundColor),
			border: hex(style.borderTopColor),
		};
	});
}

async function checkTheme(page, mobile) {
	const random = await renderedColors(
		page.locator(".desktop-random, .mobile-random"),
	);
	await open(page, "Search");
	const search = await renderedColors(
		page
			.getByRole("dialog")
			.getByRole("button", { name: "search", exact: true }),
	);
	assert.equal(
		random.background,
		search.background,
		"Main and drawer actions must share the artwork accent",
	);
	assert.ok(
		contrastRatio(random.text, random.background) >= 4.5,
		"Random text must remain readable",
	);
	const input = page.getByRole("textbox", { name: "Search artworks" });
	await input.focus();
	const focus = await renderedColors(input);
	assert.ok(
		contrastRatio(focus.border, focus.background) >= 3,
		"The accent focus ring must remain visible",
	);
	await close(page);
	await page.locator("main .desktop-lock, main .mobile-lock").first().click();
	if (!mobile) {
		const locked = await renderedColors(
			page.locator(".desktop-lock.locked").first(),
		);
		assert.equal(locked.background, search.background);
		assert.ok(contrastRatio(locked.text, locked.background) >= 4.5);
	}
	await open(page, "Palette tools");
	await ready(page);
	const editorLock = await renderedColors(
		page.getByRole("dialog").locator(".lock-button.locked").first(),
	);
	assert.equal(
		editorLock.background,
		search.background,
		"A modal must inherit the same artwork theme",
	);
	assert.ok(contrastRatio(editorLock.text, editorLock.background) >= 4.5);
	await close(page);
	await page.locator("main .desktop-lock, main .mobile-lock").first().click();
	await open(page, mobile ? "Save" : "Save & share");
	const share = await renderedColors(
		page
			.getByRole("dialog")
			.getByRole("button", { name: "share", exact: true }),
	);
	assert.equal(share.background, search.background);
	const download = page
		.getByRole("dialog")
		.getByRole("button", { name: "json", exact: true });
	await download.hover();
	assert.equal(
		(await renderedColors(download)).border,
		focus.border,
		"Export hover borders must use the visible theme accent",
	);
	await close(page);
	assert.equal(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--accent")
				.trim(),
		),
		"#b8a080",
		"Artwork themes must not mutate the global page theme",
	);
	return random;
}

try {
	for (const mobile of [false, true]) {
		await check(
			`artwork theme follows selection and history on ${mobile ? "mobile" : "desktop"}`,
			async ({ page, state }) => {
				const original = await checkTheme(page, mobile);
				if (output)
					await page.screenshot({
						path: resolve(
							output,
							`${engine}-theme-${mobile ? "mobile" : "desktop"}-dark.png`,
						),
					});
				state.artwork = {
					...artwork,
					id: 202,
					title: "Blue palette fixture",
					image_id: "00000000-0000-0000-0000-000000000202",
					thumbnail: { ...artwork.thumbnail, alt_text: "Blue fixture" },
				};
				state.image = Buffer.from(
					await page.evaluate(() => {
						const canvas = document.createElement("canvas");
						canvas.width = 900;
						canvas.height = 600;
						const ctx = canvas.getContext("2d");
						["#abcfe9", "#c1e5d9", "#c6cdf0", "#dae6f0", "#aadcec"].forEach(
							(color, i) => {
								ctx.fillStyle = color;
								ctx.fillRect(i * 180, 0, 180, 600);
							},
						);
						return canvas.toDataURL("image/jpeg").split(",")[1];
					}),
					"base64",
				);
				await page.locator(".desktop-random, .mobile-random").click();
				await page
					.getByRole("img", { name: "Blue fixture", exact: true })
					.waitFor();
				await ready(page);
				const changed = await checkTheme(page, mobile);
				if (output)
					await page.screenshot({
						path: resolve(
							output,
							`${engine}-theme-${mobile ? "mobile" : "desktop"}-light.png`,
						),
					});
				assert.notEqual(
					changed.background,
					original.background,
					"The artwork change must update all themed controls",
				);
				assert.equal(original.text, "#ffffff");
				assert.equal(changed.text, "#000000");
				await open(page, "History");
				await page
					.getByRole("dialog")
					.locator(".history-item")
					.filter({ hasText: artwork.title })
					.first()
					.click();
				await page.waitForFunction(
					() => !document.querySelector("dialog").open,
				);
				assert.deepEqual(
					await renderedColors(page.locator(".desktop-random, .mobile-random")),
					original,
					"Restoring history must restore its accent",
				);
			},
			mobile ? { width: 390, height: 844 } : undefined,
		);
	}
	for (const action of ["count", "mode", "regenerate", "variant"]) {
		for (const pending of [false, true]) {
			await check(
				`${pending ? "pending" : "completed"} save invalidated by ${action}`,
				async ({ page, state }) => {
					if (action === "variant") {
						await open(page, "Palette tools");
						await page
							.getByRole("button", { name: "Use vibrant", exact: true })
							.waitFor();
						await ready(page);
						await close(page);
					}
					if (pending) state.saveGate = deferred();
					const requested = page.waitForRequest(
						(req) => new URL(req.url()).pathname === "/api/palette",
					);
					await save(page);
					await requested;
					if (!pending)
						await page
							.getByRole("link", { name: "Open saved palette" })
							.waitFor();
					await close(page);
					// Resolve the obsolete save while extraction is still in flight, not just after it finishes.
					if (pending && action !== "variant") state.imageGate = deferred();
					await mutate(page, action);
					if (pending) {
						const response = page.waitForResponse(
							(res) => new URL(res.url()).pathname === "/api/palette",
						);
						state.saveGate.resolve();
						state.saveGate = null;
						await response;
						await settle(page);
						assert.equal(
							await page.evaluate(() => window.fixtureClipboard.copies.length),
							0,
							"Obsolete saves must not copy a URL",
						);
						state.imageGate?.resolve();
						state.imageGate = null;
					}
					await ready(page);
					await open(page, "Save & share");
					assert.equal(
						await page
							.getByRole("link", { name: "Open saved palette" })
							.count(),
						0,
						"Previous palette link must be cleared",
					);
					assert.equal(
						await page
							.getByRole("dialog")
							.getByRole("button", { name: "share", exact: true })
							.isEnabled(),
						true,
					);
					await page
						.getByRole("dialog")
						.getByRole("button", { name: "share", exact: true })
						.click();
					await page
						.getByRole("link", { name: "Open saved palette" })
						.waitFor();
					const current = state.saves.at(-1);
					assert.equal(current.count, action === "count" ? 8 : 5);
					assert.equal(
						current.mode,
						["mode", "variant"].includes(action) ? "vibrant" : "dominant",
					);
					const displayed = await page
						.locator("main .desktop-color")
						.evaluateAll((buttons) =>
							buttons.map((button) =>
								button.getAttribute("aria-label").slice(5),
							),
						);
					assert.deepEqual(
						current.colors.map((color) => color.hex),
						displayed,
					);
				},
			);
		}
	}
	await check("accent button contrast", async ({ page }) => {
		for (const [panel, label] of [
			["Search", "search"],
			["Save & share", "share"],
		]) {
			await open(page, panel);
			const button = page
				.getByRole("dialog")
				.getByRole("button", { name: label, exact: true });
			for (const hovered of [false, true]) {
				if (hovered) await button.hover();
				const colors = await button.evaluate((node) => {
					const style = getComputedStyle(node);
					const brightness = Number(
						style.filter.match(/brightness\(([\d.]+)\)/)?.[1] || 1,
					);
					const hex = (rgb) =>
						"#" +
						rgb
							.match(/\d+/g)
							.slice(0, 3)
							.map((v) =>
								Math.min(255, Math.round(Number(v) * brightness))
									.toString(16)
									.padStart(2, "0"),
							)
							.join("");
					return [hex(style.color), hex(style.backgroundColor)];
				});
				assert.ok(
					contrastRatio(...colors) >= 4.5,
					`${label}: ${colors.join(" on ")}`,
				);
			}
			await close(page);
		}
	});
	await check("workbench clipboard denial and retry", async ({ page }) => {
		await page.evaluate(() => {
			window.fixtureClipboard.denied = true;
		});
		await page.locator("main .desktop-color").first().click();
		await page
			.locator("main")
			.getByRole("status")
			.filter({ hasText: "Clipboard unavailable" })
			.waitFor();
		assert.equal(
			await page
				.locator("main .desktop-color")
				.first()
				.evaluate((button) => button.classList.contains("copied")),
			false,
		);
		await open(page, "Palette tools");
		await ready(page);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /^Copy #/ })
			.first()
			.click();
		await page
			.getByRole("dialog")
			.getByRole("status")
			.filter({ hasText: "Clipboard unavailable" })
			.waitFor();
		await page.evaluate(() => {
			window.fixtureClipboard.denied = false;
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /^Copy #/ })
			.first()
			.click();
		await page.waitForFunction(
			() => window.fixtureClipboard.copies.length === 1,
		);
		assert.equal(
			await page
				.getByRole("dialog")
				.getByText(/Clipboard unavailable/)
				.count(),
			0,
		);
	});
	await check("shared palette clipboard denial and retry", async ({ page }) => {
		// Mount the real route component with data props; its server loader must not contact Neon.
		await page.evaluate(async (artwork) => {
			const { mount } = await import(
				"/node_modules/svelte/src/index-client.js"
			);
			const { default: Shared } = await import(
				"/src/routes/palette/[id]/+page.svelte"
			);
			const target = document.createElement("div");
			target.id = "shared-fixture";
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
			window.fixtureClipboard.denied = true;
		}, artwork);
		const shared = page.locator("#shared-fixture");
		const swatch = shared.locator("button[title^='copy']").first();
		await swatch.click();
		await shared
			.getByRole("status")
			.filter({ hasText: "Clipboard unavailable" })
			.waitFor();
		assert.equal((await swatch.innerText()).trim(), "#123456");
		await page.evaluate(() => {
			window.fixtureClipboard.denied = false;
		});
		await swatch.click();
		await page.waitForFunction(
			() => window.fixtureClipboard.copies.length === 1,
		);
		assert.equal((await swatch.innerText()).trim(), "copied");
		assert.equal(await shared.getByText(/Clipboard unavailable/).count(), 0);
	});
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
	assert.deepEqual(failures, []);
} finally {
	await browser.close();
}
