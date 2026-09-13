<script lang="ts">
    import type { ExtractedColor } from '$lib/colors/extraction';
    import { readableText } from '$lib/colors/workbench';
    import ContrastChecker from './ContrastChecker.svelte';
    let { colors, locks, busy, copiedHex, oncopy, onlock, showContrast = true }: {
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

<div class="palette-editor">
    <div class="grid gap-1" style={`grid-template-columns: repeat(${colors.length}, minmax(0, 1fr))`}>
        {#each colors as color, i}
            <div class="min-w-0">
                <button class="w-full h-24 sm:h-32 rounded-t-md flex items-end justify-center pb-3 cursor-pointer" style={`background:${color.hex};color:${readableText(color.hex)}`} onclick={() => oncopy(color.hex)} title={`Copy ${color.hex}`} aria-label={`Copy ${color.hex}`}>
                    <span class="font-mono text-[9px] sm:text-xs">{copiedHex === color.hex ? 'copied' : color.hex}</span>
                </button>
                <button class="lock-button" class:locked={Boolean(locks[i])} aria-pressed={Boolean(locks[i])} aria-label={`${locks[i] ? 'Unlock' : 'Lock'} color ${i + 1} (${color.hex})`} disabled={busy} onclick={() => onlock(i)}>
                    {locks[i] ? 'Locked' : 'Lock'}
                </button>
                {#if color.name}<p class="mt-2 text-[10px] text-center break-words opacity-70">{color.name}</p>{/if}
            </div>
        {/each}
    </div>
    <p class="text-xs mt-3 opacity-70">{lockedCount ? `${lockedCount} locked. Random looks for artwork containing all these colors (close matches). Locks also stay in place across modes. Unlock a slot before removing it.` : 'Lock colors to guide the next random artwork. Click a swatch to copy its hex.'}</p>

    {#if showContrast}
        <ContrastChecker {colors} {oncopy} />
    {/if}
</div>
