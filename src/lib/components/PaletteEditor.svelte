<script lang="ts">
    import type { ExtractedColor } from '$lib/colors/extraction';
    import { readableText } from '$lib/colors/workbench';
    import ContrastChecker from './ContrastChecker.svelte';
    let { colors, locks, busy, copiedHex, oncopy, onlock, showContrast = true, layout = 'panel' }: {
        layout?: 'panel' | 'desktop' | 'mobile';
        showContrast?: boolean;
        colors: ExtractedColor[];
        locks: (ExtractedColor | null)[];
        busy: boolean;
        copiedHex: string;
        oncopy: (hex: string) => void;
        onlock: (index: number) => void;
    } = $props();
    let lockedCount = $derived(locks.filter(Boolean).length);
</script>

<div class="palette-editor" data-layout={layout}>
    <div class="palette-swatches" class:desktop-swatches={layout === 'desktop'} class:mobile-swatches={layout === 'mobile'} data-count={colors.length} style={`--palette-count: ${Math.max(colors.length, 5)}`}>
        {#each colors as color, i}
            <div class="palette-item" class:desktop-swatch={layout === 'desktop'} class:mobile-swatch={layout === 'mobile'}>
                <button class="palette-copy" class:desktop-color={layout === 'desktop'} class:mobile-color={layout === 'mobile'} class:copied={copiedHex === color.hex} style={`background:${color.hex};color:${readableText(color.hex)}`} onclick={() => oncopy(color.hex)} title={color.name || `Copy ${color.hex}`} aria-label={`Copy ${color.hex}`}>
                    <span class="palette-hex">{color.hex}</span>
                </button>
                <button class="lock-button palette-lock" class:desktop-lock={layout === 'desktop'} class:mobile-lock={layout === 'mobile'} class:locked={Boolean(locks[i])} aria-pressed={Boolean(locks[i])} aria-label={`${locks[i] ? 'Unlock' : 'Lock'} color ${i + 1} (${color.hex})`} disabled={busy} onclick={() => onlock(i)}>
                    {locks[i] ? 'Unlock' : 'Lock'}
                </button>
                {#if layout === 'panel' && color.name}<p class="mt-2 text-xs text-center break-words opacity-70">{color.name}</p>{/if}
            </div>
        {:else}
            <p class="palette-empty">{busy ? 'Your palette is on its way…' : 'Choose an artwork to find its colors.'}</p>
        {/each}
    </div>
    {#if layout === 'panel'}
        <p class="text-xs mt-3 opacity-70">{lockedCount ? `${lockedCount} locked. Random looks for artwork containing all these colors (close matches). Locks also stay in place across modes. Unlock a slot before removing it.` : 'Tap or click a color to copy its hex. Use Lock to keep that color in its slot.'}</p>
    {/if}

    {#if showContrast}
        <ContrastChecker {colors} {oncopy} />
    {/if}
</div>

<style>
    .palette-editor { min-width: 0; container: palette / inline-size; }
    .palette-swatches { display: grid; grid-template-columns: repeat(var(--palette-columns, var(--palette-count)), minmax(0, 1fr)); gap: .25rem; }
    .palette-item { min-width: 0; }
    .palette-copy { width: 100%; min-height: 44px; height: 6rem; display: flex; align-items: flex-end; justify-content: center; padding: .5rem .25rem; border-radius: 6px 6px 0 0; cursor: pointer; }
    .palette-copy.copied { box-shadow: inset 0 0 0 2px currentColor; }
    .palette-hex { font: .875rem/1.25 var(--font-mono); white-space: nowrap; }
    .palette-lock { min-height: 44px; padding: .375rem .125rem; font-size: .75rem; line-height: 1.25; color: var(--text-secondary); }
    .palette-lock.locked { color: var(--accent-foreground); }
    .palette-empty { grid-column: 1 / -1; min-height: 88px; display: grid; place-items: center; font-size: .8125rem; color: var(--text-secondary); }
    [data-layout='desktop'] .palette-swatches { grid-template-columns: repeat(var(--palette-columns, var(--palette-count)), minmax(0, 7.5rem)); justify-content: center; gap: .375rem; }
    [data-layout='desktop'] .palette-copy { height: clamp(56px, 10dvh, 110px); }
    [data-layout='mobile'] .palette-copy { height: 44px; align-items: center; }
    /* Fit complete 14px hex labels, balancing dense palettes into two rows. */
    @container palette (width < 35.75rem) { .palette-swatches[data-count='8'] { --palette-columns: 4; } }
    @container palette (width < 31.25rem) { .palette-swatches[data-count='7'] { --palette-columns: 4; } }
    @container palette (width < 26.75rem) { .palette-swatches[data-count='6'] { --palette-columns: 3; } }
    @container palette (width < 22.25rem) { .palette-swatches[data-count='5'] { --palette-columns: 3; } }
    @container palette (width < 17.75rem) { .palette-swatches[data-count] { --palette-columns: 2; } }
    @media (forced-colors: active) { .palette-lock.locked { outline: 2px solid Highlight; outline-offset: -3px; } }
</style>
