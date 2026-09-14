# Website guide

[Documentation home](README.md) · [How the art database is made](data-pipeline.md)

## What ChromaCollection is for

Use ChromaCollection to find color inspiration in art, build a palette for a creative project, or discover artwork containing colors you already like. The artwork stays central; the palette and controls support exploring it.

The application does not require an account. It does not currently offer a personal cloud library, custom image uploads, or a general-purpose paint editor. Choosing a color in the contrast checker selects an existing palette swatch; it does not edit that swatch or add a custom hex color.

## A first session

1. Open the workbench. It attempts to select an artwork with an image and generates a five-color dominant palette.
2. Use **Random** for another artwork, or open **Find artwork** and search by subject, title, or artist.
3. Choose five to eight colors and try **Dominant** or **Vibrant**.
4. Tap a swatch to copy its hex code. Lock any swatches you want to preserve.
5. With locks present, **Random matching art** looks for another artwork containing all those colors in the current color index.
6. Use **Save & share** to download a palette, create an artwork card, or save a shareable link.

An artwork can have metadata and an image ID yet still fail to load. If that happens, retry or choose another artwork. The museum's image service is a separate dependency from the website.

## Find artwork

The discovery search uses the museum's live metadata service, not the smaller bundled color index. The interface offers keyword, artist, medium, period, and public-domain controls, with 12 results per page.

Filters combine: a work needs to satisfy the selected constraints, not just one of them. Date filtering includes artworks whose date range overlaps the requested period. Broaden or clear filters if no results appear.

**More like this** is not an AI similarity search. When an artist ID is available, it searches for other work by that artist; otherwise it uses the medium. It excludes the current artwork and retains the public-domain choice.

Manually choosing a search result does **not** enforce your locked-color constraints. Existing locks still stay in the palette, but this does not prove that the manually selected image contains those locked colors.

### What Random does

| State | Behavior |
|---|---|
| No locked colors | Uses the museum listing API to select artwork; this is not a statistically uniform draw from the entire collection |
| One or more locked colors | Searches the bundled 2,500-artwork color index and verifies every lock |
| Manual search selection | Selects that result directly, independently of color-index matching |

The unlocked implementation samples among at most the first 10,000 listing positions and tries up to ten metadata candidates to find an image ID. It does not apply the discovery form's filters to Random. “Random” should not be described as guaranteed coverage of every museum artwork.

## Understand the three palette modes

| Mode | What it does | What it does not promise |
|---|---|---|
| Dominant | Groups sampled image pixels into color clusters and orders the resulting palette light to dark | It does not expose exact area percentages or sort swatches by pixel population |
| Vibrant | Uses the same browser clustering process, then orders the result by saturation | It is not currently a separate neural or `node-vibrant` palette algorithm |
| Tone | Sends a small artwork JPEG to the configured server-side Gemini integration for an interpretive palette and mood description | Suggested colors are not guaranteed to literally occur in the image |

