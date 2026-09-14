<script lang="ts">
    import type { Artwork } from '$lib/api/artic';
    import type { ExtractedColor } from '$lib/colors/extraction';
    import { exportArtworkCard } from '$lib/export/artwork-card';

    let { artwork, colors }: { artwork: Artwork; colors: ExtractedColor[] } = $props();
    let previewUrl = $state('');
    let failed = $state(false);
    let retry = $state(0);

    $effect(() => {
        void retry;
        const controller = new AbortController();
        let objectUrl = '';
        previewUrl = '';
        failed = false;
        // Use the export itself so the preview cannot drift from the downloaded PNG.
        void exportArtworkCard({ ...artwork }, colors.map(color => ({ ...color })), controller.signal)
            .then(blob => {
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                previewUrl = objectUrl;
            })
            .catch(() => {
                if (!controller.signal.aborted) failed = true;
            });
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    });
</script>

<div class="classic-card-preview" aria-busy={!previewUrl && !failed}>
    {#if previewUrl}
        <img src={previewUrl} width="1200" height="1440" alt={`Classic preview: ${artwork.title}, with palette ${colors.map(color => color.hex).join(', ')}`} />
    {:else}
        <div class="preview-feedback">
            <p role="status">{failed ? 'Could not load the Classic preview.' : 'Loading preview…'}</p>
            {#if failed}<button class="tool-button" onclick={() => retry += 1}>Retry preview</button>{/if}
        </div>
    {/if}
</div>

<style>
    .classic-card-preview { position: relative; width: 100%; aspect-ratio: 5 / 6; background: #f3f0e9; color: #25241f; }
    img { display: block; width: 100%; height: auto; }
    .preview-feedback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; font-size: .8rem; text-align: center; }
    .preview-feedback button { color: inherit; background: transparent; border-color: currentColor; }
</style>
