<!--
  Shared Palette View — displays a saved palette via its UUID short link.
  Dark gallery aesthetic matching the main page.
-->

<script lang="ts">
	import { getImageUrl } from '$lib/api/artic';
	import { exportJson, exportCss, exportPng, exportAse, downloadFile } from '$lib/export/palette';
	import type { ExtractedColor } from '$lib/colors/extraction';

	let { data } = $props();
	let { artwork, palette } = $derived(data);
	let colors: ExtractedColor[] = $derived(palette.colors);
	const exportFormats = ['json', 'css', 'png', 'ase'] as const;

	let copiedHex = $state('');
	let copyStatus = $state('');
	let accentColor = $derived('#b8a080'); // static on shared page since we don't extract colors
	let imageUnavailable = $state(false);
	$effect(() => { artwork?.image_id; imageUnavailable = false; });

	function fallbackImage(event: Event) {
		const img = event.currentTarget;
		if (!(img instanceof HTMLImageElement)) return;
		if (img.src.startsWith('https://www.artic.edu/iiif/')) {
			img.src = `/api/image?${new URLSearchParams({ url: img.src })}`;
		} else imageUnavailable = true;
	}

	function brightenBorder(e: MouseEvent) {
		(e.currentTarget as HTMLElement).style.borderColor = accentColor;
	}
	function resetBorder(e: MouseEvent) {
		(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
	}

	async function copyColor(hex: string) {
		copiedHex = '';
		copyStatus = '';
		try {
			await navigator.clipboard.writeText(hex);
			copiedHex = hex;
			setTimeout(() => copiedHex = '', 1500);
		} catch { copyStatus = `Clipboard unavailable. Select and copy ${hex}.`; }
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
				onmouseenter={(e) => e.currentTarget.style.color = accentColor}
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
				{#if artwork.image_id && !imageUnavailable}
					<img
						src={getImageUrl(artwork.image_id, 'large')}
						onerror={fallbackImage}
						alt={artwork.thumbnail?.alt_text || artwork.title}
						class="artwork-image w-full rounded-lg sm:w-auto sm:max-h-[65vh]"
						style="box-shadow: 0 8px 30px rgba(0,0,0,0.4);"
					/>
				{:else}
					<p role="status" class="text-sm">Artwork image is unavailable. Your saved palette is still available below.</p>
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
						class="group relative min-w-0 flex-1 cursor-pointer"
						title="copy {color.hex}"
					>
						<div
							class="flex h-20 items-end justify-center pb-2 sm:h-28"
							style="background-color: {color.hex};"
						>
							<span
								class="max-w-full truncate font-mono text-[10px] opacity-0 transition-opacity group-hover:opacity-100 sm:text-xs"
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
						<div class="min-w-0 flex-1 break-words text-center">
							<span class="text-[9px] italic sm:text-[10px]" style="color: var(--text-muted);">
								{color.name || ''}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- export + info -->
		{#if copyStatus}<p role="status" class="mb-4 text-sm" style="user-select: text;">{copyStatus}</p>{/if}
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-xs" style="color: var(--text-muted);">
				{palette.count} colors · {palette.mode}
			</span>
			<span style="color: var(--border);">·</span>
			{#each exportFormats as fmt}
				<button
					onclick={() => handleExport(fmt)}
					class="rounded-md border px-2.5 py-1.5 text-xs uppercase tracking-wider cursor-pointer"
					style="border-color: var(--border); color: var(--text-secondary);"
					onmouseenter={brightenBorder}
					onmouseleave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
				>
					{fmt === 'ase' ? '.ase' : fmt}
				</button>
			{/each}
		</div>
	</main>
</div>
