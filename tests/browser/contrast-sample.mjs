// The real palette drawer with fixture artwork; no museum, database or provider calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.WORKBENCH_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const lorem =
	"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const browser = await playwright[engine].launch({ headless: true });
const results = [];
const errors = [];

function sampleGeometry(lorem) {
	const heading = document.querySelector(".contrast-sample");
	const sample = heading.querySelector(".contrast-sample-text");
	const text = sample.textContent;
	const bounds = sample.getBoundingClientRect();
	const nextWord = lorem.slice(text.length).trimStart().split(" ")[0];
	const probe = sample.cloneNode();
	probe.textContent = `${text} ${nextWord}`;
	probe.style.cssText = "position:absolute;visibility:hidden;width:max-content";
	heading.append(probe);
	const nextWidth = probe.getBoundingClientRect().width;
	probe.remove();
	return {
		text,
		available: heading.clientWidth,
		width: bounds.width,
		right: bounds.right,
		limit: heading.getBoundingClientRect().right,
		height: bounds.height,
		lineHeight: parseFloat(getComputedStyle(heading).lineHeight),
		fontSize: getComputedStyle(heading).fontSize,
		nextWidth,
		color: getComputedStyle(heading).color,
		background: getComputedStyle(heading.parentElement).backgroundColor,
		caption: heading.nextElementSibling.textContent,
		overflow: document.documentElement.scrollWidth > innerWidth,
	};
}

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	const image = Buffer.from(
		await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 600;
			canvas.height = 400;
			const ctx = canvas.getContext("2d");
			["#dc9643", "#8c8c8c", "#c97b1c", "#6c6762", "#464443"].forEach(
				(color, i) => {
					ctx.fillStyle = color;
					ctx.fillRect(i * 120, 0, 120, 400);
				},
			);
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}),
		"base64",
	);
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: {
					pagination: { total: 1 },
					data: [
						{
							id: 101,
							title: "Contrast preview fixture",
							artist_title: "Browser test",
							image_id: "contrast-fixture",
							is_public_domain: true,
							thumbnail: { width: 600, height: 400 },
						},
					],
				},
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image")
			return route.fulfill({ contentType: "image/jpeg", body: image });
		if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
			return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await page.waitForFunction(
		() => document.querySelectorAll(".desktop-swatch").length === 5,
	);
	const open = async () => {
		await page
			.getByRole("navigation", { name: "Workbench tools" })
			.getByRole("button", { name: "Palette", exact: true })
			.click();
		await page.locator(".contrast-sample-text").waitFor();
		await page.evaluate(() => document.fonts.ready);
	};
	const check = async (label) => {
		await page.evaluate(
			() =>
				new Promise((done) =>
					requestAnimationFrame(() => requestAnimationFrame(done)),
				),
		);
		const sample = await page.evaluate(sampleGeometry, lorem);
		assert.ok(sample.text.length > 0 && lorem.startsWith(sample.text), label);
		assert.ok(
			sample.text === lorem || lorem[sample.text.length] === " ",
			"Only whole words are shown",
		);
		assert.ok(
			sample.width <= sample.available && sample.right <= sample.limit + 0.5,
			"No clipped letters",
		);
		assert.ok(
			sample.height <= sample.lineHeight + 1,
			"The sample stays on one line",
		);
		assert.ok(
			sample.text === lorem || sample.nextWidth > sample.available,
			`${label}: show as many whole words as fit: ${JSON.stringify(sample)}`,
		);
		assert.equal(sample.caption, "A small type sample for this color pair.");
		assert.equal(sample.overflow, false);
		results.push({
			label,
			text: sample.text,
			width: sample.available,
			fontSize: sample.fontSize,
		});
		return sample;
	};
	await open();
	const baseline = await check("initial desktop");
	const sizes = new Map();
	for (const width of [1920, 1440, 1024, 768, 390, 320, 390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.evaluate(
			() =>
				new Promise((done) =>
					requestAnimationFrame(() => requestAnimationFrame(done)),
				),
		);
		// The workbench deliberately closes its drawer when switching to a mobile sheet.
		if (!(await page.getByRole("dialog").isVisible())) await open();
		const sample = await check(`resize to ${width}px`);
		assert.equal(
			sample.fontSize,
			baseline.fontSize,
			"Resizing changes words, not type size",
		);
		assert.equal(sample.color, baseline.color);
		assert.equal(sample.background, baseline.background);
		sizes.set(width, sample.text.length);
		if (output && [320, 390, 1440, 1920].includes(width)) {
			await page
				.getByLabel("Text contrast sample", { exact: true })
				.scrollIntoViewIfNeeded();
			await page.getByRole("dialog").screenshot({
				path: resolve(output, `${engine}-contrast-${width}.png`),
			});
		}
	}
	assert.ok(sizes.get(1920) > sizes.get(320), "Wider previews show more words");
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "24px";
	});
	const enlarged = await check("larger browser text");
	assert.ok(parseFloat(enlarged.fontSize) > parseFloat(baseline.fontSize));
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
		document.querySelector(".contrast-sample").style.fontFamily = "monospace";
	});
	await check("font metrics change without resizing the window");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await page.setViewportSize({ width: 320, height: 844 });
	await open();
	await check("reopened on a small phone");
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify({ engine, passed: results.length, results }, null, 2),
	);
} finally {
	await browser.close();
}
