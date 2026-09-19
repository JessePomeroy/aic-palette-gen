// Real workbench controls; isolated clipboard, museum and image fixtures only.
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
const browser = await playwright[engine].launch({ headless: true });
const results = [];
const errors = [];
const artwork = {
	id: 101,
	title: "Palette controls fixture",
	artist_display: "Synthetic fixture",
	artist_title: "Fixture",
	image_id: "palette-controls-fixture",
	is_public_domain: true,
	date_display: "2026",
	medium_display: "Synthetic JPEG",
	thumbnail: { width: 600, height: 400 },
};

async function session(width, height) {
	const page = await browser.newPage({
		viewport: { width, height },
		hasTouch: width < 1024,
		reducedMotion: "reduce",
	});
	page.setDefaultTimeout(10000);
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() => {
		window.clipboardFixture = {
			denied: false,
			hold: false,
			calls: [],
			pending: [],
		};
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (hex) => {
					const state = window.clipboardFixture;
					state.calls.push(hex);
					if (state.hold)
						await new Promise((resolve, reject) =>
							state.pending.push({ resolve, reject }),
						);
					if (state.denied)
						throw new DOMException("Fixture denial", "NotAllowedError");
				},
			},
		});
	});
	const image = Buffer.from(
		await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 600;
			canvas.height = 400;
			const ctx = canvas.getContext("2d");
			[
				"#abada8",
				"#718a9c",
				"#95877e",
				"#59483a",
				"#ddc17c",
				"#a75977",
				"#456f64",
				"#8d7cb2",
			].forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(i * 75, 0, 75, 400);
			});
			return canvas.toDataURL("image/jpeg").split(",")[1];
		}),
		"base64",
	);
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: { pagination: { total: 1 }, data: [artwork] },
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image")
			return route.fulfill({ contentType: "image/jpeg", body: image });
		if (
			url.origin !== new URL(base).origin ||
			url.pathname.startsWith("/api/") ||
			!["GET", "HEAD"].includes(route.request().method())
		)
			return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await ready(page, 5);
	return page;
}

