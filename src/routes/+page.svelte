<!--
  Main Page — Art Institute Color Palette Generator

  Layout: artwork display (left 3/4) + controls sidebar (right 1/4)
  
  On load, fetches a random artwork and extracts its color palette.
  User can search, randomize, adjust color count (5-8), and toggle
  between Dominant and Vibrant extraction modes.

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

	let artwork = $state<Artwork | null>(null);       // Currently displayed artwork
	let colors = $state<ExtractedColor[]>([]);         // Extracted palette colors
	let loading = $state(false);                       // Show loading spinner
	let searchQuery = $state('');                      // Search input value
	let colorCount = $state(5);                        // Number of colors to extract (5-8)
	let extractionMode = $state<ExtractionMode>('dominant'); // Current extraction mode
	let shareStatus = $state('');                          // Share button feedback text

	// ── Lifecycle ──

	// Load a random artwork on first render (onMount = client-side only, avoids SSR issues)
	onMount(async () => {
		await loadRandom();
	});

	// ── Data Loading ──

	/**
	 * Load a random artwork with an accessible image.
	 * Retries up to 10 times because:
	 * - Some artworks have no image_id (null)
	 * - Some images return 403 (restricted/copyrighted)
	 */
	async function loadRandom() {
		loading = true;
		try {
			for (let i = 0; i < 10; i++) {
				artwork = await getRandomArtwork();
				if (artwork?.image_id) {
					// Wait for Svelte to update the DOM before extracting
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

	/**
	 * Search for artworks by query string.
	 * Fetches 10 results and uses the first one with an accessible image.
	 */
	async function handleSearch() {
		if (!searchQuery.trim()) return;
		loading = true;
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

	/**
	 * Re-extract colors from the current artwork.
	 * Called when the user changes color count or extraction mode.
	 */
	async function regeneratePalette() {
		if (!artwork?.image_id) return;
		colors = await extractColors(getImageUrl(artwork.image_id, 'large'), extractionMode, colorCount);
	}

	// ── User Actions ──

	/** Copy a hex color value to the clipboard */
	function copyColor(hex: string) {
		navigator.clipboard.writeText(hex);
	}

	/** Save the current palette to Neon and copy the shareable link */
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

	/** Export the current palette in the selected format */
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
	<header class="border-b border-stone-200 bg-white px-6 py-4">
		<h1 class="text-2xl font-semibold">Art Institute Color Palette</h1>
	</header>

	<main class="flex">

		<!-- ── Artwork Display (left 3/4) ── -->
		<section class="flex-1 p-6">
			{#if loading}
				<div class="flex h-96 items-center justify-center">
					<span class="text-stone-500">Loading...</span>
				</div>
			{:else if artwork}
				<!-- Artwork image -->
				<div class="mb-6">
					{#if artwork.image_id}
						<!-- crossorigin="anonymous" is REQUIRED here — without it, the browser
						     caches an opaque response that blocks fetch() in color extraction -->
						<img
							crossorigin="anonymous"
							src={getImageUrl(artwork.image_id, 'large')}
							alt={artwork.thumbnail?.alt_text || artwork.title}
							class="max-h-[60vh] w-auto rounded-lg shadow-lg"
						/>
					{:else}
						<div class="flex h-96 items-center justify-center rounded-lg bg-stone-200">
							<span class="text-stone-500">No image available</span>
						</div>
					{/if}
				</div>

				<!-- Artwork metadata -->
				<div class="mb-6">
					<h2 class="text-xl font-medium">{artwork.title}</h2>
					<p class="text-stone-600">{artwork.artist_display}</p>
					<p class="text-sm text-stone-500">{artwork.date_display}</p>
				</div>

				<!-- ── Color Palette (horizontal swatches below artwork) ── -->
				{#if colors.length > 0}
					<div class="mb-6">
						<!-- Swatch strip — each color is an equal-width column -->
						<div class="flex overflow-hidden rounded-lg shadow-sm">
							{#each colors as color}
								<button
									onclick={() => copyColor(color.hex)}
									class="group flex-1 transition-transform hover:scale-105 hover:z-10"
									title="Click to copy {color.hex}"
								>
									<div
										class="h-16"
										style="background-color: {color.hex}"
									></div>
								</button>
							{/each}
						</div>

						<!-- Hex labels below swatches -->
						<div class="mt-2 flex">
							{#each colors as color}
								<button
									onclick={() => copyColor(color.hex)}
									class="flex-1 text-center font-mono text-xs text-stone-600 hover:text-stone-900"
									title="Click to copy"
								>
									{color.hex}
								</button>
							{/each}
						</div>
					</div>


				{/if}
			{/if}
		</section>

		<!-- ── Sidebar Controls (right 1/4) ── -->
		<aside class="w-80 border-l border-stone-200 bg-white p-6">

			<!-- Search bar -->
			<div class="mb-6">
				<form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} class="flex gap-2">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search artworks..."
						class="flex-1 rounded border border-stone-300 px-3 py-2"
					/>
					<button
						type="submit"
						class="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700"
					>
						Search
					</button>
				</form>
			</div>

			<!-- Random artwork button -->
			<button
				onclick={loadRandom}
				class="mb-6 w-full rounded border border-stone-300 px-4 py-2 hover:bg-stone-50"
			>
				🎲 Random Artwork
			</button>

			<!-- Extraction controls -->
			<div class="mb-6 space-y-4">
				<!-- Color count slider (5-8 colors) -->
				<div>
					<label class="mb-1 block text-sm font-medium">Colors: {colorCount}</label>
					<input
						type="range"
						min="5"
						max="8"
						bind:value={colorCount}
						onchange={regeneratePalette}
						class="w-full"
					/>
				</div>

				<!-- Extraction mode toggle -->
				<div>
					<label class="mb-2 block text-sm font-medium">Mode</label>
					<div class="flex gap-2">
						<button
							onclick={() => { extractionMode = 'dominant'; regeneratePalette(); }}
							class="flex-1 rounded px-3 py-2 {extractionMode === 'dominant' ? 'bg-stone-900 text-white' : 'border border-stone-300'}"
						>
							Dominant
						</button>
						<button
							onclick={() => { extractionMode = 'vibrant'; regeneratePalette(); }}
							class="flex-1 rounded px-3 py-2 {extractionMode === 'vibrant' ? 'bg-stone-900 text-white' : 'border border-stone-300'}"
						>
							Vibrant
						</button>
					</div>
				</div>
			</div>


			<!-- ── Share + Export ── -->
			{#if colors.length > 0}
				<!-- Share button — saves to Neon and copies link -->
				<div class="mb-6">
					<button
						onclick={handleShare}
						class="w-full rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700"
					>
						🔗 Share Palette
					</button>
					{#if shareStatus}
						<p class="mt-2 text-center text-sm text-stone-500">{shareStatus}</p>
					{/if}
				</div>

				<div>
					<h3 class="mb-3 text-sm font-medium">Export</h3>
					<div class="grid grid-cols-2 gap-2">
						<button onclick={() => handleExport('json')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
							JSON
						</button>
						<button onclick={() => handleExport('css')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
							CSS
						</button>
						<button onclick={() => handleExport('png')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
							PNG
						</button>
						<button onclick={() => handleExport('ase')} class="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
							.ASE
						</button>
					</div>
				</div>
			{/if}
		</aside>
	</main>
</div>
