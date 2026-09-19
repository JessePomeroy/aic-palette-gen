<script lang="ts">
    import { type Artwork, getImageUrl } from '$lib/api/artic';
    import { loadArtworkImage } from '$lib/images/artwork-image';
    import { presentArtworkImage } from '$lib/images/preview-treatment';

    let { artwork, size = 'large', alt, layout = 'fill', class: className = '', imageClass = '', loading,
        src, preview = false, notice = true, onpreview,
        unavailableMessage = 'Artwork image is unavailable.' }: {
        artwork: Artwork;
        size?: Parameters<typeof getImageUrl>[1];
        alt?: string;
        layout?: 'fill' | 'natural' | 'thumbnail' | 'card';
        class?: string;
        imageClass?: string;
        loading?: 'lazy' | 'eager';
        src?: string;
        preview?: boolean;
        notice?: boolean;
        onpreview?: (preview: boolean) => void;
        unavailableMessage?: string;
    } = $props();

    let retry = $state(0);
    const identity = $derived(`${artwork.id}/${artwork.image_id}/${size}/${artwork.thumbnail?.width}/${src || ''}/${retry}`);
    const original = $derived(src || (artwork.image_id ? getImageUrl(artwork.image_id, size, artwork.thumbnail?.width) : ''));
    let loaded = $state<{ identity: string; url: string; preview: boolean }>();
    let failed = $state(false);
    let pending = $state(false);
    let image = $state<HTMLImageElement>();
    let width = $state(0), height = $state(0), ratio = $state(1);
    const current = $derived(loaded?.identity === identity ? loaded : undefined);
    const source = $derived(current?.url || original);
    const isPreview = $derived(current?.preview ?? (Boolean(src) && preview));
    const frameWidth = $derived(Math.max(0, Math.min(width, (height - (isPreview && notice ? 46 : 0)) * ratio)));
    let recover = async () => {};

    $effect(() => {
        const selected = { ...artwork, thumbnail: { ...artwork.thumbnail } };
        const selectedSize = size, selectedIdentity = identity, selectedSource = original;
        const embedded = Boolean(src), embeddedPreview = preview;
        const controller = new AbortController();
        let objectUrl = '', attempted = false;
        loaded = undefined;
        failed = false;
        pending = false;
        ratio = selected.thumbnail?.width > 0 && selected.thumbnail?.height > 0
            ? selected.thumbnail.width / selected.thumbnail.height : 1;
        onpreview?.(embedded && embeddedPreview);
        recover = async () => {
            if (controller.signal.aborted) return;
            // A cached failure can trigger both the native error event and the
            // hydration check. They share one recovery, not a terminal second error.
            if (attempted && pending) return;
            if (attempted || embedded) { failed = true; pending = false; return; }
            attempted = true;
            pending = true;
            try {
                const result = await loadArtworkImage(selected, selectedSize, controller.signal);
                const blob = await presentArtworkImage(result, controller.signal);
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                loaded = { identity: selectedIdentity, url: objectUrl, preview: result.preview };
                failed = false;
                onpreview?.(result.preview);
            } catch {
                if (!controller.signal.aborted) failed = true;
            } finally {
                if (!controller.signal.aborted) pending = false;
            }
        };
        // An SSR image may have failed before hydration attached the error handler.
        queueMicrotask(() => {
            const node = image;
            if (!controller.signal.aborted && node?.getAttribute('src') === selectedSource && node.complete && !node.naturalWidth) void recover();
        });
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    });

    function imageLoaded(event: Event) {
        const target = event.currentTarget;
        if (target instanceof HTMLImageElement && target.naturalWidth && target.naturalHeight) ratio = target.naturalWidth / target.naturalHeight;
    }
</script>

<div class={`artwork-media artwork-media-${layout} ${className}`} class:artwork-media-preview={isPreview && !failed}
    bind:clientWidth={width} bind:clientHeight={height} aria-busy={pending}>
    {#if failed || !source}
        {#if layout === 'thumbnail'}
            <span class="artwork-media-missing" title={unavailableMessage} aria-label={unavailableMessage}>—</span>
        {:else}
            <div class="artwork-media-error"><p role="status">{unavailableMessage}</p><button type="button" onclick={() => retry += 1}>Retry image</button></div>
        {/if}
    {:else}
        <div class="artwork-media-frame" style:width={layout === 'fill' ? `${frameWidth}px` : undefined} style:height={layout === 'fill' ? `${frameWidth / ratio}px` : undefined}>
            <img bind:this={image} class={imageClass} src={source} alt={alt ?? (artwork.thumbnail?.alt_text || artwork.title)}
                {loading} onload={imageLoaded} onerror={() => { void recover(); }} />
            {#if pending}<span class="artwork-media-loading" role="status">{layout === 'thumbnail' ? '…' : 'Loading image…'}</span>{/if}
        </div>
        {#if isPreview && notice}
            {#if layout === 'thumbnail'}
                <span class="artwork-media-preview-mark" title="Museum image unavailable · Low-resolution preview" aria-label="Low-resolution preview">◌</span>
            {:else}
                <button type="button" class="artwork-media-notice" onclick={() => retry += 1} title="Retry the museum image" aria-label="Museum image unavailable. Low-resolution preview. Retry museum image.">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 7v4M8 4.5v1"/></svg>
                    <span>Museum image unavailable <span class="artwork-media-preview-label">· Preview</span></span>
                </button>
            {/if}
        {/if}
    {/if}
</div>

<style>
    .artwork-media { position: relative; min-width: 0; min-height: 0; }
    .artwork-media-fill { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 14px; }
    .artwork-media-frame { position: relative; flex-shrink: 0; min-width: 0; min-height: 0; overflow: hidden; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .artwork-media-natural { display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .artwork-media-natural .artwork-media-frame { max-width: 100%; border-radius: 8px; box-shadow: 0 8px 30px rgb(0 0 0 / .4); }
    .artwork-media-natural img { width: auto; max-width: 100%; height: auto; max-height: 65vh; }
    .artwork-media-thumbnail { flex-shrink: 0; overflow: hidden; }
    .artwork-media-thumbnail .artwork-media-frame, .artwork-media-card, .artwork-media-card .artwork-media-frame { width: 100%; height: 100%; }
    .artwork-media-thumbnail img { object-fit: cover; }
    .artwork-media-notice { display: flex; align-items: center; justify-content: center; gap: 7px; max-width: 100%; flex-shrink: 0; padding: 7px 10px; border: 1px solid #ffffff1c; border-radius: 3px; background: #151512; color: #cdc9bf; font-family: var(--font-sans, sans-serif); font-size: 11px; line-height: 16px; text-align: center; cursor: pointer; }
    .artwork-media-notice svg { width: 13px; height: 13px; flex-shrink: 0; color: #bda36d; }
    .artwork-media-preview-label { color: #a9a59c; }
    .artwork-media-preview-mark { position: absolute; right: 2px; bottom: 2px; padding: 0 3px; border-radius: 2px; background: #151512; color: #cdc9bf; font-size: 12px; }
    .artwork-media-loading { position: absolute; inset: 0; display: grid; place-items: center; background: var(--bg-primary, #0a0a0a); color: var(--text-secondary, #999); font-size: 12px; }
    .artwork-media-error { padding: 8px; font-size: 12px; text-align: center; }
    .artwork-media-error button { min-height: 44px; text-decoration: underline; cursor: pointer; }
    .artwork-media-missing { display: grid; place-items: center; width: 100%; height: 100%; background: var(--bg-surface, #1a1a1a); color: var(--text-secondary, #999); }
</style>
