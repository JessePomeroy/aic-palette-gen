# Complete artwork catalog: bulk snapshot import

The museum [recommends bulk data](https://api.artic.edu/docs/#data-dumps) for full-collection work. Its [official data repository](https://github.com/art-institute-of-chicago/api-data) links to the complete metadata archive. The GitHub JSON files themselves are only samples. No artwork images are included in the archive.

## Source and freshness

On 2026-09-13 UTC, the official archive responded with `Last-Modified: Sun, 16 Feb 2025 08:32:05 GMT` and `Content-Length: 119891546`. This is an old snapshot, despite documentation describing scheduled updates. Do not label the resulting catalog current or use historical public-domain flags as a substitute for current release eligibility.

Two read-only live API checks returned 132,744 total listed artworks and 59,056 search results with `is_public_domain=true` and an `image_id`. These counts describe the API at observation time, not the archive, and do not prove image availability. At this baseline stage, a live metadata reconciliation was still necessary; the later [full-scan workflow](full-color-scan.md) completed that refresh before image processing. The archive remains useful as a reproducible historical baseline.

The completed baseline accounts for all 134,078 archive artwork records: 57,556 eligible, 74,021 not marked public domain, and 2,501 public-domain records without an image. There were no malformed image IDs or blank titles among otherwise eligible records. The normalized catalog is 30,296,812 bytes. The live eligible count is 1,500 higher, but that net difference is not a list of missing artworks and does not account for changes or removals.

## Import

Download and retain the official archive outside the repository. Record its response headers. Validate the archive's artwork members before extraction: accept only regular, unique `artic-api-data/json/artworks/<positive-integer>.json` files; reject links, traversal paths, and duplicates. Extract only that subtree into a fresh directory with ownership and permission restoration disabled. Do not extract the archive's Git directory or unrelated resource folders.

```bash
npm run colors:catalog -- \
  --input /absolute/path/extracted/artic-api-data/json/artworks \
  --archive /absolute/path/artic-api-data.tar.bz2 \
  --source-modified 'Sun, 16 Feb 2025 08:32:05 GMT' \
  --output /absolute/path/new-catalog-directory
```

The importer is offline. The caller must supply the complete, validated artwork folder from the specified archive; hashing the archive records provenance but does not independently prove that a supplied extraction is complete. Compare the archive's validated member count with `totalRecords` in the report. This initial archive contains 134,078 validated artwork files.

Records are normalized with the app's existing catalog validator and sorted by artwork ID. Eligibility requires explicit public-domain status, a supported image ID, and a nonblank title. Exclusions retain artwork IDs and reasons; malformed JSON, identity mismatches, unexpected files, or missing rights flags stop the import rather than silently creating an apparently complete catalog. Images are not fetched or tested, and nothing is filtered by grayscale.

## Outputs and restart behavior

- `artworks.json`: version-1 catalog compatible with the local batch processor.
- `provenance.json`: archive source and SHA-256 plus each included artwork's source/API update timestamps and snapshot timestamp.
- `excluded.json`: every excluded ID and reason.
- `plan.json`: deterministic recipe/input identity.
- `report.json`: counts, archive provenance, catalog digest, and explicit freshness limitation. Written last as the completion marker.

Repeat the import command to verify identical outputs or finish missing files after interruption. Existing differing files are never overwritten. A `.lock` prevents concurrent writers; after a hard kill, confirm its PID is no longer running before manually removing it. Incomplete initialization requires a new output directory. Atomic rename handles process interruption, not guaranteed power-loss durability. The command retains all source files and never writes to Neon, changes runtime assets, commits, or publishes anything.

This historical import was followed by [live reconciliation and an approved full-scan workflow](full-color-scan.md). That later refresh froze 59,056 eligible records; the old archive remains the reproducible baseline described here. Full image downloading and source cleanup are not part of this import command.
