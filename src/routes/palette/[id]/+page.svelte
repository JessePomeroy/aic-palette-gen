<!--
  Shared Palette View — displays a saved palette via its UUID short link.
  Data is loaded server-side from Neon + AIC API (see +page.server.ts).
  Mobile-first responsive layout.
-->

<script lang="ts">
	import { getImageUrl } from '$lib/api/artic';
	import { exportJson, exportCss, exportPng, exportAse, downloadFile } from '$lib/export/palette';
	import type { ExtractedColor } from '$lib/colors/extraction';

	let { data } = $props();
	const { artwork, palette } = data;
	const colors: ExtractedColor[] = palette.colors;

	function copyColor(hex: string) {
		navigator.clipboard.writeText(hex);
	}

	async function handleExport(format: 'json' | 'css' | 'png' | 'ase') {
		switch (format) {
			case 'json':
				downloadFile(exportJson(colors), `palette-${palette.id}.json`);
				break;
			case 'css':
				downloadFile(exportCss(colors), `palette-${palette.id}.css`);
				break;
			case 'png':
				const png = await exportPng(colors);
				downloadFile(png, `palette-${palette.id}.png`);
				break;
			case 'ase':
				const ase = exportAse(colors);
				downloadFile(ase, `palette-${palette.id}.ase`);
				break;
		}
	}
</script>

<div class="min-h-screen bg-stone-50 text-stone-900">
	<!-- Header -->
	<header class="border-b border-stone-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
		<div class="flex items-center justify-between">
			<h1 class="text-xl font-semibold sm:text-2xl">Art Institute Color Palette</h1>
			<a href="/" class="text-sm text-stone-500 hover:text-stone-900">← Generate your own</a>
		</div>
	</header>

	<main class="mx-auto max-w-4xl p-4 sm:p-6">
		{#if artwork}
			<!-- Artwork image — full width on mobile -->
			<div class="mb-4 sm:mb-6">
				{#if artwork.image_id}
					<img
						crossorigin="anonymous"
						src={getImageUrl(artwork.image_id, 'large')}
						alt={artwork.thumbnail?.alt_text || artwork.title}
						class="w-full rounded-lg shadow-lg sm:w-auto sm:max-h-[60vh]"
					/>
				{/if}
			</div>

			<!-- Artwork metadata -->
			<div class="mb-4 sm:mb-6">
				<h2 class="text-lg font-medium sm:text-xl">{artwork.title}</h2>
				<p class="text-sm text-stone-600 sm:text-base">{artwork.artist_display}</p>
				<p class="text-xs text-stone-500 sm:text-sm">{artwork.date_display}</p>
			</div>
		{/if}

		<!-- Horizontal palette strip -->
		<div class="mb-4 sm:mb-6">
			<div class="flex overflow-hidden rounded-lg shadow-sm">
				{#each colors as color}
					<button
						onclick={() => copyColor(color.hex)}
						class="group flex-1 transition-transform hover:z-10 hover:scale-105"
						title="Click to copy {color.hex}"
					>
						<div class="h-12 sm:h-16" style="background-color: {color.hex}"></div>
					</button>
				{/each}
			</div>

			<div class="mt-1.5 flex sm:mt-2">
				{#each colors as color}
					<button
						onclick={() => copyColor(color.hex)}
						class="flex-1 text-center font-mono text-[10px] text-stone-600 hover:text-stone-900 sm:text-xs"
					>
						{color.hex}
					</button>
				{/each}
			</div>
		</div>

		<!-- Export + info — wraps on small screens -->
		<div class="flex flex-wrap items-center gap-2 sm:gap-4">
			<span class="text-xs text-stone-500 sm:text-sm">
				{palette.count} colors · {palette.mode} mode
			</span>
			<div class="flex flex-wrap gap-1.5 sm:gap-2">
				<button onclick={() => handleExport('json')} class="rounded border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 sm:px-3 sm:py-1.5 sm:text-sm">JSON</button>
				<button onclick={() => handleExport('css')} class="rounded border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 sm:px-3 sm:py-1.5 sm:text-sm">CSS</button>
				<button onclick={() => handleExport('png')} class="rounded border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 sm:px-3 sm:py-1.5 sm:text-sm">PNG</button>
				<button onclick={() => handleExport('ase')} class="rounded border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 sm:px-3 sm:py-1.5 sm:text-sm">.ASE</button>
			</div>
		</div>
	</main>
</div>
