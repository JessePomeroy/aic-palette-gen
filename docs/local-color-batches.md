# Local color batches

`npm run colors:batch` processes a frozen version-1 public-domain artwork catalog in bounded, resumable batches. It stages metadata, canonical v2 signatures, compressed verification pixels, and exploratory grayscale tags outside the repository. It does not publish an app index, write to Neon, remove originals, or discover the whole museum collection.

## Run and resume

```bash
npm run colors:batch -- \
  --catalog /absolute/path/artworks.json \
  --reuse-manifest /absolute/path/manifest.json \
  --output /absolute/path/new-batch-job \
  --batch-size 25
```

The output's parent must already exist. Repeat the command to resume. Each invocation handles at most 25 entries by default, including skips; `--batch-size` accepts 1–100. Catalog ordering, normalized metadata, reuse manifest, and recipe are fingerprinted. Changing them requires a new job directory. Changing batch size is allowed.

No network requests are made by default. A missing local source pauses the batch. For catalog entries absent from the reuse manifest, explicitly add `--allow-download` to fetch 843px museum JPEGs into the job's `originals/`. Existing source paths are reused, not copied or deleted. Missing files explicitly listed in the reuse manifest must be restored rather than silently replaced.

Downloads are sequential with at least one second between request starts within an invocation, a ten-second timeout, no redirects, and a 10 MiB streamed body limit. Rate limits, server errors, and network interruption pause without advancing the pending item or automatically retrying. HTTP 403/404, invalid image responses, decoding failures, and embedded JPEG ICC profiles become explicit skip records. ICC normalization is not implemented. Reused local images must satisfy the manifest's sRGB contract.

## Verify

Repeat the same command with `--verify-only` to audit every committed record, decompress its sample, validate dimensions and SHA-256, and recompute signatures and tags. This performs no downloads or new image processing. An ordinary resume checks the last committed record plus any completed record ahead of the checkpoint; it does not rescan every earlier sample on every batch. Full audit is therefore required before considering any future cleanup or publication. Audit verifies derived data, not the continuing existence or contents of originals; source byte counts and hashes are retained as provenance.

Files are committed by same-directory atomic rename. A checkpoint advances only after its record and sample verify. If interrupted between those writes, resume verifies the record and advances without decoding again. A per-job `.lock` prevents concurrent writers. SIGINT/SIGTERM release the lock; a hard kill may leave it behind. Check the recorded PID and confirm the process has exited before manually removing that lock. Never remove an active writer's lock. Incomplete initial setup needs a new job directory. Atomic rename protects against process interruption, not guaranteed power-loss durability; keep backups. Temporary files left by a hard kill are retained.

## Stored data

- `plan.json`: immutable input fingerprint and recipe.
- `checkpoint.json`: committed cursor and indexed/skipped counts.
- `records/<artwork-id>.json`: normalized metadata plus either an explicit skip reason or signature, sample descriptor, colorfulness statistics, and source provenance.
- `samples/<sha256>.rgba.gz`: losslessly compressed canonical pixels, deduplicated by raw pixel hash. These are staging assets, not the runtime's `.rgba` files.
- `originals/`: downloaded originals retained until separately approved cleanup.

Colorfulness version 1 ignores alpha below 128 and measures Oklab chroma on canonical pixels. `grayscale` requires maximum chroma ≤ 0.005. Otherwise, less than 1% of pixels at chroma ≥ 0.02 yields `near-neutral`; the remainder is `colorful`. Even a tiny colorful accent prevents a grayscale tag. These thresholds are exploratory, not visually calibrated. Tags never exclude artworks or change app matching.

## Pilot and remaining scope

The initial pilot processed 25 already-cached museum images in two invocations (10 then 15), without new downloads. A later [live catalog refresh and approved full scan](full-color-scan.md) now provides the larger workflow; the existing category-search downloader is still not a full-collection enumerator. Full scanning was subsequently approved, but runtime publication, database migration, and original-image cleanup remain separate decisions. [Operations](operations.md#scan-monitoring-and-restarts) covers the persistent supervisor.
