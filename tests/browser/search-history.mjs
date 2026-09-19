// Real discovery UI with isolated browser storage and fixture-only network responses.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const key = "chroma-search-history-v1";
const browser = await playwright[engine].launch({ headless: true });
const results = [];
const errors = [];
const artwork = {
	id: 101,
	title: "Museum fixture",
	artist_id: 42,
	artist_title: "Claude Monet",
	artist_display: "Claude Monet",
	medium_display: "Oil on canvas",
	image_id: "history-fixture",
	is_public_domain: true,
	thumbnail: { width: 600, height: 400 },
};

async function session(width, storage = "normal") {
	const page = await browser.newPage({
		viewport: { width, height: 900 },
		reducedMotion: "reduce",
	});
	page.setDefaultTimeout(10000);
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(
		({ key, storage }) => {
			if (storage === "blocked") {
				for (const method of ["getItem", "setItem", "removeItem"]) {
					const original = Storage.prototype[method];
					Storage.prototype[method] = function (name, ...args) {
						if (name === key)
							throw new DOMException(
								"Storage fixture blocked",
								"SecurityError",
							);
						return original.call(this, name, ...args);
					};
				}
			} else if (storage === "corrupt")
				localStorage.setItem(key, '[null,{},42,{"search":{"q":5}}]');
		},
		{ key, storage },
	);
	const image = Buffer.from(
		await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 600;
			canvas.height = 400;
			const ctx = canvas.getContext("2d");
			["#c78a43", "#426a98", "#e8d6af", "#735642", "#889a87"].forEach(
				(color, i) => {
					ctx.fillStyle = color;
					ctx.fillRect(i * 120, 0, 120, 400);
				},
			);
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}),
		"base64",
	);
	const state = { calls: [], gate: null };
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu") {
			if (!url.pathname.endsWith("/search"))
				return route.fulfill({
					json: { data: [artwork], pagination: { total: 1 } },
				});
			const params = JSON.parse(url.searchParams.get("params"));
			const q =
				params.query.bool.must.find((clause) => clause.multi_match)?.multi_match
					.query || "related";
			state.calls.push(params);
			if (q === "slow") await state.gate;
			if (q === "network failure")
				return route.fulfill({ status: 503, json: {} });
			return route.fulfill({
				json: {
					pagination: { total: q === "nothing" ? 0 : 36 },
					data:
						q === "nothing"
							? []
							: [
									{
										...artwork,
										id: 200 + params.page,
										title: `Result for ${q} · page ${params.page}`,
									},
								],
				},
			});
		}
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image")
			return route.fulfill({ contentType: "image/jpeg", body: image });
		if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
			return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await ready(page);
	return { page, state };
}

async function ready(page) {
	await page.waitForFunction(
		() =>
			document.querySelectorAll(".desktop-swatch, .mobile-swatch").length === 5,
	);
}
async function openSearch(page) {
	await page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name: "Search", exact: true })
		.click();
	await page.getByRole("dialog").waitFor();
}
async function openFilters(page) {
	if (
		!(await page.getByRole("textbox", { name: "Filter by artist" }).isVisible())
	) {
		await page.getByText("Discovery filters", { exact: true }).click();
	}
}
async function submit(page, query) {
	await page
		.getByRole("textbox", { name: "Search artworks", exact: true })
		.fill(query);
	await page.getByRole("button", { name: "search", exact: true }).click();
}
async function result(page, query, number = 1) {
	await page
		.getByRole("dialog")
		.getByText(`Result for ${query} · page ${number}`, { exact: true })
		.waitFor();
}
async function stored(page) {
	return page.evaluate(
		(key) => JSON.parse(localStorage.getItem(key) || "[]"),
		key,
	);
}
async function showHistory(page) {
	if (!(await page.getByRole("list", { name: "Recent searches" }).isVisible()))
		await page.getByText(/^Recent searches \(/).click();
}
async function restore(page, query) {
	await showHistory(page);
	await page.locator(".recent-search").filter({ hasText: query }).click();
}
async function close(page) {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
}
async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);
}

