<script lang="ts">
    import type { ExtractedColor } from '$lib/colors/extraction';
    import { contrastRatio, suggestTextColor } from '$lib/colors/workbench';
    import ColorPicker from './ColorPicker.svelte';
    let { colors, oncopy, expanded = false, swatchPicker = false }: {
        colors: ExtractedColor[];
        oncopy: (hex: string) => void;
        expanded?: boolean;
        swatchPicker?: boolean;
    } = $props();
    let foreground = $state(0);
    let background = $state(1);
    let text = $derived(colors[Math.min(foreground, colors.length - 1)]?.hex ?? '#000000');
    let bg = $derived(colors[Math.min(background, colors.length - 1)]?.hex ?? '#ffffff');
    let ratio = $derived(contrastRatio(text, bg));
    let suggestion = $derived(suggestTextColor(text, bg));

    const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    let sampleText = $state('Lorem ipsum');
    let sampleWidth = $state(0);
    let measureWidth = $state(0);
    let measure = $state<HTMLSpanElement>();

    $effect(() => {
        const node = measure?.firstChild;
        if (!node || !sampleWidth || !measureWidth) return;
        // Measure whole words in the rendered font; font changes resize the hidden line too.
        const range = document.createRange();
        range.setStart(node, 0);
        let end = 0, fitted = '';
        for (const word of lorem.split(' ')) {
            end += word.length + (end ? 1 : 0);
            range.setEnd(node, end);
            if (range.getBoundingClientRect().width > sampleWidth) break;
            fitted = lorem.slice(0, end);
        }
        sampleText = fitted;
    });
</script>

    {#snippet contrastContents()}
        <div class="mt-4 flex flex-wrap gap-4">
            {#if swatchPicker}
                <ColorPicker {colors} label="Text color" bind:value={foreground} />
                <ColorPicker {colors} label="Background" bind:value={background} />
            {:else}
            <label class="text-sm flex flex-col gap-2">Text color
                <select aria-label="Contrast text color" bind:value={foreground}>
                    {#each colors as color, i}<option value={i}>{i + 1} · {color.hex}</option>{/each}
                </select>
            </label>
            <label class="text-sm flex flex-col gap-2">Background
                <select aria-label="Contrast background color" bind:value={background}>
                    {#each colors as color, i}<option value={i}>{i + 1} · {color.hex}</option>{/each}
                </select>
            </label>
            {/if}
        </div>
        <div class="rounded-md p-5 my-4" style={`background:${bg};color:${text}`} aria-label="Text contrast sample">
            <p class="text-2xl contrast-sample" bind:clientWidth={sampleWidth}>
                <span class="contrast-sample-measure" aria-hidden="true" bind:this={measure} bind:clientWidth={measureWidth}>{lorem}</span>
                <span class="contrast-sample-text">{sampleText}</span>
            </p>
            <p class="text-base mt-2">A small type sample for this color pair.</p>
        </div>
        <p role="status" class="text-sm">{ratio.toFixed(2)}:1 · {ratio >= 4.5 ? 'Passes AA for normal text' : ratio >= 3 ? 'Passes AA for large text only' : 'Does not meet AA text contrast'}</p>
        {#if ratio < 4.5}
            <p class="text-sm mt-3">Suggested text color: <button class="underline font-mono" onclick={() => oncopy(suggestion)}>{suggestion}</button> ({contrastRatio(suggestion, bg).toFixed(2)}:1). Click to copy; your palette stays unchanged.</p>
        {/if}
        <p class="text-xs opacity-70 mt-3">For opaque colors. AA requires 4.5:1 for normal text and 3:1 for large text. <a class="underline" href="https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html" target="_blank" rel="noreferrer">About WCAG contrast</a></p>
{/snippet}
    {#if expanded}
        <section class="workbench-panel mt-6" aria-label="Check text contrast">
            <h3 class="text-sm">Check text contrast</h3>
            {@render contrastContents()}
        </section>
    {:else}
        <details class="workbench-panel mt-6">
            <summary>Check text contrast</summary>
            {@render contrastContents()}
        </details>
    {/if}

<style>
    .contrast-sample { position: relative; min-height: 1lh; overflow: hidden; white-space: nowrap; }
    .contrast-sample-measure { position: absolute; width: max-content; visibility: hidden; }
</style>
