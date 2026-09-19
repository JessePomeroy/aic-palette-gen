// Replays the museum's observed ScaleRestrictedException through real UI callers.
import assert from "node:assert/strict";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[2] || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const base = process.env.WORKBENCH_TEST_URL || "http://127.0.0.1:5185";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await playwright[engine].launch();
const results = [],
	failures = [];
try {
	for (const fixture of [
		{
			id: 106392,
			width: 714,
			height: 2680,
			title: "Shield (Targone) for the Gioco del Ponte",
			viewport: { width: 1440, height: 900 },
		},
		{
			id: 113598,
			width: 481,
			height: 768,
			title: "Study for the Vignette-Frontispiece",
			viewport: { width: 390, height: 844 },
		},
	]) {
		const context = await browser.newContext({
			viewport: fixture.viewport,
			reducedMotion: "reduce",
			acceptDownloads: true,
		});
		try {
			const page = await context.newPage(),
				errors = [],
				widths = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const artwork = {
				id: fixture.id,
				title: fixture.title,
				image_id: `00000000-0000-0000-0000-${String(fixture.id).padStart(12, "0")}`,
				artist_display: "Fixture artist",
				artist_title: "Fixture artist",
				date_display: "1776",
				medium_display: "Image-size regression fixture",
				is_public_domain: true,
				thumbnail: {
					width: fixture.width,
					height: fixture.height,
					alt_text: fixture.title,
				},
			};
			const image = Buffer.from(
				await page.evaluate(({ width, height }) => {
					const canvas = document.createElement("canvas");
					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext("2d");
					["#778a9b", "#a98d4a", "#9b514c", "#566b56", "#d3c89c"].forEach(
						(color, index) => {
							ctx.fillStyle = color;
							ctx.fillRect(
								Math.floor((index * width) / 5),
								0,
								Math.ceil(width / 5),
								height,
							);
						},
					);
					return canvas.toDataURL("image/jpeg").split(",")[1];
				}, fixture),
				"base64",
			);
			await page.route("**/*", (route) => {
				const url = new URL(route.request().url());
				if (url.hostname === "api.artic.edu")
					return route.fulfill({
						json: { pagination: { total: 1 }, data: [artwork] },
					});
				if (url.hostname === "www.artic.edu" || url.pathname === "/api/image") {
					const imageUrl =
						url.pathname === "/api/image"
							? new URL(url.searchParams.get("url"))
							: url;
					const width = Number(
						imageUrl.pathname.split("/full/")[1].split(",")[0],
					);
					widths.push(width);
					return route.fulfill(
						width > fixture.width
							? {
									status: 403,
									body: "Requests for scales in excess of 100% are not allowed.",
								}
							: { contentType: "image/jpeg", body: image },
					);
				}
				if (
					url.origin !== new URL(base).origin ||
					url.pathname.startsWith("/api/")
				)
					return route.abort();
				return route.continue();
			});
			const ready = () =>
				page.waitForFunction(
					() =>
						document.querySelectorAll(
							"main .desktop-swatch, main .mobile-swatch",
						).length >= 5 ||
						document
							.querySelector(".desktop-feedback, .mobile-feedback")
							?.textContent.includes("Could not generate"),
				);
			const close = async () => {
				await page
					.getByRole("dialog")
					.getByRole("button", { name: "Close", exact: true })
					.click();
				await page.waitForFunction(
					() => !document.querySelector("dialog").open,
				);
			};
			await page.goto(base);
			await ready();
			assert.equal(
				await page.locator("main .desktop-swatch, main .mobile-swatch").count(),
				5,
				"The narrow artwork must generate a palette on first load",
			);
			await page.reload();
			await ready();
			assert.equal(
				await page.locator("main .desktop-swatch, main .mobile-swatch").count(),
				5,
				"Refresh must generate a palette for the same narrow artwork",
			);
			assert.ok(
				await page
					.locator("main img")
					.evaluate((img) => img.complete && img.naturalWidth > 0),
			);
			await page
				.getByRole("combobox", { name: "Number of colors" })
				.selectOption("8");
			await page.waitForFunction(
				() =>
					document.querySelectorAll("main .desktop-swatch, main .mobile-swatch")
						.length === 8 && !document.querySelector("main select").disabled,
			);
			await page
				.getByRole("navigation", { name: "Workbench tools" })
				.getByRole("button", { name: "Palette tools", exact: true })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Use vibrant", exact: true })
				.click();
			await close();
			await page
				.getByRole("navigation", { name: "Workbench tools" })
				.getByRole("button", { name: /^(Save|Save & share)$/ })
				.click();
			const downloading = page.waitForEvent("download");
			await page
				.getByRole("button", {
					name: "Download artwork + palette card",
					exact: true,
				})
				.click();
			const download = await downloading;
			assert.equal(await download.failure(), null);
			await page.getByRole("radio", { name: "Card", exact: true }).check();
			const cardDownload = page.waitForEvent("download");
			await page
				.getByRole("button", { name: "Download card", exact: true })
				.click();
			assert.equal(await (await cardDownload).failure(), null);
			assert.ok(
				widths.length > 0 &&
					widths.every((width) => width > 0 && width <= fixture.width),
				"Every display/extraction/card image request must respect native width",
			);
			assert.deepEqual(errors, []);
			results.push({
				artworkId: fixture.id,
				requestedWidths: [...new Set(widths)],
			});
		} catch (error) {
			failures.push({ artworkId: fixture.id, error: error.message });
		} finally {
			await context.close();
		}
	}
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
