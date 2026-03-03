<!--
  Main Page — Art Institute Color Palette Generator

  Dark gallery aesthetic — artwork is the star, ui stays out of the way.
  Mobile-first: stacked on small screens, sidebar on lg+.
-->

<script lang="ts">
    import { onMount } from "svelte";
    import { tick } from "svelte";
    import {
        searchArtworks,
        getRandomArtwork,
        getImageUrl,
        type Artwork,
    } from "$lib/api/artic";
    import {
        extractColors,
        type ExtractedColor,
        type ExtractionMode,
    } from "$lib/colors/extraction";
    import {
        exportJson,
        exportCss,
        exportPng,
        exportAse,
        downloadFile,
    } from "$lib/export/palette";

    // ── reactive state ──

    let artwork = $state<Artwork | null>(null);
    let colors = $state<ExtractedColor[]>([]);
    let loading = $state(false);
    let searchQuery = $state("");
    let colorCount = $state(5);
    let extractionMode = $state<ExtractionMode>("dominant");
    let shareStatus = $state("");
    let aiDescription = $state("");
    let aiLoading = $state(false);
    let copiedHex = $state("");

    // ── derived: pick the most vibrant color as the dynamic accent ──
    let accentColor = $derived.by(() => {
        if (colors.length === 0) return "#b8a080"; // fallback warm accent
        // sort by saturation, pick the most vivid
        const sorted = [...colors].sort((a, b) => b.hsl.s - a.hsl.s);
        return sorted[0].hex;
    });

    // ── derived: lighter version for backgrounds ──
    let accentSubtle = $derived.by(() => {
        // convert to rgba with low opacity
        const hex = accentColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, 0.15)`;
    });

    // ── lifecycle ──

    onMount(async () => {
        await loadRandom();
    });

    // ── hover handlers (inline multiple statements don't work in Svelte 5 SSR) ──
    function brightenBg(e: MouseEvent) {
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = accentColor;
        target.style.filter = "brightness(1.1)";
    }
    function resetBg(e: MouseEvent) {
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = accentColor;
        target.style.filter = "none";
    }
    function brightenBorder(e: MouseEvent) {
        (e.currentTarget as HTMLElement).style.borderColor = accentColor;
    }
    function resetBorder(e: MouseEvent) {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
    }
    function setSubtleBg(e: MouseEvent) {
        (e.currentTarget as HTMLElement).style.backgroundColor = accentSubtle;
    }
    function clearSubtleBg(e: MouseEvent) {
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor =
            copiedHex && target.dataset.hex === copiedHex
                ? accentSubtle
                : "transparent";
    }

    // ── data loading ──

    async function loadRandom() {
        loading = true;
        aiDescription = "";
        // Always start with dominant mode on new artwork — tone requires explicit selection
        extractionMode = "dominant";
        try {
            for (let i = 0; i < 10; i++) {
                artwork = await getRandomArtwork();
                if (artwork?.image_id) {
                    await tick();
                    const extracted = await extractColors(
                        getImageUrl(artwork.image_id, "large"),
                        extractionMode,
                        colorCount,
                    );
                    if (extracted.length > 0) {
                        colors = extracted;
                        break;
                    }
                    console.warn(
                        `Image for "${artwork.title}" not accessible, trying another...`,
                    );
                }
            }
        } catch (e) {
            console.error("Failed to load artwork:", e);
        }
        loading = false;
    }

    async function handleSearch() {
        if (!searchQuery.trim()) return;
        loading = true;
        aiDescription = "";
        extractionMode = "dominant";
        try {
            const result = await searchArtworks({ q: searchQuery, limit: 10 });
            for (const a of result.data) {
                if (a.image_id) {
                    artwork = a;
                    await tick();
                    const extracted = await extractColors(
                        getImageUrl(artwork.image_id, "large"),
                        extractionMode,
                        colorCount,
                    );
                    if (extracted.length > 0) {
                        colors = extracted;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error("Search failed:", e);
        }
        loading = false;
    }

    async function regeneratePalette() {
        if (!artwork?.image_id) return;
        if (extractionMode === "ai") {
            await fetchAiPalette();
        } else {
            aiDescription = "";
            colors = await extractColors(
                getImageUrl(artwork.image_id, "large"),
                extractionMode,
                colorCount,
            );
        }
    }

    async function fetchAiPalette() {
        if (!artwork?.image_id) return;
        aiLoading = true;
        try {
            const res = await fetch("/api/ai-palette", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    imageUrl: getImageUrl(artwork.image_id, "medium"),
                    count: colorCount,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                aiDescription =
                    data.error || "Failed to generate palette. Try again.";
                return;
            }
            colors = data.colors;
            aiDescription = data.description;
        } catch (e) {
            console.error("Tone palette failed:", e);
            aiDescription = "Failed to generate palette. Try again.";
        } finally {
            aiLoading = false;
        }
    }

    // ── user actions ──

    function copyColor(hex: string) {
        navigator.clipboard.writeText(hex);
        copiedHex = hex;
        setTimeout(() => (copiedHex = ""), 1500);
    }

    async function handleShare() {
        if (!artwork || colors.length === 0) return;
        try {
            const res = await fetch("/api/palette", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    artworkId: artwork.id,
                    colors,
                    mode: extractionMode,
                    count: colorCount,
                }),
            });
            if (!res.ok) throw new Error("Failed to save");
            const { url } = await res.json();

            // Mobile: use Web Share API, Desktop: use clipboard
            const isMobile = 'ontouchstart' in window && navigator.share;
            if (isMobile) {
                await navigator.share({ title: "Chroma Collection", url });
                shareStatus = "shared";
            } else {
                await navigator.clipboard.writeText(url);
                shareStatus = "link copied";
            }
            setTimeout(() => (shareStatus = ""), 3000);
        } catch (e) {
            console.error("Share failed:", e);
            shareStatus = "failed to share";
            setTimeout(() => (shareStatus = ""), 3000);
        }
    }

    async function handleExport(format: "json" | "css" | "png" | "ase") {
        if (colors.length === 0) return;
        switch (format) {
            case "json":
                downloadFile(exportJson(colors), `palette-${artwork?.id}.json`);
                break;
            case "css":
                downloadFile(exportCss(colors), `palette-${artwork?.id}.css`);
                break;
            case "png":
                const png = await exportPng(colors);
                downloadFile(png, `palette-${artwork?.id}.png`);
                break;
            case "ase":
                const ase = exportAse(colors);
                downloadFile(ase, `palette-${artwork?.id}.ase`);
                break;
        }
    }

    /**
     * Returns appropriate text color (white or black) for readability
     * against a given background hex color.
     */
    function contrastText(hex: string): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? "#1a1a1a" : "#f0f0f0";
    }
</script>

<!-- ── layout ── -->

<div
    class="min-h-screen"
    style="background-color: var(--bg-primary); color: var(--text-primary);"
>
    <!-- header — thin, unobtrusive -->
    <header
        class="border-b px-4 py-3 sm:px-6"
        style="border-color: var(--border); background-color: var(--bg-secondary);"
    >
        <div class="mx-auto flex max-w-screen-2xl items-center justify-between">
            <h1
                class="text-sm font-light tracking-widest uppercase"
                style="color: var(--text-secondary);"
            >
                chroma collection · aic palette gen
            </h1>
            <p
                class="hidden text-xs sm:block"
                style="color: var(--text-muted);"
            >
                art institute of chicago
            </p>
        </div>
    </header>

    <main class="mx-auto flex max-w-screen-2xl flex-col lg:flex-row">
        <!-- ── controls ── -->
        <aside
            class="order-1 border-b p-4 sm:p-5 lg:order-2 lg:w-72 lg:border-b-0 lg:border-l"
            style="border-color: var(--border); background-color: var(--bg-secondary);"
        >
            <!-- search -->
            <form
                onsubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                }}
                class="mb-5 flex gap-2"
            >
                <input
                    type="text"
                    bind:value={searchQuery}
                    placeholder="search artworks..."
                    class="min-w-0 flex-1 rounded-md px-3 py-2 text-sm"
                    style="border: 1px solid var(--border);"
                />
                <button
                    type="submit"
                    class="shrink-0 rounded-md px-3 py-2 text-sm cursor-pointer"
                    style="background-color: {accentColor}; color: var(--bg-primary);"
                    onmouseenter={brightenBg}
                    onmouseleave={resetBg}
                >
                    search
                </button>
            </form>

            <!-- controls row -->
            <div class="mb-5 flex items-center gap-2">
                <button
                    onclick={loadRandom}
                    class="shrink-0 rounded-md border px-3 py-2 text-sm cursor-pointer"
                    style="border-color: var(--border); color: var(--text-secondary);"
                    onmouseenter={brightenBorder}
                    onmouseleave={resetBorder}
                >
                    random
                </button>

                <select
                    bind:value={colorCount}
                    onchange={regeneratePalette}
                    class="rounded-md px-2 py-2 text-sm cursor-pointer"
                    style="border: 1px solid var(--border);"
                >
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                    <option value={7}>7</option>
                    <option value={8}>8</option>
                </select>

                <select
                    bind:value={extractionMode}
                    onchange={regeneratePalette}
                    class="rounded-md px-2 py-2 text-sm cursor-pointer"
                    style="border: 1px solid var(--border);"
                >
                    <option value="dominant">dominant</option>
                    <option value="vibrant">vibrant</option>
                    <option value="ai">tone</option>
                </select>
            </div>

            <!-- share + export (desktop sidebar) -->
            {#if colors.length > 0}
                <div class="hidden lg:block">
                    <div class="mb-5">
                        <button
                            onclick={handleShare}
                            class="w-full rounded-md py-2.5 text-sm font-medium cursor-pointer"
                            style="background-color: {accentColor}; color: var(--bg-primary);"
                            onmouseenter={brightenBg}
                            onmouseleave={resetBg}
                        >
                            share palette
                        </button>
                        {#if shareStatus}
                            <p
                                class="mt-2 text-center text-xs"
                                style="color: var(--text-muted);"
                            >
                                {shareStatus}
                            </p>
                        {/if}
                    </div>

                    <div>
                        <h3
                            class="mb-3 text-xs font-medium tracking-wider uppercase"
                            style="color: var(--text-muted);"
                        >
                            export
                        </h3>
                        <div class="grid grid-cols-2 gap-2">
                            {#each ["json", "css", "png", "ase"] as fmt}
                                <button
                                    onclick={() => handleExport(fmt)}
                                    class="rounded-md border py-2 text-xs uppercase tracking-wider cursor-pointer"
                                    style="border-color: var(--border); color: var(--text-secondary);"
                                    onmouseenter={brightenBorder}
                                    onmouseleave={resetBorder}
                                >
                                    {fmt === "ase" ? ".ase" : fmt}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- color list with details -->
                    {#if colors.length > 0}
                        <div class="mt-6">
                            <h3
                                class="mb-3 text-xs font-medium tracking-wider uppercase"
                                style="color: var(--text-muted);"
                            >
                                colors
                            </h3>
                            <div class="space-y-1.5">
                                {#each colors as color}
                                    <button
                                        onclick={() => copyColor(color.hex)}
                                        class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 cursor-pointer"
                                        style="background-color: {copiedHex ===
                                        color.hex
                                            ? accentSubtle
                                            : 'transparent'};"
                                        onmouseenter={setSubtleBg}
                                        onmouseleave={clearSubtleBg}
                                    >
                                        <div
                                            class="h-6 w-6 shrink-0 rounded"
                                            style="background-color: {color.hex};"
                                        ></div>
                                        <span
                                            class="font-mono text-xs"
                                            style="color: var(--text-secondary);"
                                        >
                                            {color.hex}
                                        </span>
                                        {#if color.name}
                                            <span
                                                class="ml-auto truncate text-xs italic"
                                                style="color: var(--text-muted);"
                                            >
                                                {color.name}
                                            </span>
                                        {/if}
                                        {#if copiedHex === color.hex}
                                            <span
                                                class="text-xs"
                                                style="color: {accentColor};"
                                                >copied</span
                                            >
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </aside>

        <!-- ── artwork + palette ── -->
        <section class="order-2 flex-1 p-4 sm:p-6 lg:order-1 lg:p-8">
            {#if loading}
                <div class="flex h-64 items-center justify-center sm:h-96">
                    <div class="flex flex-col items-center gap-3">
                        <div
                            class="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
                            style="border-color: var(--text-muted); border-top-color: transparent;"
                        ></div>
                        <span class="text-sm" style="color: var(--text-muted);"
                            >loading...</span
                        >
                    </div>
                </div>
            {:else if artwork}
                <!-- artwork image -->
                <div class="mb-6 sm:mb-8">
                    {#if artwork.image_id}
                        <img
                            crossorigin="anonymous"
                            src={getImageUrl(artwork.image_id, "large")}
                            alt={artwork.thumbnail?.alt_text || artwork.title}
                            class="artwork-image w-full rounded-lg sm:w-auto sm:max-h-[65vh]"
                            style="box-shadow: 0 8px 30px rgba(0,0,0,0.4);"
                        />
                    {:else}
                        <div
                            class="flex h-48 items-center justify-center rounded-lg sm:h-96"
                            style="background-color: var(--bg-surface);"
                        >
                            <span style="color: var(--text-muted);"
                                >no image available</span
                            >
                        </div>
                    {/if}
                </div>

                <!-- artwork metadata — museum label style -->
                <div class="mb-6 sm:mb-8">
                    <h2
                        class="text-lg font-normal italic sm:text-xl"
                        style="color: var(--text-primary);"
                    >
                        {artwork.title}
                    </h2>
                    <p
                        class="mt-1 text-sm"
                        style="color: var(--text-secondary);"
                    >
                        {artwork.artist_display}
                    </p>
                    {#if artwork.date_display}
                        <p
                            class="mt-0.5 text-xs"
                            style="color: var(--text-muted);"
                        >
                            {artwork.date_display}
                        </p>
                    {/if}
                </div>

                <!-- ai loading -->
                {#if aiLoading}
                    <div
                        class="mb-6 rounded-lg p-4"
                        style="background-color: var(--bg-surface); border: 1px solid var(--border);"
                    >
                        <span
                            class="text-sm italic"
                            style="color: var(--text-muted);"
                            >analyzing mood...</span
                        >
                    </div>
                {/if}

                <!-- ai mood description -->
                {#if aiDescription && !aiLoading}
                    <div
                        class="mb-6 rounded-lg p-4"
                        style="background-color: var(--bg-surface); border: 1px solid var(--border);"
                    >
                        <p
                            class="text-sm italic leading-relaxed"
                            style="color: var(--text-secondary);"
                        >
                            {aiDescription}
                        </p>
                    </div>
                {/if}

                <!-- ── color palette swatches ── -->
                {#if colors.length > 0 && !aiLoading}
                    <div class="mb-6">
                        <!-- tall swatch strip — like paint chips -->
                        <div
                            class="flex overflow-hidden rounded-lg"
                            style="box-shadow: 0 4px 20px rgba(0,0,0,0.3);"
                        >
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
                                        <!-- hex label on the swatch itself -->
                                        <span
                                            class="font-mono text-[10px] opacity-0 transition-opacity group-hover:opacity-100 sm:text-xs"
                                            style="color: {contrastText(
                                                color.hex,
                                            )};"
                                        >
                                            {copiedHex === color.hex
                                                ? "copied"
                                                : color.hex}
                                        </span>
                                    </div>
                                </button>
                            {/each}
                        </div>

                        <!-- color names (tone mode) -->
                        {#if colors.some((c) => c.name)}
                            <div class="mt-2 flex">
                                {#each colors as color}
                                    <div class="flex-1 text-center">
                                        <span
                                            class="text-[9px] italic sm:text-[10px]"
                                            style="color: var(--text-muted);"
                                        >
                                            {color.name || ""}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- share + export (mobile) -->
                    <div class="flex flex-wrap items-center gap-2 lg:hidden">
                        <button
                            onclick={handleShare}
                            class="rounded-md px-3 py-1.5 text-sm cursor-pointer"
                            style="background-color: {accentColor}; color: var(--bg-primary);"
                        >
                            share
                        </button>
                        {#if shareStatus}
                            <span
                                class="text-xs"
                                style="color: var(--text-muted);"
                                >{shareStatus}</span
                            >
                        {/if}
                        <span style="color: var(--border);">·</span>
                        {#each ["json", "css", "png", "ase"] as fmt}
                            <button
                                onclick={() => handleExport(fmt)}
                                class="rounded-md border px-2.5 py-1.5 text-xs uppercase cursor-pointer"
                                style="border-color: var(--border); color: var(--text-secondary);"
                            >
                                {fmt === "ase" ? ".ase" : fmt}
                            </button>
                        {/each}
                    </div>
                {/if}
            {/if}
        </section>
    </main>
</div>