const copies = (page) =>
	page.locator("main").getByRole("button", { name: /^Copy #[a-f0-9]{6}$/ });
const locks = (page) =>
	page.locator("main").getByRole("button", { name: /^(?:Lock|Unlock) color / });
const notice = (page) =>
	page
		.locator("main")
		.getByRole("status")
		.filter({ hasText: /Copied #|Clipboard unavailable/ });
async function ready(page, count) {
	await page.waitForFunction(
		(count) =>
			document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
				.length === count && !document.querySelector("main select")?.disabled,
		count,
	);
}
async function activate(locator, touch) {
	if (touch) await locator.tap();
	else await locator.click();
}
async function clipboardCalls(page) {
	return page.evaluate(() => window.clipboardFixture.calls);
}
async function state(page) {
	return locks(page).evaluateAll((buttons) =>
		buttons.map((button) => ({
			label: button.getAttribute("aria-label"),
			pressed: button.getAttribute("aria-pressed"),
		})),
	);
}
async function openTools(page) {
	const opener = page
		.getByRole("navigation", { name: "Workbench tools" })
		.getByRole("button", { name: "Palette tools", exact: true });
	await opener.click();
	await page.getByRole("dialog", { name: "Advanced palette tools" }).waitFor();
	await page.waitForFunction(
		() => !document.querySelector("main select")?.disabled,
	);
	return opener;
}

function geometry() {
	const buttons = [...document.querySelectorAll("main button")].filter(
		(button) =>
			/^(Copy #|Lock color |Unlock color )/.test(
				button.getAttribute("aria-label") || "",
			),
	);
	return {
		overflow: document.documentElement.scrollWidth > innerWidth,
		artHeight: document
			.querySelector(".mobile-art, .desktop-art")
			.getBoundingClientRect().height,
		buttons: buttons.map((button) => {
			const rect = button.getBoundingClientRect();
			const hit = document.elementFromPoint(
				rect.x + rect.width / 2,
				rect.y + rect.height / 2,
			);
			const range = document.createRange();
			range.selectNodeContents(button.querySelector(".palette-hex") || button);
			const text = range.getBoundingClientRect();
			return {
				label: button.getAttribute("aria-label"),
				width: rect.width,
				height: rect.height,
				top: rect.top,
				bottom: rect.bottom,
				reachable: button.contains(hit),
				textFits: text.left >= rect.left && text.right <= rect.right,
				font: getComputedStyle(button.querySelector(".palette-hex") || button)
					.fontSize,
			};
		}),
	};
}

try {
	for (const [width, height] of [
		[1440, 900],
		[390, 844],
		[320, 568],
	]) {
		const page = await session(width, height);
		const touch = width < 1024;
		// First assert the reported interaction, before any layout-specific selectors.
		assert.equal(
			await copies(page).count(),
			5,
			"Every main swatch has a separate copy action",
		);
		const hex = (await copies(page).first().getAttribute("aria-label")).slice(
			5,
		);
		const original = await state(page);
		await activate(copies(page).first(), touch);
		await notice(page)
			.filter({ hasText: `Copied ${hex}.` })
			.waitFor();
		assert.deepEqual(await clipboardCalls(page), [hex]);
		assert.deepEqual(
			await state(page),
			original,
			"Copying must not change locks",
		);
		assert.equal(
			await copies(page).first().innerText(),
			hex,
			"Hex stays readable during confirmation",
		);
		assert.equal(await notice(page).getAttribute("aria-atomic"), "true");
		await activate(locks(page).first(), touch);
		assert.equal(
			await locks(page).first().getAttribute("aria-pressed"),
			"true",
		);
		assert.match(
			await locks(page).first().getAttribute("aria-label"),
			/^Unlock color 1/,
		);
		assert.deepEqual(
			await clipboardCalls(page),
			[hex],
			"Locking must not copy",
		);
		await page
			.locator("main")
			.getByRole("button", { name: "Regenerate unlocked", exact: true })
			.click();
		await ready(page, 5);
		assert.equal(
			await copies(page).first().innerText(),
			hex,
			"Regeneration preserves the locked slot",
		);
		assert.equal(
			await locks(page).first().getAttribute("aria-pressed"),
			"true",
		);
		await activate(locks(page).first(), touch);
		results.push(
			`${width}px: separate copy/lock, announced success, lock survives regeneration`,
		);

		await page.evaluate(() => {
			window.clipboardFixture.denied = true;
		});
		const deniedHex = (
			await copies(page).first().getAttribute("aria-label")
		).slice(5);
		await activate(copies(page).first(), touch);
		await notice(page)
			.filter({
				hasText: `Clipboard unavailable. Select and copy ${deniedHex}.`,
			})
			.waitFor();
		assert.equal(
			await copies(page)
				.first()
				.evaluate((button) => button.classList.contains("copied")),
			false,
		);
		assert.equal(
			await page
				.locator("main")
				.getByText(/^Copied #/)
				.count(),
			0,
		);
		await page.evaluate(() => {
			window.clipboardFixture.denied = false;
		});
		await activate(copies(page).first(), touch);
		await notice(page)
			.filter({ hasText: `Copied ${deniedHex}.` })
			.waitFor();
		results.push(`${width}px: honest clipboard denial and successful retry`);

		for (const count of [5, 6, 7, 8]) {
			await page
				.locator("main")
				.getByRole("combobox", { name: "Number of colors" })
				.selectOption(String(count));
			await ready(page, count);
			await page.evaluate(() => document.fonts.ready);
			const measured = await page.evaluate(geometry);
			assert.equal(measured.overflow, false);
			assert.equal(measured.buttons.length, count * 2);
			for (const button of measured.buttons) {
				assert.ok(
					button.width >= 44 && button.height >= 44,
					JSON.stringify(button),
				);
				assert.ok(
					button.reachable && button.top >= 0 && button.bottom <= height,
					JSON.stringify(button),
				);
				assert.ok(
					button.textFits,
					`No clipped or overlapping labels: ${JSON.stringify(button)}`,
				);
				if (button.label.startsWith("Copy"))
					assert.ok(parseFloat(button.font) >= 14, JSON.stringify(button));
			}
			assert.ok(
				measured.artHeight >= (width === 320 ? 80 : 200),
				`Artwork keeps usable space: ${JSON.stringify(measured)}`,
			);
			if (output && [5, 8].includes(count))
				await page.screenshot({
					path: resolve(output, `${engine}-palette-${width}-${count}.png`),
				});
			results.push(
				`${width}px: ${count} colors readable, touch-sized, reachable; artwork ${Math.round(measured.artHeight)}px`,
			);
		}

		const opener = await openTools(page);
		await page
			.getByRole("heading", { name: "Advanced tools", exact: true })
			.waitFor();
		await page
			.getByRole("region", { name: "Compare extraction modes" })
			.waitFor();
		await page.getByRole("region", { name: "Check text contrast" }).waitFor();
		const panelCopy = page
			.getByRole("dialog")
			.getByRole("button", { name: /^Copy #/ })
			.first();
		await panelCopy.click();
		await page
			.getByRole("dialog")
			.getByRole("status")
			.filter({ hasText: /^Copied #/ })
			.waitFor();
		await page.locator(".workbench-sheet-content").evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		const footer = await page.locator(".workbench-copy-status").boundingBox();
		assert.ok(
			footer.y >= 0 && footer.y + footer.height <= height,
			"Copy feedback stays in view after scrolling advanced tools",
		);
		if (output)
			await page.getByRole("dialog").screenshot({
				path: resolve(output, `${engine}-palette-tools-${width}.png`),
			});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Close", exact: true })
			.click();
		assert.equal(
			await opener.evaluate((button) => document.activeElement === button),
			true,
			"Close returns to the exact opener",
		);
		await openTools(page);
		await page.keyboard.press("Escape");
		assert.equal(
			await opener.evaluate((button) => document.activeElement === button),
			true,
			"Escape restores focus",
		);
		results.push(
			`${width}px: advanced tools retained, panel copy announced, close/Escape focus restored`,
		);
		await page.close();
	}

	const page = await session(390, 844);
	await copies(page).first().focus();
	await page.keyboard.press("Enter");
	await notice(page)
		.filter({ hasText: /^Copied #/ })
		.waitFor();
	const calls = (await clipboardCalls(page)).length;
	await page.keyboard.press("Tab");
	assert.equal(
		await locks(page)
			.first()
			.evaluate((button) => document.activeElement === button),
		true,
	);
	await page.keyboard.press("Space");
	assert.equal(await locks(page).first().getAttribute("aria-pressed"), "true");
	assert.equal((await clipboardCalls(page)).length, calls);
	results.push(
		"Keyboard: Enter copies, next Tab reaches separate lock, Space only locks",
	);

	await page.evaluate(() => {
		window.clipboardFixture.hold = true;
	});
	await copies(page).first().click();
	assert.equal(
		await page
			.locator("main")
			.getByText(/^Copied #/)
			.count(),
		0,
		"No success while clipboard is pending",
	);
	await copies(page).nth(1).click();
	const lastHex = (await copies(page).nth(1).getAttribute("aria-label")).slice(
		5,
	);
	await page.evaluate(() => window.clipboardFixture.pending[1].resolve());
	await notice(page)
		.filter({ hasText: `Copied ${lastHex}.` })
		.waitFor();
	await page.evaluate(() =>
		window.clipboardFixture.pending[0].reject(
			new DOMException("Old request denied", "NotAllowedError"),
		),
	);
	await page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);
	assert.equal(
		await notice(page).innerText(),
		`Copied ${lastHex}.`,
		"Late older failure cannot replace current feedback",
	);
	results.push(
		"Pending and out-of-order clipboard results never report premature or stale success",
	);
	await page.close();
	const repeated = await session(390, 844);
	await repeated.clock.install();
	await copies(repeated).first().click();
	await notice(repeated)
		.filter({ hasText: /^Copied #/ })
		.waitFor();
	const confirmation = await notice(repeated).innerText();
	await repeated.evaluate(() => {
		window.copyAnnouncements = [];
		const region = document.querySelector(".mobile-palette-hint");
		new MutationObserver(() =>
			window.copyAnnouncements.push(region.textContent),
		).observe(region, { subtree: true, childList: true, characterData: true });
	});
	await repeated.clock.fastForward(2000);
	await copies(repeated).first().click();
	await notice(repeated).filter({ hasText: confirmation }).waitFor();
	assert.ok(
		await repeated.evaluate(
			(text) =>
				window.copyAnnouncements.includes(text) &&
				window.copyAnnouncements.some((value) => value !== text),
			confirmation,
		),
		"Repeating the same hex updates the live region again",
	);
	await repeated.clock.fastForward(1100);
	assert.equal(
		await notice(repeated).innerText(),
		confirmation,
		"Previous timer cannot clear the new confirmation",
	);
	await repeated.clock.fastForward(2000);
	assert.equal(await notice(repeated).count(), 0);
	results.push(
		"Repeated same-hex copies update the live region and restart the feedback timer",
	);
	await repeated.evaluate(() =>
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: undefined,
		}),
	);
	await copies(repeated).first().click();
	await notice(repeated).filter({ hasText: "Clipboard unavailable" }).waitFor();
	assert.equal(
		await copies(repeated)
			.first()
			.evaluate((button) => button.classList.contains("copied")),
		false,
	);
	results.push("Missing Clipboard API shows failure, never success");
	await repeated.close();
	if (engine === "chromium") {
		const native = await session(1440, 900);
		await native
			.context()
			.grantPermissions(["clipboard-read", "clipboard-write"], {
				origin: base,
			});
		await native.evaluate(() => {
			delete navigator.clipboard;
		});
		const hex = (await copies(native).first().getAttribute("aria-label")).slice(
			5,
		);
		await copies(native).first().click();
		await notice(native)
			.filter({ hasText: `Copied ${hex}.` })
			.waitFor();
		assert.equal(
			await native.evaluate(() => navigator.clipboard.readText()),
			hex,
		);
		results.push(
			"Native Chromium clipboard receives the exact hex after a real button click",
		);
		await native.close();
	}
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
