# Website guide

[Documentation home](README.md) · [How the art database is made](data-pipeline.md)

## What ChromaCollection is for

Use ChromaCollection to find color inspiration in art, build a palette for a creative project, or discover artwork containing colors you already like. The artwork stays central; the palette and controls support exploring it.

The application does not require an account. It does not currently offer a personal cloud library, custom image uploads, or a general-purpose paint editor. Choosing a color in the contrast checker selects an existing palette swatch; it does not edit that swatch or add a custom hex color.

## A first session

1. Open the workbench. It attempts to select an artwork with an image and generates a five-color dominant palette.
2. Use **Random** for another artwork, or open **Find artwork** and search by subject, title, or artist.
3. Choose five to eight colors and try **Dominant** or **Vibrant**.
4. Tap or click a main swatch to copy its hex on desktop or mobile. Use its separate **Lock** / **Unlock** control to keep or release that color's slot.
5. With locks present, **Random matching art** looks for another artwork containing all those colors in the current color index.
6. Use **Save & share** to download a palette, create an artwork card, or save a shareable link.

An artwork can have metadata and an image ID yet still fail to load. The museum's image service is a separate dependency from the website.

### When a museum image is unavailable

The current source tries the sharp museum image first, including the existing image proxy. If both fail, indexed artworks can use their verified, at-most-200px saved sample. The low-resolution preview has a light film texture and a **Museum image unavailable · Preview** label. Select that label to retry the museum image; successful recovery removes the treatment without changing your chosen palette. This handles selective access blocks as well as service failures—it does not claim that the museum is down for everyone.

The treatment is for display only. Dominant, Vibrant, and explicitly requested Tone use unfiltered pixels. Missing, changed, or unverifiable samples produce an unavailable message rather than another artwork's preview. Coverage is limited to the 59,025 indexed artworks, not every search result. No original JPEGs need to be uploaded for this fallback; local original-file cleanup remains a separate decision. Consult the release checklist for deployment status; source changes are not automatically live.

## Find artwork

The discovery search uses the museum's live metadata service, not the frozen color index. The interface offers keyword, artist, medium, period, and public-domain controls, with 12 results per page.

Filters combine: a work needs to satisfy the selected constraints, not just one of them. Date filtering includes artworks whose date range overlaps the requested period. Broaden or clear filters if no results appear.

**More like this** is not an AI similarity search. When an artist ID is available, it searches for other work by that artist; otherwise it uses the medium. It excludes the current artwork and retains the public-domain choice.

Open **Recent searches** in the Search panel to revisit your last 10 completed searches. Each entry restores the keywords, filters, and last results page, including “More like this” searches. Reopening fetches current museum results, not a saved copy of the results. Repeated searches move to the top instead of creating duplicates; failed requests and unsubmitted typing are not saved.

Search history stays in this browser and survives reloads when browser storage is available. It does not sync across devices. **Clear searches** removes search history without clearing your recent palettes or changing the current artwork. If storage is unavailable, searches remain available for the current session and the panel explains the limitation.

Manually choosing a search result does **not** enforce your locked-color constraints. Existing locks still stay in the palette, but this does not prove that the manually selected image contains those locked colors.

### What Random does

| State | Behavior |
|---|---|
| No locked colors | Uses the museum listing API to select artwork; this is not a statistically uniform draw from the entire collection |
| One or more locked colors | Searches the hosted 59,025-artwork color index and verifies every lock |
| Manual search selection | Selects that result directly, independently of color-index matching |

The unlocked implementation samples among at most the first 10,000 listing positions and tries up to ten metadata candidates to find an image ID. It does not apply the discovery form's filters to Random. “Random” should not be described as guaranteed coverage of every museum artwork.

Search and unlocked Random exclude the museum's **Archives (groupings)** category, which contains collection-level records and archive placeholder images. This is a metadata filter, not a color filter: monochrome artwork, photographs, and records without a type classification remain eligible. Previously saved palettes and history are not removed.

## Understand the three palette modes