try {
	for (const width of [1440, 390]) {
		const { page, state } = await session(width);
		await openSearch(page);
		await page
			.getByRole("textbox", { name: "Search artworks", exact: true })
			.fill("water lilies");
		assert.deepEqual(
			await stored(page),
			[],
			"Typing alone does not save a search",
		);
		await openFilters(page);
		await page
			.getByRole("textbox", { name: "Filter by artist" })
			.fill("Claude Monet");
		await page
			.getByRole("textbox", { name: "Filter by medium" })
			.fill("oil on canvas");
		await page
			.getByRole("combobox", { name: "Filter by period" })
			.selectOption("1800:1899");
		await page
			.getByRole("checkbox", { name: "Public-domain artworks only" })
			.check();
		await page
			.getByRole("button", { name: "Apply filters", exact: true })
			.click();
		await result(page, "water lilies");
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await result(page, "water lilies", 2);
		const original = state.calls.at(-1);
		assert.equal((await stored(page)).length, 1);
		assert.equal((await stored(page))[0].page, 2);
		await page
			.getByRole("button", { name: /Result for water lilies · page 2/ })
			.click();
		await ready(page);
		await openSearch(page);
		assert.equal(
			await page.locator(".recent-search").count(),
			1,
			"History survives selecting artwork",
		);
		await page
			.getByRole("textbox", { name: "Search artworks", exact: true })
			.fill("portraits");
		await page
			.getByRole("button", { name: "Clear filters", exact: true })
			.click();
		await result(page, "portraits");
		await restore(page, "water lilies");
		await result(page, "water lilies", 2);
		assert.deepEqual(
			state.calls.at(-1),
			original,
			"Restoring reproduces the exact filter/page request",
		);
		assert.equal(
			await page
				.getByRole("textbox", { name: "Filter by artist" })
				.inputValue(),
			"Claude Monet",
		);
		assert.equal(
			await page
				.getByRole("textbox", { name: "Filter by medium" })
				.inputValue(),
			"oil on canvas",
		);
		assert.equal(
			await page
				.getByRole("combobox", { name: "Filter by period" })
				.inputValue(),
			"1800:1899",
		);
		assert.equal(
			await page
				.getByRole("checkbox", { name: "Public-domain artworks only" })
				.isChecked(),
			true,
		);
		assert.equal((await stored(page)).length, 2);
		assert.equal((await stored(page))[0].search.q, "water lilies");
		assert.equal(
			await page.evaluate(() =>
				document.activeElement.getAttribute("aria-label"),
			),
			"Search artworks",
		);
		results.push(
			`${width}px: restore filters and page after selecting artwork; deduplicate`,
		);
		await page.reload();
		await ready(page);
		await openSearch(page);
		assert.equal(await page.locator(".recent-search").count(), 2);
		await restore(page, "portraits");
		await result(page, "portraits");
		await openFilters(page);
		assert.equal(
			await page
				.getByRole("textbox", { name: "Filter by artist" })
				.inputValue(),
			"",
		);
		assert.equal(
			await page
				.getByRole("checkbox", { name: "Public-domain artworks only" })
				.isChecked(),
			false,
		);
		results.push(
			`${width}px: reload persistence and clearing old filters on restore`,
		);
		const beforeFailure = await stored(page);
		await submit(page, "network failure");
		await page
			.getByText("Search is unavailable. Please try again.", { exact: true })
			.waitFor();
		assert.deepEqual(await stored(page), beforeFailure);
		await submit(page, "nothing");
		await page.getByText(/No artworks match/).waitFor();
		assert.equal((await stored(page))[0].search.q, "nothing");
		results.push(
			`${width}px: failures are not saved; completed empty searches are saved`,
		);
		await close(page);
		await page
			.getByRole("button", { name: "Read full artwork details", exact: true })
			.click();
		await page
			.getByRole("button", { name: "More by this artist", exact: true })
			.click();
		await result(page, "related");
		const related = state.calls.at(-1);
		await submit(page, "gardens");
		await result(page, "gardens");
		await restore(page, "Works by Claude Monet");
		await result(page, "related");
		assert.deepEqual(
			state.calls.at(-1),
			related,
			"Artist IDs and excluded artwork survive a round trip",
		);
		results.push(
			`${width}px: More by this artist history restores exact query`,
		);
		await page
			.getByText("Discovery filters", { exact: true })
			.evaluate((node) => {
				node.closest("details").open = false;
			});
		await showHistory(page);
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			),
			false,
		);
		if (output)
			await page.getByRole("dialog").screenshot({
				path: resolve(output, `${engine}-search-history-${width}.png`),
			});
		await page
			.getByRole("button", { name: "Clear searches", exact: true })
			.click();
		assert.deepEqual(await stored(page), []);
		await page.reload();
		await ready(page);
		await openSearch(page);
		assert.equal(await page.locator(".recent-search").count(), 0);
		results.push(`${width}px: clear persists across reload`);
		await page.close();
	}
	const { page, state } = await session(1440);
	await openSearch(page);
	await submit(page, "portraits");
	await result(page, "portraits");
	let release;
	state.gate = new Promise((resolve) => {
		release = resolve;
	});
	await submit(page, "slow");
	await restore(page, "portraits");
	await page
		.getByText("Searching the collection…", { exact: true })
		.waitFor({ state: "hidden" });
	const finished = page.waitForResponse((response) =>
		response.url().includes("%22slow%22"),
	);
	release();
	await finished;
	await settle(page);
	assert.equal((await stored(page)).length, 1);
	assert.equal((await stored(page))[0].search.q, "portraits");
	await result(page, "portraits");
	results.push(
		"A superseded response cannot overwrite recalled results or search history",
	);
	state.gate = new Promise((resolve) => {
		release = resolve;
	});
	await submit(page, "slow");
	await showHistory(page);
	const paletteHistory = await page.evaluate(() =>
		localStorage.getItem("chroma-history-v1"),
	);
	await page
		.getByRole("button", { name: "Clear searches", exact: true })
		.click();
	release();
	await result(page, "slow");
	assert.deepEqual(await stored(page), []);
	assert.equal(
		await page.evaluate(() => localStorage.getItem("chroma-history-v1")),
		paletteHistory,
	);
	results.push(
		"Clearing while a request is pending stays cleared and preserves palette history",
	);
	await page.close();
	for (const storage of ["blocked", "corrupt"]) {
		const { page } = await session(320, storage);
		await openSearch(page);
		await submit(page, "landscapes");
		await result(page, "landscapes");
		await showHistory(page);
		assert.equal(await page.locator(".recent-search").count(), 1);
		if (storage === "blocked")
			await page
				.getByText("Search history is available for this session only.", {
					exact: true,
				})
				.waitFor();
		await page
			.getByRole("button", { name: "Clear searches", exact: true })
			.click();
		assert.equal(await page.locator(".recent-search").count(), 0);
		results.push(
			`${storage} browser storage does not break search or session history`,
		);
		await page.close();
	}
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify({ engine, passed: results.length, results }, null, 2),
	);
} finally {
	await browser.close();
}
