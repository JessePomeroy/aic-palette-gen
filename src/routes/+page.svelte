<!--
  Main Page — Art Institute Color Palette Generator

  Mobile-first responsive layout:
  - Mobile: single column — search/controls → artwork → palette → share/export
  - Desktop (lg+): sidebar (right 1/4) + artwork area (left 3/4)

  On load, fetches a random artwork and extracts its color palette.
  Color extraction runs client-side via Canvas + k-means (see $lib/colors/extraction.ts).
  Some IIIF images return 403 (restricted), so we retry up to 10 random artworks on load.
-->

<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { searchArtworks, getRandomArtwork, getImageUrl, type Artwork } from '$lib/api/artic';
	import { extractColors, type ExtractedColor, type ExtractionMode } from '$lib/colors/extraction';
	import { exportJson, exportCss, exportPng, exportAse, downloadFile } from '$lib/export/palette';

	// ── Reactive State ──

	let artwork = $state<Artwork | null>(null);
	let colors = $state<ExtractedColor[]>([]);
	let loading = $state(false);
	let searchQuery = $state('');
	let colorCount = $state(5);
	let extractionMode = $state<ExtractionMode>('dominant');
	let shareStatus = $state('');
	let aiDescription = $state('');          // Mood description from Gemini (AI mode only)
	let aiLoading = $state(false);           // Separate loading state for AI requests

	// ── Lifecycle ──

	onMount(async () => {
		await loadRandom();
	});

	// ── Data Loading ──

	async function loadRandom() {
		loading = true;
		aiDescription = '';
		try {
			for (let i = 0; i < 10; i++) {
				artwork = await getRandomArtwork();
				if (artwork?.image_id) {
					await tick();
					const extracted = await extractColors(getImageUrl(artwork.image_id, 'large'), extractionMode, colorCount);
					if (extracted.length > 0) {
						colors = extracted;
						break;
					}
					console.warn(`Image for "${artwork.title}" not accessible, trying another...`);
				}
			}
		} catch (e) {
			console.error('Failed to load artwork:', e);
		}
		loading = false;
	}

	async function handleSearch() {
		if (!searchQuery.trim()) return;
		loading = true;
		aiDescription = '';
		try {
			const result = await searchArtworks({ q: searchQuery, limit: 10 });
			for (const a of result.data) {
				if (a.image_id) {
					artwork = a;
					await tick();
					const extracted = await extractColors(getImageUrl(artwork.image_id, 'large'), extractionMode, colorCount);
					if (extracted.length > 0) {
						colors = extracted;
						break;
					}
				}
			}
		} catch (e) {
			console.error('Search failed:', e);
		}
		loading = false;
	}

	async function regeneratePalette() {
		if (!artwork?.image_id) return;

		if (extractionMode === 'ai') {
			await fetchAiPalette();
		} else {
			aiDescription = '';
			colors = await extractColors(getImageUrl(artwork.image_id, 'large'), extractionMode, colorCount);
		}
	}

	/**
	 * Fetch an AI-generated palette from Gemini via our server endpoint.
	 * Returns mood description + curated colors.
	 */
	async function fetchAiPalette() {
		if (!artwork?.image_id) return;
		aiLoading = true;
		try {
			const res = await fetch('/api/ai-palette', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					imageUrl: getImageUrl(artwork.image_id, 'medium'),
					count: colorCount
				})
			});

			const data = await res.json();

			if (!res.ok) {
				// Show the server's error message — includes rate limit info, image access errors, etc.
				aiDescription = data.error || 'Failed to generate palette. Try again.';
				return;
			}

			colors = data.colors;
			aiDescription = data.description;
		} catch (e) {
			console.error('Tone palette failed:', e);
			aiDescription = 'Failed to generate palette. Try again.';
		} finally {
			aiLoading = false;
		}
	}

	// ── User Actions ──

	function copyColor(hex: string) {
		navigator.clipboard.writeText(hex);
	}

	async function handleShare() {
		if (!artwork || colors.length === 0) return;
		try {
			const res = await fetch('/api/palette', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					artworkId: artwork.id,
					colors,
					mode: extractionMode,
					count: colorCount
				})
			});
			if (!res.ok) throw new Error('Failed to save');
			const { url } = await res.json();
			await navigator.clipboard.writeText(url);
			shareStatus = 'Link copied!';
			setTimeout(() => shareStatus = '', 3000);
		} catch (e) {
			console.error('Share failed:', e);
			shareStatus = 'Failed to share';
			setTimeout(() => shareStatus = '', 3000);
		}
	}

	async function handleExport(format: 'json' | 'css' | 'png' | 'ase') {
		if (colors.length === 0) return;
		switch (format) {
			case 'json':
				downloadFile(exportJson(colors), `palette-${artwork?.id}.json`);
				break;
			case 'css':
				downloadFile(exportCss(colors), `palette-${artwork?.id}.css`);
				break;
			case 'png':
				const png = await exportPng(colors);
				downloadFile(png, `palette-${artwork?.id}.png`);
				break;
			case 'ase':
				const ase = exportAse(colors);
				downloadFile(ase, `palette-${artwork?.id}.ase`);
				break;
		}
	}