| Mode | What it does | What it does not promise |
|---|---|---|
| Dominant | Groups sampled image pixels into color clusters and orders the resulting palette light to dark | It does not expose exact area percentages or sort swatches by pixel population |
| Vibrant | Uses the same browser clustering process, then orders the result by saturation | It is not currently a separate neural or `node-vibrant` palette algorithm |
| Tone | Sends a small artwork JPEG to the configured server-side Gemini integration for an interpretive palette and mood description | Suggested colors are not guaranteed to literally occur in the image |

Dominant and Vibrant run in the browser. Their clustering starts from random samples, so regeneration can vary. They omit mostly transparent pixels and very dark/very light pixels from palette extraction. The separate artwork-matching index keeps opaque black, white, and gray pixels; see [why the algorithms differ](architecture.md#three-color-pipelines).

Tone requires a configured server credential and a working provider connection. It makes a provider request for an explicit tone action, rather than silently invoking AI on every new artwork. Restoring saved browser history does not make another tone request. An unavailable Tone service does not make local dominant/vibrant extraction depend on AI.

## Keep colors with locks

Copying never changes locks, and locking never copies. A successful copy shows **Copied #abada8.** in an accessible status message for three seconds while leaving the hex label visible. If clipboard access fails, the message says so and provides selectable text for manual copying; it does not claim success. Copy feedback stays visible at the bottom of an open tool panel, even when the controls have scrolled away.

A lock preserves the exact color and its slot. Locks belong to the workbench, not just to the currently displayed artwork. They remain through new artwork selection, Random matching, regeneration, and mode changes. Unlocked slots are filled from the new candidate palette.

**Regenerate unlocked** sits beside the main palette's color-count and extraction-mode controls on both desktop and mobile. It keeps every locked slot and becomes unavailable when all colors are locked.

If a locked swatch occupies slot eight, unlock it before reducing the palette below eight colors. The interface calculates the minimum permitted count from the highest occupied locked slot.

Mode comparison previews the extracted alternatives. Applying an alternative merges it with your locks; the preview is not a promise that every displayed candidate will replace the final palette.

Restoring a history entry is different: it restores **that entry's own** saved locks and palette, rather than retaining the locks from the current workbench.

### What a color match means

All locked colors must be sufficiently present in the **same** artwork's saved whole-image sample. The search is approximate, not exact RGB equality. A match may come from a painted subject, a background, a frame, or a photographic display case; no object segmentation or background removal is performed.

Small amounts of similar color below the minimum coverage threshold do not qualify. Multiple locks can share some qualifying pixels if the colors are close enough; matching does not require separate spatial regions for each lock.

The app's full-scan release searches 59,025 indexed artworks from the frozen 59,056-record eligible catalog. The remaining 31 records had explicit image skips. Color data loads in small pieces on demand; the entire collection is not downloaded to your phone. Each search is limited to 12 MiB of index/sample data, 2,500 candidate checks, and 30 seconds. Difficult combinations can therefore return incomplete; this protects bandwidth without loosening the matching rules.

### Search messages

- **Finding a match…:** the index is being queried; cancellation is available.
- **No other close match in the N-artwork index:** the search completed within that index. This is not a statement about every artwork in the museum.
- **Incomplete/unavailable data:** a sample could not be verified or the available search budget was exhausted. This is not proof that there is no match.
- **Timeout/index unavailable:** the operation did not finish successfully.

These unsuccessful matching outcomes leave your artwork, palette, and locks unchanged. The current artwork is excluded from matching results. Recently seen artworks are avoided when possible, but a previously seen valid match can be returned when needed.

## Compare colors and check readability

**Palette tools** opens the existing drawer or sheet. Its **Current palette** section keeps the same copy, lock, and regeneration controls; **Advanced tools** groups mode comparison and text/background contrast checking. Select two existing swatches to see the ratio and guidance. A suggested text color can be copied without altering the palette.

The large lorem ipsum sample fits as many whole words as the preview width allows, staying on one line without reducing its type size.

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
| Classic artwork image | The original 1200 × 1440 PNG layout with artwork, palette, hex values, attribution, and museum link; selected by default |
| Card | A 1200 × 1680 framed PNG containing the uncropped artwork, selected palette, hex values, museum link, attribution, and rights text |

The ordinary palette exports are produced in the browser. Artwork cards use the sharp museum image when available, otherwise the treated saved preview. Both card formats label a fallback inside the downloaded PNG as a low-resolution preview; palette swatch pixels remain unchanged. A JSON palette export is not a complete backup of history, locks, or artwork metadata. ASE names use the hex values; do not assume optional poetic Tone names become ASE swatch names.

In Save & share, choose **Classic** for the original design or **Card** for the cursive design. Both show a preview in the same reserved space, so switching formats does not move the download and share controls. Each keeps its original proportions; Classic previews the actual PNG output. The choice lasts for the current page session. The card frame borrows colors from your selected palette, with self-hosted Allura and Dancing Script fonts and a shaped title banner. Five or six swatches share one row; seven or eight use two rows. Its preview and PNG use the same HTML/CSS layout; the original image is fitted without cropping. Both exports remain local to your browser and do not save a shared palette or call Tone.

Image requests use the museum's reported source width to avoid asking for an enlargement that its image server rejects. This applies to artwork display, local extraction, Tone image preparation, thumbnails, shared views, and card exports. If source dimensions are missing, the existing size tier is used; unrelated museum outages can still make an image unavailable.

### Shareable links

Sharing saves the current swatches, artwork ID, mode, and count on the server and returns a UUID link. A visitor opening that link sees the saved colors; they are not re-extracted from the image.

The saved URL remains visible if copying or native sharing is denied or cancelled. A failed clipboard operation is not necessarily a failed database save. If saving itself fails, the palette remains on screen for retry or local export.

Anyone with the URL can view that palette. There is no account-based access control, edit history, revocation UI, or user-facing deletion endpoint. Share links do not preserve workbench locks or the Tone description. They still depend on museum artwork metadata; indexed artwork images can use the same saved-preview fallback. Saved swatches are never re-extracted during image recovery.

## Desktop, mobile, and accessibility behavior

On mobile, pull down on a sheet's header or on non-interactive content that is already scrolled to the top to close it. Short pulls return the sheet to its original position. Scrolling, form controls, and links keep their normal behavior. The Close button, Escape key, and backdrop dismissal remain available; desktop drawers do not use pull-down dismissal.

On desktop (1,024 CSS pixels wide and above), the workbench fits the viewport without a page scrollbar at typical window heights. The artwork stays fully visible without cropping; the bottom palette dock keeps color count, extraction mode, regeneration, Random, and locks close at hand. Swatches form a centered group with consistent, capped widths instead of stretching across the screen. Click a swatch to copy its hex value; use its separate Lock button to guide the next artwork. Long artwork captions are shortened in the dock; click the caption to read the full details.

Search, Palette tools, History, and Save & share open right-side drawers. Palette tools contains full color names, mode comparisons, and contrast tools. These drawers scroll internally and can be dismissed with Close, Escape, or a click on the backdrop. Keyboard focus returns to the opener when it is still present.

On smaller screens, the artwork and essential palette controls occupy the main view. Main hex labels use 14px type at the default text size, with separate copy and lock targets at least 44px tall. Swatches wrap according to available width and text size: five colors fit one row at 390px, while denser or narrower palettes use balanced rows. Enlarged text moves regeneration below the selectors when needed. Search, palette tools, history, exports, and artwork details open in dismissible sheets. Very short viewports or enlarged text may scroll to keep controls reachable without collapsing the artwork.

Buttons expose labels and lock state; feedback uses status regions; motion is reduced when requested by the browser/OS. The contrast pickers support keyboard selection. Browser features such as dialogs, popovers, clipboard access, and native sharing can vary by device. Consult the [release checklist](release-checklist.md) for checks actually performed rather than treating this description as a universal browser-support guarantee.

## Rights and privacy

The application is a way to explore museum data, not a declaration that every discoverable image is free to reuse. The discovery form can include artworks outside the public-domain color index. Follow the artwork's museum link and rights information before reusing an image. Do not infer rights from a successful download or infer a specific rights reason from HTTP 403 alone.

The browser contacts the museum for discovery and images, and a read-only Cloudflare endpoint for public indexed color data. Production builds initialize Vercel Analytics and load the configured Google font resources. Explicit Tone requests send a small artwork image through the application server to Gemini. Share actions persist a palette in Neon. See the [architecture's data-flow inventory](architecture.md#external-data-flows) for these boundaries.
