# Approved local full scan

The full scan consists of live catalog reconciliation, a 300-record image pilot, the remaining image batches, and a final audit. It does not publish runtime assets, change Neon, or remove source images.

For the full project context and visual graph, see [how the artwork database is built](data-pipeline.md). For persistent process supervision, safe restarts, and the current service's status commands, see [scan monitoring](operations.md#scan-monitoring-and-restarts).

## Refresh and freeze the live catalog

```fish
npm run colors:refresh -- \
  --output /absolute/path/new-live-catalog \
  --baseline /absolute/path/historical-catalog/artworks.json \
  --reuse-manifest /absolute/path/existing-images/manifest.json
```

The [museum API](https://api.artic.edu/docs/#scraping-data) is queried sequentially, no faster than one request per second. Each search uses explicit public-domain/image filters, ascending artwork IDs, and a new exclusive lower ID bound, so it never deep-paginates past the search result window. An initial highest ID fixes the upper bound. Each page's remaining total must agree with the initial count minus already collected rows. Final queries verify the count, highest eligible ID, and absence of eligible IDs above the initial bound.

`pages/` retains validated page responses for restart. `--max-pages` can bound an invocation to 1–1000 new pages. Rerun with the same inputs to resume. Invalid rows, ordering, count drift, network errors, and rate limits stop the refresh without publishing a completion report. A live collection can change while requests are in flight: the result is a recorded observation window, not an atomic museum database snapshot. Drift requires investigation before a new frozen catalog is accepted.

Completed output includes `artworks.json`, update timestamps in `provenance.json`, exact added/removed/image-changed/metadata-changed IDs in `reconciliation.json`, and a checksum/count report written last. `reuse-manifest.json` includes only existing originals whose image ID **and source update timestamp** still match the live record. The historical baseline is never overwritten. Removed means absent from the current eligibility query; it does not assert a specific reason such as deletion or a rights change.

## Pilot through full scan

```fish
npm run colors:scan -- \
  --catalog /absolute/path/new-live-catalog/artworks.json \
  --reuse-manifest /absolute/path/new-live-catalog/reuse-manifest.json \
  --output /absolute/path/new-full-scan
```

Omit `--reuse-manifest` if refresh produced no reusable sources. The scan runner explicitly enables image downloading; the underlying `colors:batch` command remains offline by default. A separate `<output>.scan-lock` covers the gaps between batch-level locks. The PID is printed on startup. Only one scan should run at a time, including against different output paths, to respect museum request limits.

The first 300 catalog records form a throughput/integrity pilot, not a statistically representative calibration sample. At least 90% must index successfully. All pilot samples are decompressed and checked against their hashes, dimensions, signatures, and tags; originals are checked against recorded source hashes. The runner then continues automatically under the full-scan approval. Tags remain exploratory and never exclude artworks. If more than 20% of a batch of at least 20 records fails, the runner stops for inspection. This catches systematic access or decoding trouble instead of recording an entire collection as bad images.

Image requests remain sequential and paced within and between batches. Transient pauses retry at most six times without forward progress, backing off from one minute to fifteen minutes; rate limits wait at least fifteen minutes. `Retry-After` can extend that wait. A requested cooldown longer than a day pauses for manual resumption. Less than 5 GiB of free disk also pauses the scan. Explicit per-image skips remain in the audit trail and are not automatically retried.

The batch downloader retains 843px-wide requests for ordinary images. For originals narrower than 843px, it uses the catalog dimensions to request a smaller derivative that fits within an 843px box. A bounded inspection of an HTTP 403 body can recognize the museum's explicit enlargement restriction; only that error receives one fallback request at 50% of native size. Missing or stale catalog dimensions therefore do not automatically become permanent skips. Both requests share the same pacing, timeout, byte limit, and response validation. Other access denials are not retried by this sizing fallback. Embedded ICC profiles still require color normalization and are never silently stripped locally.

An explicitly approved retry of durable skips must retain their old receipts and checkpoint in an archive before changing the job. Rewind to the first archived record and replay using the unchanged catalog and analysis recipe; existing successful receipts are verified and reused, not redownloaded. Counts temporarily reflect the replay cursor, not the amount of preserved data. Preserve all safety stops and original image files. Do not merely restart at the old cursor, which would leave previously skipped artworks behind.

## Status and completion

- `checkpoint.json`: image cursor and indexed/skipped counts, saved after each verified record.
- `scan-status.json`: pilot/scanning/waiting/verifying/paused/complete status. During waits it records the next retry time. Consult the checkpoint for counts if status is paused.
- `pilot-report.json`: pilot acceptance, tag/skip counts, storage measurements, and original hash verification.
- `scan-report.json`: written only after the entire frozen catalog is accounted for and both canonical samples and originals pass a final audit. Reports successful analysis separately from explicit skips.

Completion is for the frozen catalog, not for artworks that become eligible after the refresh. Original images, metadata, compressed canonical pixels, and signatures are retained locally. The separately approved [v3 packaging and publication](operations.md#release-and-rollback) now supplies the live app's 59,025-artwork index; the scan command itself never publishes it.

## Completed audit and release — 2026-09-14 UTC

The final audit completed at **12:50:54 UTC**: all **59,056** frozen records were accounted for, with **59,025 indexed** and **31 skipped**. Every indexed original hash and canonical sample verified. The report's `samplesVerified: 59056` counts audited records including skips, not 59,056 distinct pixel samples.

Skips: 19 requiring color-profile normalization, eight HTTP 404 responses, two invalid image responses, and two decode/analysis failures. Tags: 55,748 colorful, 2,114 near-neutral, and 1,163 grayscale artworks. The completed supervisor stopped normally; an inactive successful service is not a stalled scan.

The approved release preserves 58,881 unique canonical samples in R2 packs and all original images locally. The production app is live at [ChromaCollection](https://www.chromacollection.online); see [release evidence](release-checklist.md) for checks and rollout history. No additional retry or cleanup is implied by completion.

Status reflects the last completed batch and can lag the per-image checkpoint while the next batch is working. The pilot's `elapsedSeconds` measures the current runner invocation; after a restart it is not total pilot wall time. Original-byte storage figures cover indexed records, not any source files retained for skipped images.

## Initial live run — 2026-09-13 UTC

The refresh observed 59,056 eligible artworks across 591 pages from 02:59:02 to 03:08:55 UTC. Against the February 2025 snapshot: 1,707 added, 207 removed, 511 changed image IDs, and 5,496 changed normalized metadata records. All 2,500 cached originals matched current image IDs and source timestamps.

The 300-record pilot passed at 03:19:11 UTC: 293 indexed and 7 HTTP-403 skips. All 293 original hashes and all indexed canonical samples verified. Tags were 276 colorful, 8 near-neutral, and 9 grayscale; 68 originals were reused. The full scan then started automatically. This documents a passed pilot and a launched scan, not completion of the full catalog; only the final `scan-report.json` establishes that.

SIGINT/SIGTERM interrupt cleanly and release owned locks. A hard kill can leave locks: confirm the recorded process is no longer running before removing only its exact stale lock, then rerun the same command. Do not remove a live process's lock. Atomic writes protect against process interruption, not guaranteed power-loss durability. Preserve backups; cleanup still requires separate approval.
