<script lang="ts">
    import { type Artwork, getArtworkUrl, getImageUrl } from '$lib/api/artic';
    import type { ExtractedColor } from '$lib/colors/extraction';
    import './artwork-card.css';

    let { artwork, colors, imageUrl }: {
        artwork: Artwork;
        colors: ExtractedColor[];
        imageUrl?: string;
    } = $props();

    const accents = $derived([...colors].sort((a, b) => b.hsl.s - a.hsl.s));
    const frame = $derived(colors[0]?.hex || '#829caf');
    const trim = $derived(accents[0]?.hex || '#b6a15e');
    const source = $derived(imageUrl || (artwork.image_id ? getImageUrl(artwork.image_id, 'large', artwork.thumbnail?.width) : ''));
    const titleSize = $derived(artwork.title.length > 100 ? '4.6cqi' : artwork.title.length > 50 ? '6.1cqi' : '9cqi');
    const artist = $derived(artwork.artist_title || artwork.artist_display || 'Artist unknown');

    function imageFailed(event: Event) {
        const image = event.currentTarget;
        if (image instanceof HTMLImageElement && image.src.startsWith('https://www.artic.edu/iiif/')) {
            image.src = `/api/image?${new URLSearchParams({ url: image.src })}`;
        }
    }
</script>

<div class="artwork-card-viewport">
    <article class="artwork-card" aria-label={`${artwork.title} artwork palette card`} style:--card-frame={frame} style:--card-trim={trim} style:--card-title-size={titleSize}>
        <div class="artwork-card-title-frame">
            <header class="artwork-card-title-paper">
                <div class="artwork-card-title-line">
                    <h3 class="artwork-card-title">{artwork.title}</h3>
                    {#if artwork.date_display}<p class="artwork-card-date">{artwork.date_display}</p>{/if}
                </div>
                <div class="artwork-card-credits">
                    <p>{artist}</p>
                    {#if artwork.medium_display}<p>{artwork.medium_display}</p>{/if}
                </div>
            </header>
        </div>

        <figure class="artwork-card-image-frame">
            <img class="artwork-card-image" src={source} alt={artwork.thumbnail?.alt_text || artwork.title} onerror={imageFailed} />
        </figure>

        <section class="artwork-card-palette-panel" aria-label="Palette and artwork credit">
            <h4 class="artwork-card-palette-title">Palette</h4>
            <ol class="artwork-card-swatches" class:artwork-card-many-colors={colors.length > 6} style:--card-color-count={Math.max(colors.length, 1)} aria-label="Palette colors">
                {#each colors as color}
                    <li class="artwork-card-swatch">
                        <span class="artwork-card-color" style:background-color={color.hex}></span>
                        <span class="artwork-card-hex">{color.hex.toUpperCase()}</span>
                    </li>
                {/each}
            </ol>
            <footer class="artwork-card-footer">
                <div class="artwork-card-collector">
                    <span>Chroma Collection</span>
                    <span>AIC · {artwork.id}</span>
                </div>
                <p>Art Institute of Chicago · {artwork.is_public_domain ? 'Public domain' : artwork.copyright_notice || 'See museum page for image rights'}</p>
                <a class="artwork-card-source" href={getArtworkUrl(artwork.id)} target="_blank" rel="noreferrer">artic.edu/artworks/{artwork.id}</a>
            </footer>
        </section>
    </article>
</div>
