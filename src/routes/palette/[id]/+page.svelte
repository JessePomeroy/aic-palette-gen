<!--
  Shared Palette View — displays a saved palette via its UUID short link.
  Dark gallery aesthetic matching the main page.
-->

<script lang="ts">
	import { getImageUrl } from '$lib/api/artic';
	import { exportJson, exportCss, exportPng, exportAse, downloadFile } from '$lib/export/palette';
	import type { ExtractedColor } from '$lib/colors/extraction';

	let { data } = $props();
	const { artwork, palette } = data;
	const colors: ExtractedColor[] = palette.colors;

	let copiedHex = $state('');

	function copyColor(hex: string) {
		navigator.clipboard.writeText(hex);
		copiedHex = hex;
		setTimeout(() => copiedHex = '', 1500);
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

	function contrastText(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.5 ? '#1a1a1a' : '#f0f0f0';
	}
</script>

<div class="min-h-screen" style="background-color: var(--bg-primary); color: var(--text-primary);">

	<!-- header -->
	<header class="border-b px-4 py-3 sm:px-6" style="border-color: var(--border); background-color: var(--bg-secondary);">
		<div class="mx-auto flex max-w-4xl items-center justify-between">
			<h1 class="text-sm font-light tracking-widest uppercase" style="color: var(--text-secondary);">
				palette · aic
			</h1>
			<a
				href="/"
				class="text-xs"
				style="color: var(--text-muted);"
				onmouseenter={(e) => e.currentTarget.style.color = 'var(--accent)'}
				onmouseleave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
			>
				← generate your own
			</a>
		</div>
	</header>

	<main class="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
		{#if artwork}
			<!-- artwork image -->
			<div class="mb-6 sm:mb-8">
				{#if artwork.image_id}
					<img
						crossorigin="anonymous"
						src={getImageUrl(artwork.image_id, 'large')}
						alt={artwork.thumbnail?.alt_text || artwork.title}
						class="artwork-image w-full rounded-lg sm:w-auto sm:max-h-[65vh]"
						style="box-shadow: 0 8px 30px rgba(0,0,0,0.4);"
					/>
				{/if}
			</div>

			<!-- artwork metadata -->
			<div class="mb-6 sm:mb-8">
				<h2 class="text-lg font-normal italic sm:text-xl" style="color: var(--text-primary);">
					{artwork.title}
				</h2>
				<p class="mt-1 text-sm" style="color: var(--text-secondary);">
					{artwork.artist_display}
				</p>
				{#if artwork.date_display}
					<p class="mt-0.5 text-xs" style="color: var(--text-muted);">
						{artwork.date_display}
					</p>
				{/if}
			</div>
		{/if}

		<!-- palette swatches -->
		<div class="mb-6">
			<div class="flex overflow-hidden rounded-lg" style="box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
				{#each colors as color}
					<button
						onclick={() => copyColor(color.hex)}
						class="group relative flex-1 cursor-pointer"
						title="copy {color.hex}"
					>
						<div
							class="flex h-20 items-end justify-center pb-2 sm:h-28"
							style="background-color: {color.hex};"
						>
							<span
								class="font-mono text-[10px] opacity-0 transition-opacity group-hover:opacity-100 sm:text-xs"
								style="color: {contrastText(color.hex)};"
							>
								{copiedHex === color.hex ? 'copied' : color.hex}
							</span>
						</div>
					</button>
				{/each}
			</div>

			<!-- color names if present -->
			{#if colors.some(c => c.name)}
				<div class="mt-2 flex">
					{#each colors as color}
						<div class="flex-1 text-center">
							<span class="text-[9px] italic sm:text-[10px]" style="color: var(--text-muted);">
								{color.name || ''}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- export + info -->
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-xs" style="color: var(--text-muted);">
				{palette.count} colors · {palette.mode}
			</span>
			<span style="color: var(--border);">·</span>
			{#each ['json', 'css', 'png', 'ase'] as fmt}
				<button
					onclick={() => handleExport(fmt)}
					class="rounded-md border px-2.5 py-1.5 text-xs uppercase tracking-wider cursor-pointer"
					style="border-color: var(--border); color: var(--text-secondary);"
					onmouseenter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
					onmouseleave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
				>
					{fmt === 'ase' ? '.ase' : fmt}
				</button>
			{/each}
		</div>
	</main>
</div>
