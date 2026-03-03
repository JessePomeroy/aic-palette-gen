<!--
  Shared Palette View — displays a saved palette via its UUID short link.
  Data is loaded server-side from Neon + AIC API (see +page.server.ts).
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
	<header class="border-b border-stone-200 bg-white px-6 py-4">
		<div class="flex items-center justify-between">
			<h1 class="text-2xl font-semibold">Art Institute Color Palette</h1>
			<a href="/" class="text-sm text-stone-500 hover:text-stone-900">← Generate your own</a>
		</div>
	</header>

	<main class="mx-auto max-w-4xl p-6">
		{#if artwork}
			<!-- Artwork image -->
			<div class="mb-6">
				{#if artwork.image_id}
					<img
						crossorigin="anonymous"
						src={getImageUrl(artwork.image_id, 'large')}
						alt={artwork.thumbnail?.alt_text || artwork.title}
						class="max-h-[60vh] w-auto rounded-lg shadow-lg"
					/>
				{/if}
			</div>

			<!-- Artwork metadata -->
			<div class="mb-6">
				<h2 class="text-xl font-medium">{artwork.title}</h2>
				<p class="text-stone-600">{artwork.artist_display}</p>
				<p class="text-sm text-stone-500">{artwork.date_display}</p>
			</div>
		{/if}

		<!-- Horizontal palette strip -->
		<div class="mb-6">
			<div class="flex overflow-hidden rounded-lg shadow-sm">
				{#each colors as color}
					<button
						onclick={() => copyColor(color.hex)}
						class="group flex-1 transition-transform hover:scale-105 hover:z-10"
						title="Click to copy {color.hex}"
					>
						<div class="h-16" style="background-color: {color.hex}"></div>
					</button>
				{/each}
			</div>

			<div class="mt-2 flex">
				{#each colors as color}
					<button
						onclick={() => copyColor(color.hex)}
						class="flex-1 text-center font-mono text-xs text-stone-600 hover:text-stone-900"
					>
						{color.hex}
					</button>
				{/each}
			</div>
		</div>

		<!-- Export + info -->
		<div class="flex items-center gap-4">
			<span class="text-sm text-stone-500">
				{palette.count} colors · {palette.mode} mode
			</span>
			<div class="flex gap-2">
				<button onclick={() => handleExport('json')} class="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">JSON</button>
				<button onclick={() => handleExport('css')} class="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">CSS</button>
				<button onclick={() => handleExport('png')} class="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">PNG</button>
				<button onclick={() => handleExport('ase')} class="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">.ASE</button>
			</div>
		</div>
	</main>
</div>
