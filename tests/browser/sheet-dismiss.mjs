import assert from "node:assert/strict";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["chromium", "webkit"].includes(engine));
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await playwright[engine].launch();
const results = [],
	errors = [];
try {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		reducedMotion: "no-preference",
	});
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(error.message));
	const image = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 600;
		canvas.height = 400;
		const ctx = canvas.getContext("2d");
		["#778899", "#ad8f41", "#ba6655", "#556b44", "#eee0bd"].forEach(
			(color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(i * 120, 0, 120, 400);
			},
		);
		return canvas.toDataURL("image/jpeg").split(",")[1];
	});
	const artwork = {
		id: 101,
		title: "Gesture fixture",
		artist_title: "Fixture artist",
		artist_display: "Fixture artist",
		image_id: "00000000-0000-0000-0000-000000000101",
		thumbnail: { width: 600, height: 400 },
		is_public_domain: true,
	};
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "api.artic.edu")
			return route.fulfill({
				json: { pagination: { total: 1 }, data: [artwork] },
			});
		if (url.hostname === "www.artic.edu" || url.pathname === "/api/image")
			return route.fulfill({
				contentType: "image/jpeg",
				body: Buffer.from(image, "base64"),
			});
		if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
			return route.abort();
		return route.continue();
	});
	await page.goto(base);
	await page.waitForFunction(
		() =>
			document.querySelectorAll("main .mobile-swatch").length === 5 &&
			!document.querySelector("main select").disabled,
	);
	const dialog = page.locator("#workbench-tools");
	async function settled() {
		await dialog.evaluate(async (node) => {
			await Promise.all(
				node
					.getAnimations()
					.map((animation) => animation.finished.catch(() => {})),
			);
		});
	}
	async function open(name) {
		const button =
			name === "Info"
				? page
						.locator(".mobile-header")
						.getByRole("button", { name: "About this artwork" })
				: page
						.getByRole("navigation", { name: "Workbench tools" })
						.getByRole("button", { name, exact: true });
		await button.click();
		await page.waitForFunction(
			() => document.querySelector("#workbench-tools").open,
		);
		await settled();
		assert.equal(await dialog.evaluate((node) => node.style.translate), "");
		return button;
	}
	async function close() {
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await page.waitForFunction(
			() => !document.querySelector("#workbench-tools").open,
		);
	}
	const cdp = engine === "chromium" ? await context.newCDPSession(page) : null;
	async function gesture(selector, dx, dy, ending = "touchEnd", edge = false) {
		const box = await page.locator(selector).boundingBox();
		assert.ok(box);
		const x = edge ? box.x + 8 : box.x + box.width / 2;
		const y = edge ? box.y + 150 : box.y + box.height / 2;
		async function event(type, a, b) {
			if (cdp) {
				await cdp.send("Input.dispatchTouchEvent", {
					type,
					touchPoints: ["touchEnd", "touchCancel"].includes(type)
						? []
						: [{ x: a, y: b, id: 1 }],
				});
				await page.evaluate(
					() =>
						new Promise((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(resolve)),
						),
				);
			} else {
				// WebKit automation has no native swipe API; exercise the real DOM handlers.
				await page.evaluate(
					({ selector, type, x, y }) => {
						const target =
							window.sheetTouchTarget || document.querySelector(selector);
						if (type === "touchStart") window.sheetTouchTarget = target;
						const touch = { identifier: 1, clientX: x, clientY: y, target };
						const finished = type === "touchEnd" || type === "touchCancel";
						const event = new Event(type.toLowerCase(), {
							bubbles: true,
							cancelable: true,
						});
						Object.defineProperties(event, {
							touches: { value: finished ? [] : [touch] },
							changedTouches: { value: [touch] },
						});
						target.dispatchEvent(event);
						if (finished) delete window.sheetTouchTarget;
					},
					{ selector, type, x: a, y: b },
				);
			}
		}
		await event("touchStart", x, y);
		for (let step = 1; step <= 6; step++)
			await event("touchMove", x + (dx * step) / 6, y + (dy * step) / 6);
		const offset = await dialog.evaluate((node) => node.style.translate);
		if (ending) await event(ending, x + dx, y + dy);
		return {
			offset,
			end: () => event("touchEnd", x + dx, y + dy),
			reverse: async () => {
				await event("touchMove", x, y);
				await event("touchMove", x, y - 10);
				await event("touchEnd", x, y - 10);
			},
		};
	}
	for (const name of ["Search", "Palette tools", "History", "Save", "Info"]) {
		const opener = await open(name);
		const { offset } = await gesture("#workbench-panel-title", 0, 150);
		assert.ok(offset && offset !== "0 0px", `${name} follows the finger`);
		await page.waitForFunction(
			() => !document.querySelector("#workbench-tools").open,
		);
		assert.ok(
			await opener.evaluate((node) => document.activeElement === node),
			`${name} restores focus`,
		);
		await open(name);
		await close();
		results.push(`${name}: pull down and Close button`);
	}
	await open("Save");
	await gesture("#workbench-panel-title", 0, 35);
	await settled();
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	results.push("short pull returns to rest");
	const reversed = await gesture("#workbench-panel-title", 0, 60, null);
	await reversed.reverse();
	await settled();
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	results.push("reversing a pull cancels dismissal cleanly");
	await gesture("#workbench-panel-title", 0, 60, "touchCancel");
	await settled();
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	results.push("cancelled touch returns to rest");
	await gesture("#workbench-panel-title", 100, 20);
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	await gesture('.card-format-option input[value="classic"]', 0, 130);
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	results.push("horizontal gestures and controls do not dismiss");
	await gesture(".card-format legend", 0, 140);
	await page.waitForFunction(
		() => !document.querySelector("#workbench-tools").open,
	);
	results.push("pulling non-interactive content at the top dismisses");
	await open("Palette tools");
	await page
		.getByRole("button", { name: "Use vibrant", exact: true })
		.waitFor();
	const content = page.locator(".workbench-sheet-content");
	await content.evaluate((node) => {
		node.scrollTop = 180;
	});
	assert.ok(await content.evaluate((node) => node.scrollTop > 0));
	await gesture(".workbench-sheet-content", 0, 110, "touchEnd", true);
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	if (cdp)
		assert.ok(
			await content.evaluate((node) => node.scrollTop < 180),
			"Native downward scrolling remains available",
		);
	await content.evaluate((node) => {
		node.scrollTop = 0;
	});
	await gesture(".workbench-sheet-content", 0, -100, "touchEnd", true);
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	if (cdp)
		assert.ok(
			await content.evaluate((node) => node.scrollTop > 0),
			"Native upward scrolling remains available",
		);
	results.push("scrolling content does not dismiss");
	await close();
	await open("Save");
	const pending = await gesture("#workbench-panel-title", 0, 50, null);
	await page.setViewportSize({ width: 1440, height: 900 });
	await pending.end();
	await page.waitForFunction(
		() => !document.querySelector("#workbench-tools").open,
	);
	await open("Save & share");
	await gesture("#workbench-panel-title", 0, 150);
	assert.ok(
		await dialog.evaluate((node) => node.open && node.style.translate === ""),
	);
	await close();
	results.push("resize resets gestures; desktop drawers do not swipe down");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await open("Save");
	await gesture("#workbench-panel-title", 0, 35);
	assert.ok(
		await dialog.evaluate(
			(node) =>
				node.open &&
				node.style.translate === "" &&
				node.getAnimations().length === 0,
		),
	);
	await gesture("#workbench-panel-title", 0, 150);
	await page.waitForFunction(
		() => !document.querySelector("#workbench-tools").open,
	);
	results.push("reduced motion supports return and dismissal");
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{
				engine,
				input: cdp ? "native CDP touch" : "DOM touch-event replay",
				passed: results.length,
				results,
				errors,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