</script>

<!-- ── Layout ── -->

<div class="min-h-screen bg-stone-50 text-stone-900">

	<!-- Header -->
	<header class="border-b border-stone-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
		<h1 class="text-xl font-semibold sm:text-2xl">Art Institute Color Palette</h1>
	</header>

	<!--
		Mobile: stacked column layout (controls → artwork → palette)
		Desktop (lg+): sidebar on right, artwork on left
	-->
	<main class="flex flex-col lg:flex-row">

		<!-- ── Controls ──
			Mobile: horizontal bar at top with search + quick actions
			Desktop: fixed sidebar on the right
		-->
		<aside class="order-1 border-b border-stone-200 bg-white p-4 sm:p-6 lg:order-2 lg:w-80 lg:border-b-0 lg:border-l">

			<!-- Search bar -->
			<div class="mb-4 lg:mb-6">
				<form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} class="flex gap-2">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search artworks..."
						class="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-sm sm:text-base"
					/>
					<button
						type="submit"
						class="shrink-0 rounded bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-700 sm:px-4 sm:text-base"
					>
						Search
					</button>
				</form>
			</div>

			<!-- Quick actions — random button + color count on same line -->
			<div class="mb-4 flex items-center gap-2 lg:mb-6">
				<button
					onclick={loadRandom}
					class="shrink-0 rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 sm:px-4"
				>
					Random
				</button>

				<!-- Color count dropdown -->
				<select
					bind:value={colorCount}
					onchange={regeneratePalette}
					class="rounded border border-stone-300 px-2 py-2 text-sm"
				>
					<option value={5}>5 colors</option>
					<option value={6}>6 colors</option>
					<option value={7}>7 colors</option>
					<option value={8}>8 colors</option>
				</select>

				<!-- Extraction mode dropdown -->
				<select
					bind:value={extractionMode}
					onchange={regeneratePalette}
					class="rounded border border-stone-300 px-2 py-2 text-sm"
				>
					<option value="dominant">Dominant</option>
					<option value="vibrant">Vibrant</option>
					<option value="ai">Tone</option>
				</select>
			</div>

			<!-- ── Share + Export (visible on desktop sidebar, hidden on mobile — shown below palette instead) ── -->
			{#if colors.length > 0}
				<div class="hidden lg:block">
					<!-- Share button -->
					<div class="mb-6 mt-2">
						<button
							onclick={handleShare}
							class="w-full rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700"
						>
							Share Palette
						</button>
						{#if shareStatus}
							<p class="mt-2 text-center text-sm text-stone-500">{shareStatus}</p>
						{/if}
					</div>

					<!-- Export buttons -->
					<div>
						<h3 class="mb-3 text-sm font-medium">Export</h3>
						<div class="grid grid-cols-2 gap-2">
							<button onclick={() => handleExport('json')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">JSON</button>
							<button onclick={() => handleExport('css')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">CSS</button>
							<button onclick={() => handleExport('png')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">PNG</button>
							<button onclick={() => handleExport('ase')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">.ASE</button>
						</div>
					</div>
				</div>
			{/if}
		</aside>

		<!-- ── Artwork Display + Palette ── -->
		<section class="order-2 flex-1 p-4 sm:p-6 lg:order-1">
			{#if loading}
				<div class="flex h-64 items-center justify-center sm:h-96">
					<span class="text-stone-500">Loading...</span>
				</div>
			{:else if artwork}
				<!-- Artwork image — full width on mobile, constrained on desktop -->
				<div class="mb-4 sm:mb-6">
					{#if artwork.image_id}
						<!-- crossorigin="anonymous" is REQUIRED — prevents opaque cache blocking fetch() -->
						<img
							crossorigin="anonymous"
							src={getImageUrl(artwork.image_id, 'large')}
							alt={artwork.thumbnail?.alt_text || artwork.title}
							class="w-full rounded-lg shadow-lg sm:w-auto sm:max-h-[60vh]"
						/>
					{:else}
						<div class="flex h-48 items-center justify-center rounded-lg bg-stone-200 sm:h-96">
							<span class="text-stone-500">No image available</span>
						</div>
					{/if}
				</div>

				<!-- Artwork metadata -->
				<div class="mb-4 sm:mb-6">
					<h2 class="text-lg font-medium sm:text-xl">{artwork.title}</h2>
					<p class="text-sm text-stone-600 sm:text-base">{artwork.artist_display}</p>
					<p class="text-xs text-stone-500 sm:text-sm">{artwork.date_display}</p>
				</div>

				<!-- ── AI Loading State ── -->
				{#if aiLoading}
					<div class="mb-4 flex items-center gap-2 rounded-lg bg-violet-50 p-4 sm:mb-6">
						<span class="text-sm text-violet-700">Analyzing artwork mood...</span>
					</div>
				{/if}

				<!-- ── AI Mood Description ── -->
				{#if aiDescription && !aiLoading}
					<div class="mb-4 rounded-lg bg-violet-50 p-3 sm:mb-6 sm:p-4">
						<p class="text-sm italic text-violet-900 sm:text-base">{aiDescription}</p>
					</div>
				{/if}

				<!-- ── Color Palette (horizontal swatches) ── -->
				{#if colors.length > 0 && !aiLoading}
					<div class="mb-4 sm:mb-6">
						<!-- Swatch strip -->
						<div class="flex overflow-hidden rounded-lg shadow-sm">
							{#each colors as color}
								<button
									onclick={() => copyColor(color.hex)}
									class="group flex-1 transition-transform hover:z-10 hover:scale-105"
									title="Click to copy {color.hex}"
								>
									<div
										class="h-12 sm:h-16"
										style="background-color: {color.hex}"
									></div>
								</button>
							{/each}
						</div>

						<!-- Hex labels -->
						<div class="mt-1.5 flex sm:mt-2">
							{#each colors as color}
								<button
									onclick={() => copyColor(color.hex)}
									class="flex-1 text-center font-mono text-[10px] text-stone-600 hover:text-stone-900 sm:text-xs"
									title="Click to copy"
								>
									{color.hex}
								</button>
							{/each}
						</div>
					</div>

					<!-- ── Share + Export (mobile only — below palette) ── -->
					<div class="flex flex-wrap items-center gap-2 lg:hidden">
						<button
							onclick={handleShare}
							class="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
						>
							Share
						</button>
						{#if shareStatus}
							<span class="text-sm text-stone-500">{shareStatus}</span>
						{/if}
						<span class="text-stone-300">|</span>
						<button onclick={() => handleExport('json')} class="rounded border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-100">JSON</button>
						<button onclick={() => handleExport('css')} class="rounded border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-100">CSS</button>
						<button onclick={() => handleExport('png')} class="rounded border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-100">PNG</button>
						<button onclick={() => handleExport('ase')} class="rounded border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-100">.ASE</button>
					</div>
				{/if}
			{/if}
		</section>
	</main>
</div>
