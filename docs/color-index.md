# Locked-color index

**Random with locked colors now searches a bundled 2,500-artwork public-domain index.** The old 36-artwork live rejection scan has been removed. Unlocked Random and manual museum search are unchanged. This is a bounded subset of the collection, not an exhaustive catalog.

The design reverses that search: analyze selected images once, retrieve possible candidates, then randomly verify candidates until every locked color passes. Histogram retrieval is local; final verification loads the selected candidates' saved pixel samples. No museum JPEG re-download, browser re-decoding, database, or AI call is needed for this verification.

## Current release and integration

`static/color-index/expanded-2500-20260913/` contains the active version-2 index, matching artwork metadata, immutable RGBA samples and build report. It reuses 965 source images and adds 1,535 successfully downloaded images. The downloader attempted 1,620 new images from a 3,805-candidate pool, replacing 85 excluded inputs: 81 HTTP 403 responses, one HTTP 404 and three embedded ICC profiles requiring normalization. All 2,500 retained images decoded/indexed and passed saved-sample integrity checks. Every reused sample hash is unchanged. Original 843px JPEGs remain outside the repository; untagged JPEGs are explicitly interpreted as sRGB.

Both `starter-20260912` (481 artworks) and `expanded-20260912` (965 artworks) are retained unchanged for rollback and cached older clients. The initial release had 481 successful images from 500 selections across ten search categories; the second added 484 usable images from 519 new selections.

`createIndexedSearch` owns a workbench-local catalog and up to 32 verified cached samples. It validates index/metadata identity, applies `LOCKED_COLOR_MATCH_POLICY`, excludes the current artwork, and prefers unseen artwork IDs from browser history. Both index loading and sample verification honor cancellation; late completions cannot replace newer selections. Invalid/unavailable index data never triggers a museum-image scan. Full display images and palette extraction still load the selected image separately.

The UI displays index size and distinguishes:

- **No other close match in the N-artwork index:** all conservatively retrieved candidates were checked, or none were possible. This does not imply no match in the museum's full collection.
- **Incomplete/unavailable:** a sample could not be loaded/validated, or the check budget expired. This is not a color-rejection verdict.
- **Index unavailable/timeout:** the search could not finish. Current artwork, palette and locks remain unchanged.

The app allows up to 2500 candidate checks with a 30-second overall deadline; the current index fits within that bound. A first search fetches the index and metadata; later searches reuse them and lazily cache samples. Versioned asset paths prevent a new release from mixing metadata and pixel samples with an old browser cache. During matching, the UI uses a spinner with stable “Finding a match…” text rather than counting candidates. The indicator is decorative to assistive technology and stops animating for reduced-motion users; cancellation remains available.

The active index JSON is 11,223,902 bytes (3,088,972 gzipped), artwork metadata 1,310,203 bytes (277,323 gzipped), and 2,499 unique sample payloads total 289,433,100 raw bytes for the 2,500 artwork entries. Identical normalized samples share their content-addressed file. Samples are **not** downloaded as one bundle. Compression sizes are measurements, not a claim about a particular host's response configuration. The previous 965-artwork index was 1,253,467 bytes gzipped with 111,684,016 sample bytes; the initial release was 643,678 bytes gzipped with 55,192,452 sample bytes.

For the 2,500-artwork release, local Chromium checks found verified results for `#444f40`, `#556052`, `#e8c0c8` and `#bd9751` in 27–1,510 ms across eight searches; the first included catalog loading. Exhaustively rejecting `#444f40` + `#e8c0c8` checked 324 candidates in 2,673 ms. With a simulated 4× slower desktop CPU, individual-lock searches ranged from 78–6,810 ms and the exhaustive two-lock query took 8,123 ms. Random candidate ordering changes verification work; these are observations, not latency guarantees. The previous 965-artwork release observed 17–949 ms for individual locks and 1,006 ms for its exhaustive two-lock query. None of these are physical-phone or full-collection benchmarks.

The user reports good matching and tolerable speed on their phone with the initial release. The expanded release still needs phone feedback; the matching policy was not loosened, and a broad independently labeled accuracy study remains open.

## Build an index from local images

Prepare an explicit manifest next to your image folder. Files must already be in **sRGB**; the existing `node-vibrant/node` decoder is reused for pixel access, not ICC color-profile normalization or palette extraction. Declaring `colorSpace` acknowledges the input contract; it does not convert an image's profile.