Dominant and Vibrant run in the browser. Their clustering starts from random samples, so regeneration can vary. They omit mostly transparent pixels and very dark/very light pixels from palette extraction. The separate artwork-matching index keeps opaque black, white, and gray pixels; see [why the algorithms differ](architecture.md#three-color-pipelines).

Tone requires a configured server credential and a working provider connection. It makes a provider request for an explicit tone action, rather than silently invoking AI on every new artwork. Restoring saved browser history does not make another tone request. An unavailable Tone service does not make local dominant/vibrant extraction depend on AI.

## Keep colors with locks

A lock preserves the exact color and its slot. Locks belong to the workbench, not just to the currently displayed artwork. They remain through new artwork selection, Random matching, regeneration, and mode changes. Unlocked slots are filled from the new candidate palette.

If a locked swatch occupies slot eight, unlock it before reducing the palette below eight colors. The interface calculates the minimum permitted count from the highest occupied locked slot.

Mode comparison previews the extracted alternatives. Applying an alternative merges it with your locks; the preview is not a promise that every displayed candidate will replace the final palette.

Restoring a history entry is different: it restores **that entry's own** saved locks and palette, rather than retaining the locks from the current workbench.

### What a color match means

All locked colors must be sufficiently present in the **same** artwork's saved whole-image sample. The search is approximate, not exact RGB equality. A match may come from a painted subject, a background, a frame, or a photographic display case; no object segmentation or background removal is performed.

Small amounts of similar color below the minimum coverage threshold do not qualify. Multiple locks can share some qualifying pixels if the colors are close enough; matching does not require separate spatial regions for each lock.

The current local app searches 2,500 indexed artworks. The larger 59,056-record scan is not automatically available in the interface just because the scan has started or finished.

### Search messages

- **Finding a match…:** the index is being queried; cancellation is available.
- **No other close match in the N-artwork index:** the search completed within that index. This is not a statement about every artwork in the museum.
- **Incomplete/unavailable data:** a sample could not be verified or the available search budget was exhausted. This is not proof that there is no match.
- **Timeout/index unavailable:** the operation did not finish successfully.

These unsuccessful matching outcomes leave your artwork, palette, and locks unchanged. The current artwork is excluded from matching results. Recently seen artworks are avoided when possible, but a previously seen valid match can be returned when needed.

## Compare colors and check readability

Palette tools show mode alternatives and a text/background contrast preview. Select two existing swatches to see the ratio and guidance. A suggested text color can be copied without altering the palette.

For opaque colors, the checker uses 4.5:1 for normal-text AA and 3:1 for large-text AA. The actual rendered text size and weight matter to the large-text category. Passing this two-color check does not certify a whole website or address transparency, image backgrounds, focus indicators, or every accessibility requirement. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## History, exports, and sharing

### Recent palettes

The browser retains up to 24 recent entries, including artwork details, swatches, locks, mode, and tone description. Identical artwork/mode/color combinations are deduplicated and moved to the front.

History is local to that browser and origin. It does not synchronize across devices or become private cloud storage. If local storage is blocked or unavailable, the interface keeps in-memory session history and explains the limitation. Clearing history affects browser history, not existing Neon share links.

### Download formats

| Format | Contents and likely use |
|---|---|
| JSON | Color objects containing hex, RGB, HSL, and optional names; integrations and structured reuse |
| CSS | Numbered custom properties such as `--color-1` and `--color-1-rgb`; web styling |
| PNG swatch strip | An 800 × 200 image with color bands and hex labels; visual reference |
| Adobe ASE | Named RGB swatches; import into software supporting Adobe Swatch Exchange |
| Artwork card | A 1200 × 1440 PNG containing artwork, palette, hex values, museum link, attribution, and rights text |

The ordinary palette exports are produced in the browser. The artwork card also needs the selected museum image to load. A JSON palette export is not a complete backup of history, locks, or artwork metadata. ASE names use the hex values; do not assume optional poetic Tone names become ASE swatch names.

Image requests use the museum's reported source width to avoid asking for an enlargement that its image server rejects. This applies to artwork display, local extraction, Tone image preparation, thumbnails, shared views, and card exports. If source dimensions are missing, the existing size tier is used; unrelated museum outages can still make an image unavailable.

### Shareable links

Sharing saves the current swatches, artwork ID, mode, and count on the server and returns a UUID link. A visitor opening that link sees the saved colors; they are not re-extracted from the image.

The saved URL remains visible if copying or native sharing is denied or cancelled. A failed clipboard operation is not necessarily a failed database save. If saving itself fails, the palette remains on screen for retry or local export.

Anyone with the URL can view that palette. There is no account-based access control, edit history, revocation UI, or user-facing deletion endpoint. Share links do not preserve workbench locks or the Tone description. They still depend on museum artwork metadata/images for the artwork presentation.

## Desktop, mobile, and accessibility behavior

On desktop (1,024 CSS pixels wide and above), the workbench fits the viewport without a page scrollbar at typical window heights. The artwork stays fully visible without cropping; the bottom palette dock keeps color count, extraction mode, regeneration, Random, and locks close at hand. Swatches form a centered group with consistent, capped widths instead of stretching across the screen. Click a swatch to copy its hex value; use its separate Lock button to guide the next artwork. Long artwork captions are shortened in the dock; click the caption to read the full details.

Search, Palette, History, and Save & share open right-side drawers. Palette contains full color names, mode comparisons, and contrast tools. These drawers scroll internally and can be dismissed with Close, Escape, or a click on the backdrop. Keyboard focus returns to the opener when it is still present.

On smaller screens, the artwork and essential palette controls occupy the main view. Search, palette tools, history, exports, and artwork details open in dismissible sheets. Seven/eight swatches use two rows. Very short viewports may scroll to avoid clipping controls.

Buttons expose labels and lock state; feedback uses status regions; motion is reduced when requested by the browser/OS. The contrast pickers support keyboard selection. Browser features such as dialogs, popovers, clipboard access, and native sharing can vary by device. Consult the [release checklist](release-checklist.md) for checks actually performed rather than treating this description as a universal browser-support guarantee.

## Rights and privacy

The application is a way to explore museum data, not a declaration that every discoverable image is free to reuse. The discovery form can include artworks outside the public-domain color index. Follow the artwork's museum link and rights information before reusing an image. Do not infer rights from a successful download or infer a specific rights reason from HTTP 403 alone.

The browser contacts the museum for discovery and images. Production builds initialize Vercel Analytics and load the configured Google font resources. Explicit Tone requests send a small artwork image through the application server to Gemini. Share actions persist a palette in Neon. See the [architecture's data-flow inventory](architecture.md#external-data-flows) for these boundaries.
