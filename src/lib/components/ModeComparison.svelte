<script lang="ts">
    import type { ExtractedColor, ExtractionMode } from '$lib/colors/extraction';
    import { readableText } from '$lib/colors/workbench';
    export interface PaletteVariant { colors: ExtractedColor[]; description: string; }
    let { variants, busy, error, oncompare, ontone, onapply, expanded = false }: {
        expanded?: boolean;
        variants: Partial<Record<ExtractionMode, PaletteVariant>>;
        busy: boolean;
        error: string;
        oncompare: () => void;
        ontone: () => void;
        onapply: (mode: ExtractionMode) => void;
    } = $props();
    const modes = [
        { id: 'dominant', title: 'Dominant', description: 'A broad palette sampled from the artwork, ordered light to dark.' },
        { id: 'vibrant', title: 'Vibrant', description: 'Sampled colors ordered from vivid to muted.' },
        { id: 'ai', title: 'Tone', description: 'Generated only when requested.' }
    ] as const;
</script>

{#snippet comparisonContents()}
    <p class="text-xs opacity-70 mt-3">Compare original results for this artwork and color count. Your locks are preserved when you apply a palette.</p>
    {#if !expanded || !variants.dominant || !variants.vibrant}
        <button class="tool-button my-4" disabled={busy} onclick={oncompare}>{busy ? 'Generating…' : 'Compare dominant & vibrant'}</button>
    {/if}
    {#if error}<p role="status" class="text-sm mb-3">{error}</p>{/if}
    <div class="grid gap-3 md:grid-cols-3">
        {#each modes as mode}
            {@const variant = variants[mode.id]}
            <div class="border rounded-md p-3 min-w-0" style="border-color:var(--border)">
                <h4 class="text-sm">{mode.title}</h4>
                <p class="text-xs opacity-70 mt-2 mb-3">{mode.description}</p>
                {#if variant}
                    <div class="flex h-16 rounded overflow-hidden" aria-label={`${mode.title} palette`}>
                        {#each variant.colors as color}<span class="flex-1 min-w-0" style={`background:${color.hex};color:${readableText(color.hex)}`} title={color.hex}></span>{/each}
                    </div>
                    <p class="text-[10px] font-mono break-words mt-2">{variant.colors.map(c => c.hex).join(' · ')}</p>
                    {#if variant.description}<p class="text-xs mt-3 opacity-70">{variant.description}</p>{/if}
                    <button class="tool-button mt-3" disabled={busy} onclick={() => onapply(mode.id)}>Use {mode.title.toLowerCase()}</button>
                {:else if mode.id === 'ai'}
                    <button class="tool-button" disabled={busy} onclick={ontone}>Generate tone comparison</button>
                {:else}<p class="text-xs opacity-70">Choose compare to generate.</p>{/if}
            </div>
        {/each}
    </div>
{/snippet}
    {#if expanded}
        <section class="workbench-panel mt-6" aria-label="Compare extraction modes">
            <h3 class="text-sm">Compare extraction modes</h3>
            {@render comparisonContents()}
        </section>
    {:else}
        <details class="workbench-panel mt-6">
            <summary>Compare extraction modes</summary>
            {@render comparisonContents()}
        </details>
    {/if}