Example `manifest.json` (the referenced image must already exist locally):

```json
{
  "version": 1,
  "colorSpace": "srgb",
  "corpus": "Local public-domain artwork pilot, manually selected",
  "entries": [
    {
      "artworkId": 27992,
      "imageId": "2d484387-2509-5e8e-2c43-22f9981972eb",
      "sourceUpdatedAt": null,
      "imagePath": "images/27992.jpg"
    }
  ]
}
```

Use the source metadata's update timestamp when known; `null` means it has not been recorded. Paths resolve relative to the manifest, not the shell's working directory. URLs and data URIs are rejected. Only use images you are permitted to analyze.

```bash
pnpm colors:index --manifest /absolute/path/manifest.json --output /absolute/path/new-index-directory
```

The output's parent directory must exist and the output directory **must not exist**. A previous run is never overwritten, including an interrupted run. Keep pilot data outside `static/` until it has been validated for release.

For a release, also pass `--catalog /absolute/path/artworks.json`. The builder validates that every manifest artwork has matching public-domain metadata, then emits metadata only for successfully indexed artworks. The catalog is version 1 with an `artworks` array; see `readIndexedArtwork` for normalization. The separate `pnpm colors:download --output /new-directory --limit 500` command prepares this catalog, a manifest and a download report. It follows the museum's [small-scale scraping guidance](https://api.artic.edu/docs/#scraping-data): one sequential request at most per second, a bounded selection, and no parallel scraper. It stops on rate limiting and skips tagged ICC images rather than silently misinterpreting them. Reruns require a new directory; no resume/overwrite behavior is implied.

For a larger total (currently capped at 2500), use `--extend-manifest /previous/manifest.json --extend-catalog /previous/artworks.json`. The downloader checks identity, public-domain metadata and source-file availability, references existing images without copying or downloading them, and excludes those artwork IDs from new selections. Metadata paging scales with the target (six pages per category at 2500, stopping early when exhausted). Candidates are interleaved across categories, and unusable images are replaced until the successful target or candidate pool is exhausted. The report separates candidate-pool size, attempted selections, reused/newly downloaded/total counts and skipped reasons. Exhausting the candidate pool can still leave the result below target. The builder reanalyzes the combined source manifest; incremental signature reuse and interrupted-run recovery are not implemented.

Outputs:

- `index.json`: version 2, corpus label, generation timestamp, successfully analyzed artwork/image IDs, metadata timestamps, signatures, and sample dimensions/SHA-256 digests.
- `samples/{sha256}.rgba`: immutable interleaved unsigned 8-bit sRGB RGBA pixels used for indexing and verification. Identical pixel payloads share a file. These bytes are already resized; **do not decode or resize the museum JPEG again to verify a candidate**.
- `report.json`: separate selected/analyzed counts and skipped IDs with read/decode/empty-sample reasons. It does not embed local image paths.
- `artworks.json` when `--catalog` is supplied: version 1 public-domain display/filter metadata matching the successfully indexed entries.

The builder is sequential and local-only. Failed images are excluded from the index, not recorded as nonmatches. If every image fails, it writes the report and exits unsuccessfully without publishing `index.json`. Partially successful builds exit successfully with explicit skipped counts; inspect the report before using the index. This standalone runtime builder does not resume interrupted output directories. The separate [full-scan pipeline](full-color-scan.md) now handles resumable staging and live refresh; it does not automatically publish a runtime release.

## Version 2 analysis and sample recipe

