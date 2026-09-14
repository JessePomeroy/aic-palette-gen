<!--
  Main Page — Art Institute Color Palette Generator

  Dark gallery aesthetic — artwork is the star, ui stays out of the way.
  Viewport-sized workbench with mobile sheets and desktop drawers.
-->

<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import {
        searchArtworks,
        getRandomArtwork,
        getImageUrl,
        getArtworkUrl,
        type SearchParams,
        type Artwork,
    } from "$lib/api/artic";
    import {
        extractColors,
        fetchImageBlob,
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
    import { exportArtworkCard } from '$lib/export/artwork-card';
    import { exportCard } from '$lib/export/card';
    import { pullToDismiss } from '$lib/interactions/pull-to-dismiss';
    import { applyLocks, readableText, suggestTextColor } from '$lib/colors/workbench';
    import { createIndexedSearch } from '$lib/colors/indexed-search';
    import { HISTORY_KEY, parseHistory, rememberPalette, type RecentPalette } from '$lib/history';
    import PaletteEditor from '$lib/components/PaletteEditor.svelte';
    import ArtworkCard from '$lib/components/ArtworkCard.svelte';
    import ContrastChecker from '$lib/components/ContrastChecker.svelte';
    import ModeComparison, { type PaletteVariant } from '$lib/components/ModeComparison.svelte';

    type WorkbenchPanel = 'search' | 'palette' | 'history' | 'save' | 'artwork';
    const panelTitles = { search: 'Find artwork', palette: 'Palette tools', history: 'Recent palettes', save: 'Save & share', artwork: 'About this artwork' };
    const toolPanels = [{ id: 'search', label: 'Search' }, { id: 'palette', label: 'Palette' }, { id: 'history', label: 'History' }, { id: 'save', label: 'Save & share' }] as const;
    let mobile = $state(false);
    let activePanel = $state<WorkbenchPanel>('search');
    let toolDialog = $state<HTMLDialogElement>();
    let panelOpen = $state(false);
    let closingSheet = false;
    async function openPanel(panel: WorkbenchPanel) {
        const wasOpen = toolDialog?.open;
        activePanel = panel;
        await tick();
        toolDialog?.querySelector('.workbench-sheet-content')?.scrollTo(0, 0);
        toolDialog?.showModal();
        panelOpen = true;
        if (wasOpen) toolDialog?.querySelector<HTMLElement>('.workbench-sheet-content input, .workbench-sheet-content button')?.focus();
        if (panel === 'palette') void compareModes();
    }
    async function closePanel() {
        const dialog = toolDialog;
        if (!dialog?.open || closingSheet) return;
        closingSheet = true;
        const styles = getComputedStyle(dialog);
        const animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? undefined
            : dialog.animate([{ transform: styles.transform }, { transform: styles.getPropertyValue('--panel-closed-transform').trim() }],
                { duration: 180, easing: 'ease-in', fill: 'forwards' });
        try { await animation?.finished; }
        catch { /* A viewport change can remove the sheet mid-animation. */ }
        finally {
            dialog.close();
            animation?.cancel();
            closingSheet = false;
        }
    }
    function sheetBackdrop(node: HTMLDialogElement) {
        let startedOutside = false;
        const outside = (event: PointerEvent) => {
            const bounds = node.getBoundingClientRect();
            return event.clientX < bounds.left || event.clientX > bounds.right
                || event.clientY < bounds.top || event.clientY > bounds.bottom;
        };
        const down = (event: PointerEvent) => { startedOutside = event.target === node && outside(event); };
        const up = (event: PointerEvent) => {
            if (startedOutside && event.target === node && outside(event)) void closePanel();
            startedOutside = false;
        };
        node.addEventListener('pointerdown', down);
        node.addEventListener('pointerup', up);
        return { destroy() { node.removeEventListener('pointerdown', down); node.removeEventListener('pointerup', up); } };
    }
    onMount(() => {
        const query = window.matchMedia('(max-width: 1023px)');
        const update = () => {
            if (mobile !== query.matches) toolDialog?.close();
            mobile = query.matches;
        };
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    });

    // ── reactive state ──

    let artwork = $state<Artwork | null>(null);
    let colors = $state<ExtractedColor[]>([]);
    let loading = $state(false);
    let searchQuery = $state("");
    let searchResults = $state<Artwork[]>([]);
    let showResults = $state(false);
    let colorCount = $state(5);
    let extractionMode = $state<ExtractionMode>("dominant");
    let shareStatus = $state("");
    let sharing = $state(false);
    let shareUrl = $state('');
    let shareRequest = 0;
    let aiDescription = $state("");
    let aiLoading = $state(false);
    let copiedHex = $state("");
    let copyStatus = $state("");
    let paletteError = $state("");
    let paletteLoading = $state(false);
    let artworkRequest = 0;
    let matchController: AbortController | undefined;
    let matching = $state(false);
    let matchStatus = $state('');
    let indexedCount = $state(0);
    const indexedSearch = createIndexedSearch();
    let paletteRequest = 0;
    const exportFormats = ["json", "css", "png", "ase"] as const;
    let locks = $state<(ExtractedColor | null)[]>([]);
    let variants = $state<Partial<Record<ExtractionMode, PaletteVariant>>>({});
    let comparisonBusy = $state(false);
    let comparisonError = $state('');
    let comparisonRequest = 0;
    let recent = $state<RecentPalette[]>([]);
    let historyStatus = $state('');
    let cardBusy = $state(false);
    let cardStatus = $state('');
    let cardFormat = $state<'classic' | 'card'>('classic');
    let artistFilter = $state('');
    let mediumFilter = $state('');
    let periodFilter = $state('');
    let publicDomain = $state(false);
    let searchBusy = $state(false);
    let searchStatus = $state('');
    let searchPage = $state(1);
    let searchTotal = $state(0);
    let activeSearch: SearchParams = {};
    let searchRequest = 0;
    let busy = $derived(loading || matching || paletteLoading || aiLoading || comparisonBusy);
    let minimumCount = $derived(Math.max(5, locks.findLastIndex(Boolean) + 1));
    const periods = [
        { value: '', label: 'Any period' },
        { value: '-5000:1799', label: 'Before 1800' },
        { value: '1800:1899', label: '1800–1899' },
        { value: '1900:1949', label: '1900–1949' },
        { value: '1950:2026', label: '1950–present' }
    ];

    // ── derived: pick the most vibrant color as the dynamic accent ──
    let accentColor = $derived.by(() => {
        if (colors.length === 0) return "#b8a080"; // fallback warm accent
        // sort by saturation, pick the most vivid
        const sorted = [...colors].sort((a, b) => b.hsl.s - a.hsl.s);
        return sorted[0].hex;
    });
    // Focus and hover accents must stay visible against the lightest dark UI surface.
    let accentFocus = $derived(suggestTextColor(accentColor, '#222222'));

    // ── lifecycle ──

    onMount(async () => {
        try { recent = parseHistory(localStorage.getItem(HISTORY_KEY)); }
        catch { historyStatus = 'History is available for this session only.'; }
        await loadRandom();
    });
    onDestroy(() => matchController?.abort());

    function cancelMatch() {
        ++artworkRequest;
        matchController?.abort();
        matchController = undefined;
        matching = false;
        matchStatus = '';
    }

    function saveRecent() {
        if (!artwork || colors.length < 5) return;
        recent = rememberPalette(recent, { artwork, colors, locks, mode: extractionMode, description: aiDescription });
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(recent)); historyStatus = ''; }
        catch { historyStatus = 'History is available for this session only.'; }
    }

    function invalidateShare() {
        ++shareRequest;
        sharing = false;
        shareStatus = '';
        shareUrl = '';
    }

    function resetPalette() {
        invalidateShare();
        ++paletteRequest;
        ++comparisonRequest;
        colors = [];
        // Locks belong to the palette workbench, not the current artwork.
        variants = {};
        comparisonBusy = false;
        comparisonError = '';
        paletteLoading = false;
        aiLoading = false;
        aiDescription = '';
        paletteError = '';
        cardStatus = '';
    }

    function restoreRecent(entry: RecentPalette) {
        toolDialog?.close();
        cancelMatch();
        resetPalette();
        loading = false;
        artwork = entry.artwork;
        colors = entry.colors;
        locks = entry.locks;
        colorCount = entry.colors.length;
        extractionMode = entry.mode;
        aiDescription = entry.description;
        showResults = false;
        saveRecent();
    }

    function clearHistory() {
        recent = [];
        try { localStorage.removeItem(HISTORY_KEY); historyStatus = 'History cleared.'; }
        catch { historyStatus = 'Could not clear browser storage; this session’s history was cleared.'; }
    }

    function toggleLock(index: number) {
        locks = colors.map((_, i) => i === index ? (locks[i] ? null : colors[i]) : locks[i] ?? null);
        saveRecent();
    }

    function acceptPalette(mode: ExtractionMode, variant: PaletteVariant) {
        invalidateShare();
        variants = { ...variants, [mode]: variant };
        colors = applyLocks(variant.colors, locks, colorCount);
        aiDescription = variant.description;
        saveRecent();
    }

    function useVariant(mode: ExtractionMode) {
        const variant = variants[mode];
        if (!variant || busy) return;
        extractionMode = mode;
        paletteError = '';
        acceptPalette(mode, variant);
    }

    async function countChanged() {
        variants = {};
        locks = locks.slice(0, colorCount);
        await regeneratePalette();
    }

    async function generateTone(imageId: string, count: number, stillCurrent: () => boolean, nativeWidth?: number): Promise<PaletteVariant> {
        const image = await fetchImageBlob(getImageUrl(imageId, 'medium', nativeWidth));
        if (!stillCurrent()) throw new Error('Selection changed.');
        const res = await fetch(`/api/ai-palette?count=${count}`, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not generate tone. Try again.');
        if (!Array.isArray(data.colors) || data.colors.length !== count || !data.colors.every((c: ExtractedColor) => /^#[0-9a-f]{6}$/i.test(c.hex))) throw new Error('Tone returned an incomplete palette. Please try again.');
        return { colors: data.colors, description: data.description || '' };
    }

    async function compareModes(tone = false) {
        if (!artwork?.image_id || busy) return;
        const request = ++comparisonRequest;
        const imageId = artwork.image_id;
        const count = colorCount;
        const nativeWidth = artwork.thumbnail?.width;
        comparisonBusy = true;
        comparisonError = '';
        try {
            if (tone) {
                const variant = await generateTone(imageId, count, () => request === comparisonRequest, nativeWidth);
                if (request === comparisonRequest) variants = { ...variants, ai: variant };
            } else {
                for (const mode of ['dominant', 'vibrant'] as const) {
                    if (variants[mode]) continue;
                    const result = await extractColors(getImageUrl(imageId, 'large', nativeWidth), mode, count);
                    if (request !== comparisonRequest) return;
                    if (!result.length) throw new Error('Could not compare these palettes. Please try again.');
                    variants = { ...variants, [mode]: { colors: result, description: '' } };
                }
            }
        } catch (error) {
            if (request === comparisonRequest) comparisonError = error instanceof Error ? error.message : 'Comparison failed.';
        } finally {
            if (request === comparisonRequest) comparisonBusy = false;
        }
    }

    async function downloadCard() {
        if (!artwork || !colors.length || cardBusy) return;
        const selected = artwork;
        const palette = [...colors];
        const format = cardFormat;
        cardBusy = true;
        cardStatus = '';
        try {
            const blob = await (format === 'card' ? exportCard : exportArtworkCard)(selected, palette);
            downloadFile(blob, `chroma-${selected.id}-${format === 'card' ? 'card' : 'artwork-card'}.png`);
            cardStatus = format === 'card' ? 'Card downloaded.' : 'Artwork card downloaded.';
        } catch { cardStatus = 'Could not create the artwork card. Please try again.'; }
        finally { cardBusy = false; }
    }

    // ── data loading ──

    async function loadRandom() {
        if (busy) return;
        cancelMatch();
        const request = ++artworkRequest;
        const lockedHexes = locks.flatMap(color => color ? [color.hex] : []);
        if (lockedHexes.length) {
            matchController = new AbortController();
            const signal = AbortSignal.any([matchController.signal, AbortSignal.timeout(30000)]);
            matching = true;
            matchStatus = 'Finding a match…';
            try {
                const result = await indexedSearch.search(lockedHexes, {
                    signal,
                    currentArtworkId: artwork?.id,
                    seenArtworkIds: recent.map(entry => entry.artwork.id),
                    onIndexReady: count => {
                        if (request !== artworkRequest) return;
                        indexedCount = count;
                    },
                });
                if (request !== artworkRequest) return;
                if (result.status === 'no-match') {
                    matchStatus = `No other close match in the ${result.indexedCount}-artwork index. Your artwork and palette are unchanged.`;
                    return;
                }
                if (result.status === 'incomplete') {
                    matchStatus = result.reason === 'unavailable'
                        ? 'Some color-index data could not be loaded. Your artwork and palette are unchanged. Please try again.'
                        : 'The color-index check is incomplete. Your artwork and palette are unchanged. Please try again.';
                    return;
                }
                matching = false;
                matchController = undefined;
                resetPalette();
                artwork = result.artwork;
                extractionMode = 'dominant';
                matchStatus = '';
                await regeneratePalette();
            } catch {
                if (request === artworkRequest) matchStatus = signal.aborted
                    ? 'The color-index search timed out. Your artwork and palette are unchanged. Please try again.'
                    : 'The color index is unavailable. Your artwork and palette are unchanged. Please try again.';
            } finally {
                if (request === artworkRequest) { matching = false; matchController = undefined; }
            }
            return;
        }
        resetPalette();
        loading = true;
        // Always start with dominant mode on new artwork — tone requires explicit selection
        extractionMode = "dominant";
        try {
            for (let i = 0; i < 10; i++) {
                const candidate = await getRandomArtwork();
                if (request !== artworkRequest) return;
                if (candidate?.image_id) {
                    artwork = candidate;
                    loading = false;
                    await regeneratePalette();
                    return;
                }
            }
        } catch (e) {
            console.error("Failed to load artwork:", e);
        } finally {
            if (request === artworkRequest) loading = false;
        }
    }

    async function handleSearch() {
        const years = periodFilter ? periodFilter.split(':').map(Number) : [];
        activeSearch = { q: searchQuery, artist: artistFilter, medium: mediumFilter, publicDomain,
            fromYear: years[0], toYear: years[1] };
        await runSearch(1);
    }

    async function runSearch(page: number) {
        const request = ++searchRequest;
        searchBusy = true;
        searchStatus = '';
        showResults = true;
        try {
            const result = await searchArtworks({ ...activeSearch, page, limit: 12 });
            if (request !== searchRequest) return;
            searchResults = result.data.filter(a => a.image_id);
            searchPage = page;
            searchTotal = result.pagination.total;
            if (!searchResults.length) searchStatus = 'No artworks match. Try a broader search or clear your filters.';
        } catch {
            if (request === searchRequest) { searchResults = []; searchStatus = 'Search is unavailable. Please try again.'; }
        } finally {
            if (request === searchRequest) searchBusy = false;
        }
    }

    async function moreLikeThis() {
        if (!artwork) return;
        await openPanel('search');
        searchQuery = '';
        artistFilter = artwork.artist_id ? artwork.artist_title || '' : '';
        mediumFilter = artwork.artist_id ? '' : artwork.medium_display || '';
        periodFilter = '';
        activeSearch = artwork.artist_id ? { artistId: artwork.artist_id, excludeId: artwork.id, publicDomain }
            : { medium: mediumFilter, excludeId: artwork.id, publicDomain };
        await runSearch(1);
    }

    async function selectResult(a: Artwork) {
        toolDialog?.close();
        cancelMatch();
        resetPalette();
        showResults = false;
        searchQuery = "";
        loading = true;
        colors = [];
        aiDescription = "";
        extractionMode = "dominant";
        artwork = a;
        // Do not hide the selected artwork while its palette is generated.
        loading = false;
        await regeneratePalette();
    }

    function closeResults() {
        ++searchRequest;
        searchBusy = false;
        showResults = false;
    }

    function fallbackImage(event: Event) {
        const img = event.currentTarget;
        if (img instanceof HTMLImageElement && img.src.startsWith('https://www.artic.edu/iiif/')) {
            img.src = `/api/image?${new URLSearchParams({ url: img.src })}`;
        }
    }

    async function regeneratePalette() {
        // Invalidate before awaiting extraction: a previous save may finish meanwhile.
        invalidateShare();
        const request = ++paletteRequest;
        paletteError = "";
        paletteLoading = false;
        aiLoading = false;
        if (!artwork?.image_id) return;
        if (extractionMode === "ai") {
            await fetchAiPalette(request);
        } else {
            aiDescription = "";
            paletteLoading = true;
            const extracted = await extractColors(
                getImageUrl(artwork.image_id, "large", artwork.thumbnail?.width),
                extractionMode,
                colorCount,
            );
            if (request !== paletteRequest) return;
            if (extracted.length) acceptPalette(extractionMode, { colors: extracted, description: '' });
            else colors = [];
            paletteLoading = false;
            if (!colors.length) paletteError = "Could not generate this palette. Please try again.";
        }
    }

    async function fetchAiPalette(request: number) {
        if (!artwork?.image_id) return;
        aiLoading = true;
        try {
            const data = await generateTone(artwork.image_id, colorCount, () => request === paletteRequest, artwork.thumbnail?.width);
            if (request !== paletteRequest) return;
            acceptPalette('ai', data);
        } catch (e) {
            if (request !== paletteRequest) return;
            console.error("Tone palette failed:", e);
            paletteError = e instanceof Error ? e.message : 'Tone generation failed. Please try again.';
        } finally {
            if (request === paletteRequest) aiLoading = false;
        }
    }

    // ── user actions ──

    async function copyColor(hex: string) {
        copiedHex = "";
        copyStatus = "";
        try {
            await navigator.clipboard.writeText(hex);
            copiedHex = hex;
            setTimeout(() => (copiedHex = ""), 1500);
        } catch { copyStatus = `Clipboard unavailable. Select and copy ${hex}.`; }
    }

    async function handleShare() {
        if (!artwork || colors.length === 0 || busy || sharing) return;
        const request = ++shareRequest;
        sharing = true;
        shareStatus = 'Saving palette…';
        shareUrl = '';
        try {
            const res = await fetch("/api/palette", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(15000),
                body: JSON.stringify({
                    artworkId: artwork.id,
                    colors,
                    mode: extractionMode,
                    count: colorCount,
                }),
            });
            const data = await res.json();
            if (request !== shareRequest) return;
            if (!res.ok) {
                shareStatus = typeof data.error === 'string' ? data.error : 'Sharing is unavailable. Please try again.';
                return;
            }
            const { url } = data;
            shareUrl = url;

            try {
                if ("ontouchstart" in window && navigator.share) {
                    await navigator.share({ title: "Chroma Collection", url });
                    if (request === shareRequest) shareStatus = "shared";
                } else {
                    await navigator.clipboard.writeText(url);
                    if (request === shareRequest) shareStatus = "link copied";
                }
            } catch {
                if (request === shareRequest) shareStatus = 'Palette saved. Open the link below to share it.';
            }
        } catch {
            if (request === shareRequest) shareStatus = 'Could not save the palette. Your colors are unchanged; please try again.';
        } finally {
            if (request === shareRequest) sharing = false;
        }
    }

    async function handleExport(format: "json" | "css" | "png" | "ase") {
        if (colors.length === 0 || busy) return;
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

</script>

{#snippet discoveryPanel()}
<!-- search -->
            <form
                onsubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                }}
                class="mb-5 flex gap-2"
            >
                <input
                    aria-label="Search artworks"
                    type="text"
                    bind:value={searchQuery}
                    placeholder="search artworks..."
                    class="min-w-0 flex-1 rounded-md px-3 py-2 text-sm"
                    style="border: 1px solid var(--border);"
                />
                <button
                    type="submit"
                    disabled={searchBusy}
                    class="shrink-0 rounded-md px-3 py-2 text-sm cursor-pointer hover:underline"
                    style="background-color: var(--accent); color: var(--accent-foreground);"
                >
                    search
                </button>
            </form>

            <details class="workbench-panel mb-4">
                <summary>Discovery filters</summary>
                <form class="grid gap-3 mt-4" onsubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                    <label class="text-xs grid gap-1">Artist<input aria-label="Filter by artist" bind:value={artistFilter} placeholder="e.g. Claude Monet" /></label>
                    <label class="text-xs grid gap-1">Medium<input aria-label="Filter by medium" bind:value={mediumFilter} placeholder="e.g. oil on canvas" /></label>
                    <label class="text-xs grid gap-1">Period<select aria-label="Filter by period" bind:value={periodFilter}>{#each periods as period}<option value={period.value}>{period.label}</option>{/each}</select></label>
                    <label class="flex gap-2 items-center text-xs"><input type="checkbox" bind:checked={publicDomain} /> Public-domain artworks only</label>
                    <div class="flex gap-2">
                        <button class="tool-button" type="submit" disabled={searchBusy}>Apply filters</button>
                        <button class="tool-button" type="button" onclick={() => { artistFilter = ''; mediumFilter = ''; periodFilter = ''; publicDomain = false; handleSearch(); }}>Clear filters</button>
                    </div>
                </form>
            </details>
            {#if searchBusy}<p role="status" class="text-sm mb-3">Searching the collection…</p>{/if}
            {#if searchStatus}<p role="status" class="text-sm mb-3">{searchStatus}</p>{/if}

            <!-- search results dropdown -->
            {#if showResults && searchResults.length > 0}
                <div
                    class="mb-5 rounded-md border overflow-hidden"
                    style="border-color: var(--border); max-height: 300px; overflow-y: auto;"
                >
                    {#each searchResults as result}
                        <button
                            type="button"
                            onclick={() => selectResult(result)}
                            class="flex w-full items-center gap-3 p-2 text-left hover:opacity-80 transition-opacity"
                            style="border-bottom: 1px solid var(--border);"
                        >
                            {#if result.image_id}
                                <img
                                    src={getImageUrl(result.image_id, "thumb", result.thumbnail?.width)}
                                    onerror={fallbackImage}
                                    alt=""
                                    class="h-10 w-10 object-cover rounded-sm"
                                />
                            {/if}
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm">{result.title}</p>
                                <p
                                    class="truncate text-xs"
                                    style="color: var(--text-secondary);"
                                >
                                    {result.artist_display}
                                </p>
                            </div>
                        </button>
                    {/each}
                </div>
                <div class="flex justify-between items-center gap-2 text-xs mb-3">
                    <button class="tool-button" disabled={searchBusy || searchPage === 1} onclick={() => runSearch(searchPage - 1)}>Previous</button>
                    <span>Page {searchPage} · {searchTotal.toLocaleString()} works</span>
                    <button class="tool-button" disabled={searchBusy || searchPage * 12 >= Math.min(searchTotal, 10000)} onclick={() => runSearch(searchPage + 1)}>Next</button>
                </div>
                <button
                    type="button"
                    onclick={closeResults}
                    class="mb-3 text-xs underline"
                    style="color: var(--text-secondary);"
                >
                    close
                </button>
            {/if}
{/snippet}

{#snippet controlsPanel()}
<!-- controls row -->
            <div class="palette-controls mb-5 flex flex-wrap items-center gap-2">
                <select
                    aria-label="Number of colors"
                    bind:value={colorCount}
                    onchange={countChanged}
                    disabled={busy}
                    class="rounded-md px-2 py-2 text-sm cursor-pointer"
                    style="border: 1px solid var(--border);"
                >
                    {#each [5, 6, 7, 8] as count}<option value={count} disabled={count < minimumCount}>{count} colors</option>{/each}
                </select>

                <select
                    aria-label="Extraction mode"
                    bind:value={extractionMode}
                    onchange={regeneratePalette}
                    disabled={busy}
                    class="rounded-md px-2 py-2 text-sm cursor-pointer"
                    style="border: 1px solid var(--border);"
                >
                    <option value="dominant">dominant</option>
                    <option value="vibrant">vibrant</option>
                    <option value="ai">tone</option>
                </select>
                {#if colors.length}
                    <button class="tool-button palette-regenerate" onclick={regeneratePalette} disabled={busy || locks.filter(Boolean).length === colors.length}>
                        {busy ? 'Generating…' : 'Regenerate unlocked'}
                    </button>
                {/if}
            </div>

            {#if locks.some(Boolean)}<p class="text-xs mb-3 opacity-70">Random searches {indexedCount ? `${indexedCount} indexed public-domain artworks` : 'the public-domain artwork index'} for every locked color. This is a subset of the collection. Exact palette hex values stay locked.</p>{/if}
            {#if matchStatus}<p role="status" class="text-xs mb-3 match-progress">{#if matching}<span class="match-spinner" aria-hidden="true"></span>{/if}{matchStatus}</p>{/if}
            {#if matching}<button class="tool-button mb-4" onclick={cancelMatch}>Cancel color search</button>{/if}
{/snippet}

{#snippet artworkDetails()}
{#if artwork}
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
                    <div class="flex flex-wrap items-center gap-3 mt-3 text-xs">
                        <a class="underline" href={getArtworkUrl(artwork.id)} target="_blank" rel="noreferrer">View at the museum ↗</a>
                        <button class="underline" disabled={searchBusy} onclick={moreLikeThis}>{artwork.artist_id ? 'More by this artist' : 'More in this medium'}</button>
                        <span class="opacity-70">{artwork.is_public_domain ? 'Public domain' : 'Image rights: see museum page'}</span>
                    </div>
                </div>
{/if}
{/snippet}

{#snippet exportPanel()}
<fieldset class="card-format" disabled={cardBusy}>
    <legend class="text-xs mb-2">Artwork + palette image</legend>
    <div class="card-format-options">
        <label class="card-format-option">
            <input type="radio" name="card-format" value="classic" bind:group={cardFormat} onchange={() => cardStatus = ''} />
            <span>Classic</span>
        </label>
        <label class="card-format-option">
            <input type="radio" name="card-format" value="card" bind:group={cardFormat} onchange={() => cardStatus = ''} />
            <span>Card</span>
        </label>
    </div>
</fieldset>
{#if cardFormat === 'card' && artwork && colors.length}
    <div class="artwork-card-preview">
        <ArtworkCard {artwork} {colors} />
    </div>
{/if}
<div class="artwork-export-actions">
                        <button class="tool-button" disabled={busy || cardBusy || !artwork || !colors.length || Boolean(paletteError)} onclick={downloadCard}>{cardBusy ? "Creating card…" : cardFormat === 'card' ? 'Download card' : 'Download artwork + palette card'}</button>
                        <span role="status" class="text-xs">{cardStatus}</span>
                    </div>

                    <!-- The same save controls are available in both sheet layouts. -->
                    <div class="palette-save-actions" class:invisible={busy || Boolean(paletteError)}>
                        <button
                            onclick={handleShare}
                            disabled={sharing || busy || !colors.length}
                            class="rounded-md px-3 py-1.5 text-sm cursor-pointer"
                            style="background-color: var(--accent); color: var(--accent-foreground);"
                        >
                            share
                        </button>
                        {#each exportFormats as fmt}
                            <button
                                onclick={() => handleExport(fmt)}
                                disabled={busy || !colors.length}
                                class="palette-export rounded-md border px-2.5 py-1.5 text-xs uppercase cursor-pointer"
                                style="color: var(--text-secondary);"
                            >
                                {fmt === "ase" ? ".ase" : fmt}
                            </button>
                        {/each}
                        {#if shareStatus}
                            <span
                                role="status"
                                class="text-xs"
                                style="color: var(--text-muted);"
                                >{shareStatus}</span
                            >
                        {/if}
                        {#if shareUrl}<a class="text-xs underline" href={shareUrl}>Open saved palette</a>{/if}
                    </div>
{/snippet}

{#snippet historyPanel()}
<section class="workbench-panel mt-8" aria-label="Recent palettes">
                <div class="flex justify-between gap-3 items-center">
                    <h3 class="text-xs uppercase tracking-widest">Recent palettes</h3>
                    {#if recent.length}<button class="text-xs underline" onclick={clearHistory}>Clear history</button>{/if}
                </div>
                <p class="text-xs opacity-70 mt-2">Your last 24 palettes, saved in this browser. Select one to restore its colors and locks.</p>
                {#if historyStatus}<p role="status" class="text-xs mt-2">{historyStatus}</p>{/if}
                {#if !recent.length}<p class="text-sm mt-4 opacity-70">Your first palette will appear here.</p>{/if}
                <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
                    {#each recent as entry (entry.id)}
                        <button class="history-item text-left min-w-0" onclick={() => restoreRecent(entry)} title={`Restore ${entry.artwork.title} (${entry.mode === 'ai' ? 'tone' : entry.mode})`}>
                            {#if entry.artwork.image_id}<img loading="lazy" src={getImageUrl(entry.artwork.image_id, 'small', entry.artwork.thumbnail?.width)} onerror={fallbackImage} alt="" class="h-20 w-full object-cover rounded-t-md" />{/if}
                            <span class="flex h-5">{#each entry.colors as color}<span class="flex-1" style={`background:${color.hex}`}></span>{/each}</span>
                            <span class="block p-2 text-xs truncate">{entry.artwork.title}</span>
                            <span class="block px-2 pb-2 text-[10px] opacity-70">{entry.mode === 'ai' ? 'tone' : entry.mode} · {entry.colors.length} colors</span>
                        </button>
                    {/each}
                </div>
            </section>
{/snippet}

{#snippet desktopWorkbench()}
    <main class="desktop-workbench">
        <header class="desktop-header">
            <div class="desktop-brand">
                <h1>Chroma <span>Collection</span></h1>
                <p>Art Institute of Chicago</p>
            </div>
            <nav class="desktop-nav" aria-label="Workbench tools">
                {#each toolPanels as panel}
                    <button
                        aria-haspopup="dialog"
                        aria-controls="workbench-tools"
                        aria-expanded={panelOpen && activePanel === panel.id}
                        disabled={panel.id === 'save' && !colors.length}
                        onclick={() => openPanel(panel.id)}
                    >{panel.label}</button>
                {/each}
            </nav>
        </header>

        <section class="desktop-art" aria-label="Artwork">
            {#if loading}
                <p role="status">Finding artwork…</p>
            {:else if artwork?.image_id}
                <img src={getImageUrl(artwork.image_id, 'large', artwork.thumbnail?.width)} onerror={fallbackImage} alt={artwork.thumbnail?.alt_text || artwork.title} class="artwork-image" />
            {:else}
                <p>No artwork available. Try Random.</p>
            {/if}
            {#if paletteLoading || aiLoading || paletteError || matching || matchStatus}
                <div class="desktop-feedback" role="status">
                    {#if paletteError}
                        <span>{paletteError}</span>
                        <button disabled={busy} onclick={regeneratePalette}>Retry palette</button>
                    {:else}
                        <span class="match-progress">{#if matching}<span class="match-spinner" aria-hidden="true"></span>{/if}{aiLoading ? 'Analyzing mood…' : paletteLoading ? 'Generating palette…' : matchStatus}</span>
                    {/if}
                </div>
            {/if}
        </section>

        <section class="desktop-palette-dock" aria-label="Your palette">
            <div class="desktop-dock-toolbar">
                <button class="desktop-caption" aria-label="Read full artwork details" aria-haspopup="dialog" aria-controls="workbench-tools" disabled={!artwork} onclick={() => openPanel('artwork')}>
                    <span class="desktop-title">{artwork?.title || 'The Art Institute of Chicago'}</span>
                    <span class="desktop-artist">{artwork?.artist_title || artwork?.artist_display || 'Explore the collection'}{artwork?.date_display ? ` · ${artwork.date_display}` : ''} <span aria-hidden="true">↗</span></span>
                </button>
                <div class="desktop-controls">
                    <select aria-label="Number of colors" bind:value={colorCount} onchange={countChanged} disabled={busy}>
                        {#each [5, 6, 7, 8] as count}<option value={count} disabled={count < minimumCount}>{count} colors</option>{/each}
                    </select>
                    <select aria-label="Extraction mode" bind:value={extractionMode} onchange={regeneratePalette} disabled={busy}>
                        <option value="dominant">dominant</option>
                        <option value="vibrant">vibrant</option>
                        <option value="ai">tone</option>
                    </select>
                    <button class="desktop-regenerate" onclick={regeneratePalette} disabled={busy || !colors.length || locks.filter(Boolean).length === colors.length}>Regenerate unlocked</button>
                    <button class="desktop-random" disabled={busy} onclick={loadRandom}>{matching ? 'Finding a match…' : locks.some(Boolean) ? 'Random matching art' : 'Random artwork'}</button>
                    {#if matching}<button class="desktop-cancel" onclick={cancelMatch}>Cancel</button>{/if}
                </div>
            </div>
            <div class="desktop-swatches" style={`--swatch-count: ${Math.max(colors.length, 5)}`}>
                {#each colors as color, i}
                    <div class="desktop-swatch">
                        <button class="desktop-color" style={`background: ${color.hex}; color: ${readableText(color.hex)}`} aria-label={`Copy ${color.hex}`} title={color.name || color.hex} onclick={() => copyColor(color.hex)}>
                            <span>{copiedHex === color.hex ? 'Copied' : color.hex}</span>
                        </button>
                        <button class="desktop-lock" class:locked={Boolean(locks[i])} aria-label={`${locks[i] ? 'Unlock' : 'Lock'} color ${i + 1} (${color.hex})`} aria-pressed={Boolean(locks[i])} disabled={busy} onclick={() => toggleLock(i)}>{locks[i] ? 'Locked' : 'Lock'}</button>
                    </div>
                {:else}
                    <p class="desktop-palette-empty">{busy ? 'Your palette is on its way…' : 'Choose an artwork to find its colors.'}</p>
                {/each}
            </div>
            <p class="desktop-palette-hint" role="status" style="user-select: text;">{copyStatus || (locks.some(Boolean) ? `${locks.filter(Boolean).length} locked · Random searches ${indexedCount ? `${indexedCount.toLocaleString()} indexed artworks` : 'the artwork index'} for every locked color.` : 'Click a swatch to copy. Lock colors to guide the next artwork.')}</p>
        </section>
    </main>
{/snippet}

<div class="workbench-theme" style:--accent={accentColor} style:--accent-foreground={readableText(accentColor)} style:--accent-focus={accentFocus}>
{#if mobile}
    <main class="mobile-workbench">
        <header class="mobile-header">
            <h1>Chroma <span>Collection</span></h1>
            <button aria-label="About this artwork" disabled={!artwork} onclick={() => openPanel('artwork')}>Info</button>
        </header>

        <section class="mobile-art" aria-label="Artwork">
            {#if loading}
                <p role="status">Finding artwork…</p>
            {:else if artwork?.image_id}
                <img src={getImageUrl(artwork.image_id, 'large', artwork.thumbnail?.width)} onerror={fallbackImage} alt={artwork.thumbnail?.alt_text || artwork.title} />
            {:else}
                <p>No artwork available. Try Random.</p>
            {/if}
            {#if paletteLoading || aiLoading || paletteError || matching || matchStatus}
                <div class="mobile-feedback" role="status">
                    {#if paletteError}
                        <span>{paletteError}</span>
                        <button disabled={busy} onclick={regeneratePalette}>Retry palette</button>
                    {:else}
                        <span class="match-progress">{#if matching}<span class="match-spinner" aria-hidden="true"></span>{/if}{aiLoading ? 'Analyzing mood…' : paletteLoading ? 'Generating palette…' : matchStatus}</span>
                    {/if}
                </div>
            {/if}
        </section>

        <button class="mobile-caption" disabled={!artwork} onclick={() => openPanel('artwork')} aria-label="Read full artwork details">
            <span class="mobile-title">{artwork?.title || 'The Art Institute of Chicago'}</span>
            <span class="mobile-artist">{artwork?.artist_title || artwork?.artist_display || 'Explore the collection'}{artwork?.date_display ? ` · ${artwork.date_display}` : ''}</span>
        </button>

        <section class="mobile-palette" aria-label="Your palette">
            <div class="mobile-palette-settings">
                <span title={locks.some(Boolean) ? 'Locked-color search uses a public-domain subset of the collection.' : undefined}>{locks.some(Boolean) ? indexedCount ? `${indexedCount} indexed` : 'Index search' : 'Tap to lock'}</span>
                <select aria-label="Number of colors" bind:value={colorCount} onchange={countChanged} disabled={busy}>
                    {#each [5, 6, 7, 8] as count}<option value={count} disabled={count < minimumCount}>{count} colors</option>{/each}
                </select>
                <select aria-label="Extraction mode" bind:value={extractionMode} onchange={regeneratePalette} disabled={busy}>
                    <option value="dominant">dominant</option>
                    <option value="vibrant">vibrant</option>
                    <option value="ai">tone</option>
                </select>
            </div>
            <div class="mobile-swatches" class:two-rows={colors.length > 6} style={`--swatch-count: ${Math.max(colors.length, 5)}`}>
                {#each colors as color, i}
                    <button class="mobile-swatch" style={`background: ${color.hex}; color: ${readableText(color.hex)}`} aria-label={`${locks[i] ? 'Unlock' : 'Lock'} color ${i + 1} (${color.hex})`} aria-pressed={Boolean(locks[i])} disabled={busy} onclick={() => toggleLock(i)}>
                        <span class="mobile-hex">{color.hex}</span>
                        <span class="mobile-lock">{locks[i] ? 'Locked' : 'Lock'}</span>
                    </button>
                {:else}
                    <p class="mobile-palette-empty">{busy ? 'Your palette is on its way…' : 'Choose an artwork to find its colors.'}</p>
                {/each}
            </div>
        </section>

        <div class="mobile-roll">
            <button class="mobile-random" disabled={busy} onclick={loadRandom}>{matching ? 'Finding indexed match…' : locks.some(Boolean) ? 'Random · indexed color match' : 'Random artwork'}</button>
            {#if matching}<button class="mobile-cancel" onclick={cancelMatch}>Cancel</button>{/if}
        </div>
        <nav class="mobile-nav" aria-label="Workbench tools">
            <button onclick={() => openPanel('search')}>Search</button>
            <button onclick={() => openPanel('palette')}>Palette</button>
            <button onclick={() => openPanel('history')}>History</button>
            <button onclick={() => openPanel('save')} disabled={!colors.length}>Save</button>
        </nav>
    </main>

{:else}
    {@render desktopWorkbench()}
{/if}

    <dialog bind:this={toolDialog} use:sheetBackdrop use:pullToDismiss={() => { void closePanel(); }} id="workbench-tools" class="workbench-sheet" class:wide-panel={activePanel === 'palette' || activePanel === 'history'} aria-labelledby="workbench-panel-title" onclose={() => { panelOpen = false; }} oncancel={(event) => { event.preventDefault(); void closePanel(); }}>
        <div class="workbench-sheet-grip" aria-hidden="true"></div>
        <div class="workbench-sheet-header">
            <h2 id="workbench-panel-title">{panelTitles[activePanel]}</h2>
            <button onclick={closePanel}>Close</button>
        </div>
        <div class="workbench-sheet-content">
            {#if activePanel === 'search'}
                {@render discoveryPanel()}
            {:else if activePanel === 'palette'}
                {@render controlsPanel()}
                {#if copyStatus}<p role="status" class="mb-4 text-sm" style="user-select: text;">{copyStatus}</p>{/if}
                {#if paletteError}<p role="status" class="mb-4 text-sm">{paletteError}</p>{/if}
                {#if aiDescription}<p class="mb-4 text-sm">{aiDescription}</p>{/if}
                {#if colors.length}
                    <PaletteEditor showContrast={false} {colors} {locks} {busy} {copiedHex} oncopy={copyColor} onlock={toggleLock} />
                {/if}
                <ModeComparison expanded {variants} {busy} error={comparisonError} oncompare={() => compareModes()} ontone={() => compareModes(true)} onapply={useVariant} />
                {#if colors.length}
                    <ContrastChecker expanded swatchPicker {colors} oncopy={copyColor} />
                {/if}
            {:else if activePanel === 'history'}
                {@render historyPanel()}
            {:else if activePanel === 'artwork' && artwork}
                {@render artworkDetails()}
                {#if aiDescription}<p class="text-sm mt-4">{aiDescription}</p>{/if}
            {:else if activePanel === 'save'}
                {@render exportPanel()}
            {/if}
        </div>
    </dialog>
</div>