- Downscale only when needed, maintaining aspect ratio, to at most 200 pixels on the longer side. The offline decoder currently uses its default resize algorithm; compare its results against browser image sampling in the pilot.
- Interpret input as encoded sRGB, linearize each channel, then convert using [Oklab's reference matrices](https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab).
- Ignore pixels with alpha below 128. Keep all other pixels, including black, white, gray, and small accent populations.
- Quantize Oklab to a 0.02 grid along each axis. Store occupied bins as `[L bucket, a bucket, b bucket, pixel count]`, sorted lexicographically. Multiplying the first three coordinates by 0.02 recovers the representative bin color.
- Normalize coverage by the number of included pixels, not the canvas dimensions.
- Save those exact decoded/resized pixels before discarding the offline image. Their dimensions and SHA-256 digest bind verification to the indexed sample. `readColorSample` checks both length and digest and returns an owned copy. Missing, truncated, corrupt, or mismatched samples are unavailable data, not rejected colors.

Version 2 deliberately retains the 200px analysis size and 0.02 grid. It makes verification use the same saved pixels rather than a browser-specific recreation. Version-1 indexes have no such sample contract and are rejected; rebuild from the original manifest into a fresh output directory. This is an experimental format change, not a migration of any deployed data.

This compact representation **estimates** color coverage. Rounding a pixel to a bin can change its Oklab position by up to `sqrt(3) * 0.01 ≈ 0.0173`, before accounting for resizing. Consequently, near-threshold histogram matches can differ from direct-pixel matches in either direction. Nearest-bin distance is not a claimed nearest original pixel distance. Do not treat the index as an exact-color proof.

The initial experimental acceptance policy is `maxDeltaE: 0.05`, `minCoverage: 0.01`. These are calibration hypotheses, not universal perceptual thresholds, and do not reproduce the old RGB-distance-30 behavior. Changes to the analysis recipe require a new index version; query policy can be selected explicitly without rebuilding.

The app explicitly selects `LOCKED_COLOR_MATCH_POLICY`: `maxDeltaE: 0.03`, `minCoverage: 0.01`, `minColoredChroma: 0.015`, `minChromaRatio: 0.5`, `maxHueDegrees: 25`. Qualifying pixels must pass all applicable conditions together. Neutral locks skip hue/chroma checks. Human review exposed gold/sepia and gray/green false matches; these guards are not yet broadly calibrated. The original offline pilot and historical measurements below used 0.05 without hue/chroma guards; they do not validate the app policy. Matching includes the entire image, including backgrounds, frames and display cases, without segmentation. Histogram retrieval deliberately ignores hue/chroma and expands distance for rounding, so it cannot hide a qualifying exact-pixel match; final acceptance applies the unexpanded app policy.

`findColorCandidates` allows the bin-rounding margin `sqrt(3) * 0.02 / 2` during retrieval only. The triangle inequality ensures a strict match on the same pixel sample is not dropped because of bin rounding. It does not excuse a different image, profile, or resize recipe. `findIndexedArtwork` uses the **original**, unexpanded acceptance policy when checking the saved pixels.

## Query interface

```ts
import { findIndexedArtwork, readColorIndex, LOCKED_COLOR_MATCH_POLICY } from './src/lib/colors/color-index';

const index = readColorIndex(JSON.parse(savedJson));
const result = await findIndexedArtwork(index, ['#8c98ae', '#104ba7'], {
  currentArtworkId: 27992,
  seenArtworkIds: recentArtworkIds,
  signal: controller.signal,
  policy: LOCKED_COLOR_MATCH_POLICY,
  loadSample: async (entry, signal) => {
    const response = await fetch(`/color-index/expanded-2500-20260913/samples/${entry.sample.sha256}.rgba`, { signal });
    if (!response.ok) throw new Error('Sample unavailable');
    return new Uint8Array(await response.arrayBuffer());
  },
});
```

`readColorIndex` throws for incompatible or malformed data. Call it once at the JSON loading seam; an unavailable or invalid index is not a no-match result.

`findIndexedArtwork` is asynchronous. It returns:

- `match`: chosen entry, per-lock **verified sample coverage/nearest-pixel distance**, and `repeated` for a previously seen result.
- `no-match`: no candidate other than the current artwork qualifies; all relevant samples were checked successfully, or the conservative candidate pool was empty.
- `incomplete`, reason `limit` or `unavailable`: the check budget ran out, or unavailable/corrupt samples prevent an exhaustive verdict. Do not present this as “no matching artwork exists.”

All results include `candidateCount`, `checkedCount`, and `unavailableCount`. Candidate counts are not verified-match counts. Cancellation throws the request's abort reason, including after an in-flight sample load/hash check. Locks and policy are snapshotted across awaits.

The library defaults to at most 16 samples, configurable from 1–2500; the app selects the corpus size, capped at 2500. Each load receives a linked five-second abort signal; loaders must honor it. The caller supplies an overall deadline/cancellation signal. Failure to find a match before the check budget ends is explicitly incomplete, not a negative search result. No further samples are fetched after a verified result.

Candidates are sampled uniformly without replacement, unseen IDs first, then seen IDs after all unseen candidates have been attempted. A candidate that fails strict verification is discarded, never accepted with a looser tolerance. `repeated` means the returned artwork was seen; if `unavailableCount` is nonzero, it does not prove there were no possible unseen matches. With successfully loaded samples, random rejection sampling preserves equal selection probability among strict matches in the searched tier. It is not uniform over artists or image IDs. The caller owns session history.

Locks use AND semantics; a perfect match to one never compensates for a missing other. Duplicate or nearby locks may share the same pixel population. No prescribed proportions or distinct spatial regions are implied. Query input arrays and hex strings are not modified. The workbench's `applyLocks` retains exact swatches and slots when an indexed result is selected.

`matchColorPixels(decodedSrgbRgba, hexes, policy)` verifies the supplied pixels without histogram rounding, using the same color math and all-lock coverage policy. Its coverage is exact for that supplied sample, not for a different-size original. It does not load images or normalize profiles; callers must control preprocessing. Use it for final acceptance rather than treating an estimated histogram match as proof.

With no locks, this module can sample its whole indexed corpus; the app's unrestricted Random flow is separate and is not being redirected here.

## Verification and next milestone

```bash
node --import tsx --test tests/color-index.test.ts tests/color-index-builder.test.ts
pnpm test
pnpm check
```

Tests cover reference color bins, all-lock coverage, minority accents, alpha, fixed/explicit policies, file safety, typed index validation, exclusions/repeats, and offline image → saved index → qualifying random ID.

Next: human-labeled queries across the starter corpus, physical-phone latency checks, ICC/resize consistency review, and calibrated coverage before a broader collection release. No corpus-wide download, external deployment or database change was performed for this integration.

### Version 1 smoke-test findings — 2026-09-12

The first 20-artwork public-domain convenience sample downloaded and indexed successfully (5.4 MB original JPEGs, zero failures). The version-1 JSON was 117,779 bytes / 32,729 bytes gzipped. Headless Chromium warm query p95 was 0.4 ms, or 1.8 ms under a 4× desktop CPU slowdown; this is not a physical-phone or full-collection benchmark.

Across 36 diagnostic queries × 20 artworks, the histogram differed from direct checks of the same offline pixels in 14 cases, and from browser 400px pixels in 21 cases. Different offline/browser preprocessing also changed decisions. These are numerical agreement checks, not human accuracy labels. Finer grids reduced rounding error but increased signature storage sharply.

An isolated experiment with a conservative retrieval radius of `strict radius + sqrt(3) * bin width / 2` retained all 225 direct-positive pairs on the same 200px pixels, while returning 320 possible candidates. Extra candidates still need strict pixel verification. That bound covers bin rounding only, not differences from resizing, decoding, profiles, or source-image changes. The index version and default policy were not changed.

At this historical experiment's stage, the next steps were standardized preprocessing and conservative retrieval with strict acceptance. Those mechanisms were subsequently implemented in version 2 and integrated with Random; independent human labeling remains open. Studio backgrounds and photo cases legitimately count under the current full-image rule; excluding them would be a separate product decision.

The detailed report is in the Obsidian vault at `02_reference/project-support/chromacollection/locked-color-pilot-2026-09-12.md`. Reproducible raw inputs, manifests, evaluation scripts, and JSON results are retained locally at `/home/strayblackdog/Documents/temp/chroma-color-pilot-20260912.OdtFrX/`, outside the repo and public assets.

### Version 2 canonical-sample verification — 2026-09-12

Rebuilt the same 20 artworks into `index-v2/`, preserving `index-v1/` and all original JPEGs. Chromium and WebKit both reproduced the offline 200px pixel coverage exactly for all **720 comparisons**. Conservative retrieval missed none of the 225 strict-positive pairs, and all 36 complete search queries returned a verified matching artwork or the correct no-match state. These are consistency tests, not independent human accuracy claims.

The v2 index is 120,019 bytes / 33,936 bytes gzipped. Saved samples total 2,443,464 raw bytes; independently gzipping them totals 1,439,998 bytes (compression measurement only; the builder currently writes raw files). Future hosting must lazy-load/cache samples rather than download the entire corpus upfront. Measured warm search p95, including hashing and strict pixel verification but excluding sample fetches, was 11.8 ms in Chromium and 12 ms in WebKit. These are workstation measurements, not a physical-phone benchmark.

Nine decisions still differed between the canonical 200px samples and the separate browser-resized 400px reference (two extra accepts, seven misses). Freezing a sample resolves cross-runtime inconsistency; it does not establish the right perceptual tolerance or image resolution. At the time of this 20-artwork pilot, no UI switch had happened; the current starter integration is documented above. Matching now explicitly includes the whole image.
