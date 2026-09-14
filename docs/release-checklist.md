# Release history and verification

## Full-scan R2 production release — 2026-09-14

- [x] Complete final scan audit: 59,056 records accounted for, 59,025 indexed and 31 skipped; indexed originals and saved samples verified. All original images remain local and unchanged.
- [x] Create the separate `chromacollection-index` bucket in the existing Cloudflare account; leave Angels Rest buckets and DNS unchanged.
- [x] Package 1,553 immutable assets (3,290,386,093 bytes) without JPEG re-decoding, credentials, source paths, private receipts, or operator reports in the public inventory.
- [x] Upload 1,552 data assets with R2-confirmed checksums/sizes, then publish the manifest last. Public root: `https://chromacollection-index.thinkingofview.workers.dev/v3/full-59025-20260914`.
- [x] Deploy the read-only gateway, version `f15dc4f0-b122-48d7-a3fa-5b3574edfa7f`. Verify CORS, immutable cache behavior, and exact sample ranges through real browser searches.
- [x] Connect the local app to v3 with unchanged strict matching, bounded caches, a 12 MiB download budget, four overlapping candidate loads in random selection order, and the existing check/deadline limits.
- [x] Pass 122 Node tests, Svelte checks with zero errors/warnings, focused Biome, a production build, and 31 workbench scenarios in each of Chromium and WebKit. Fixtures make no live provider/database writes.
- [x] Run 21 hosted-data queries: single-lock matches in 665–5,042 ms; difficult two-lock queries correctly incomplete at the bandwidth cap in 10,504–15,634 ms. These are workstation/browser measurements, not physical-phone guarantees. The earlier serial loader timed out on pink; the final bounded-parallel run had no timeouts.
- [x] Update the pipeline documentation and inspect the rendered SVG.
- [x] Inspect the rendered 390px mobile app using real hosted index data and museum images (initial catalog response fixed to a known artwork). A blue lock `#869ab1` selected a different artwork, preserved the exact lock, and displayed `59025 indexed`; 18 R2 responses, no page errors, and no sharing/Tone calls. An earlier harness used the desktop button label; another render wait timed out during concurrent local verification. The final isolated smoke passed.
- [x] User reports the phone preview works well and locked matches do not take too long; explicitly approved deployment on 2026-09-14. This is user feedback, not a claim that every suggested device scenario was separately measured.
- [x] Deploy the tested app snapshot to production: Vercel `dpl_EHuxHc4RMsWCQsfjoueos1NXRfTk`, READY and aliased to `https://www.chromacollection.online`. The 24 changed release files were overlaid on `f61c831`; all five unrelated scanner changes and private environment/report files were excluded. Release-source digest: `3ad87f193e81ee365db4ae29d895cf375dd2e49ceb83b6f62595800c3795326e`. No Git commit or push was made.
- [x] Verify the production pointer and R2 manifest SHA-256/count. A rendered 390px production browser check retained lock `#a59d84`, selected Rembrandt's *Clement de Jonghe, Printseller*, displayed `59025 indexed`, and made 22 R2 requests with no page errors. Initial museum metadata was fixed to a known artwork; hosted index data and museum images were real. No sharing or Tone calls were made.

The user subsequently authorized updating all docs and committing/pushing all project changes through a reviewed PR and merge. That source-control follow-up includes the previously separate scanner sizing/retry fixes. The original direct-deploy snapshot remains retained; GitHub PR history identifies the follow-up commit and merge. Local `.bug-hunter` reports and private data are excluded. Earlier v2 assets remain untouched for compatible rollback.

## Historical preparation baseline

Preparation baseline, 2026-09-13: the 2,500-artwork index, sharing hardening and one live tone test were verified locally. Hosted development/preview database configuration was separated from production with user approval. That preparation did not write to the production database or change its schema. This document records evidence and outstanding release decisions; GitHub and Vercel history establish which revision is currently deployed.

### Verified locally at the historical baseline

- [x] Build `expanded-2500-20260913`: 965 reused sources plus 1,535 new images; 85 unusable inputs replaced. All 2,500 images indexed successfully, all samples pass integrity checks, and all 965 reused hashes are unchanged. The 481- and 965-artwork releases remain immutable.
- [x] Preserve strict all-lock matching, exact palette locks, cancellation and distinct no-match/unavailable outcomes. Keep the spinner and reduced-motion behavior. The check cap is now 2,500, with the same 30-second deadline.
- [x] Run 80 automated tests and Svelte checks (zero errors/warnings), focused Biome checks and a production build with an explicitly empty `DATABASE_URL`. Database initialization is lazy; building no longer needs a placeholder credential.
- [x] Run Chromium and WebKit index UI scenarios (match, complete no-match, unavailable, missing index and cancellation), including spinner/reduced-motion behavior.
- [x] Verify JSON/CSS exact hexes, PNG dimensions, ASE headers/names/counts and 1200×1440 artwork cards in both engines. Export fixtures use synthetic museum images; opening ASE in Adobe software remains a manual check.
- [x] Verify sharing failure/retry, duplicate-click prevention and saved-link recovery after clipboard denial or native-share cancellation at 320px, 390px and desktop widths in both engines.
- [x] Verify shared-page image proxy fallback and clear failure messaging if both image sources fail. Eight colors with a long name no longer expand a 320px mobile viewport horizontally.
- [x] Verify the later viewport workbench with 31 browser scenarios in both Chromium and WebKit: centered five/eight-color swatches, desktop drawers, mobile sheets, long metadata, lock/mode/history state, exports, share failure/retry, matching, cancellation, and animated dismissal. WebKit ran in the already installed Playwright 1.59.1 Ubuntu container because the host lacks a required library. These are browser-engine checks, not physical-device measurements.
- [x] Mark canonical `.rgba` samples as binary in `.gitattributes` and compare every one of the 3,953 committed index files against its local bytes. Raw sample hashes must not change through Git line-ending conversion.

The 2,500-artwork index is 3,088,972 bytes gzipped, with 277,323 bytes of gzipped metadata and 289,433,100 raw bytes of lazy-loaded samples. In local Chromium, eight individual-lock searches took 27–1,510 ms; an exhaustive two-lock negative checked 324 candidates in 2,673 ms. Under simulated 4× CPU slowdown, those ranges were 78–6,810 ms and 8,123 ms. These observations depend on randomized candidate order and local networking; they are not physical-phone benchmarks or a broadly labeled accuracy study.

### Database and sharing at the historical baseline

Neon stores saved-palette share links only. Browser history/locks remain local; the index remains static assets. No account model or new schema was introduced.

- [x] Use existing Neon project `aic-palette-gen` (`curly-bird-36387716`). The isolated `development` branch (`br-divine-bar-ai3vhnfl`, endpoint `ep-wild-smoke-ai89gkkb`) is a schema-only copy of production, created with approval on 2026-09-12, with no automatic deletion.
- [x] Keep the local development connection in ignored `.env`, owner-only permissions (`600`). Never expose credentials in documentation or commits.
- [x] Verify the copied `palettes` schema: text ID, integer artwork ID/count, JSONB colors, text mode and timestamptz creation time. No migration or initialization was needed.
- [x] Verify real development saves (201), shared pages (200), exact structural color/mode/count/artwork round-trips and missing-link 404s. Retained fixtures include tone palette `f1d7a8d2-b528-4d5b-8fee-ab28c9a8d40b` and eight-color layout fixture `6b678efe-811e-4fb2-b7dc-02f40a503a2c`, both for artwork 27992.
- [x] Test database outages through the actual routes with a stubbed database transport: friendly 503 responses, retry guidance, no private exception leakage. Invalid UUIDs return 404 before a database query.
- [x] Validate save inputs, enforce the 16 KB cap on streamed bodies even with absent/false Content-Length, reject cross-site browser submissions, and test all relevant failure statuses.

Basic burst controls use fixed 60-second windows per server instance: saves allow 10 requests per client and 100 per instance; tone allows 3 per client and 20 per instance. Entries expire each window and the aggregate cap bounds memory. These are **best-effort**, not distributed quotas, authentication or a defense against a distributed attack. Vercel's firewall is enabled but had no custom rules when checked. Deployment-wide rate limiting and provider spend limits remain a release decision; no firewall rules or pricing terms were activated.

### Hosted environments and tone at the historical baseline

- [x] Confirm Vercel project `aic-palette-gen`, serving `https://www.chromacollection.online`, with GitHub repository `JessePomeroy/aic-palette-gen` and production branch `main`.
- [x] Split `DATABASE_URL` into production-only and development/preview entries. Decrypted comparisons confirmed that production's value was unchanged and development/preview exactly match the isolated local connection. Other environment variables were not changed.
- [x] Complete exactly **one approved live Gemini request** through the mobile UI. It returned five valid colors, saved to development, and opened as a rendered shared page. The credential was held only in the temporary verification process, which was stopped afterward. Normal local `.env` still has no Gemini key; local tone remains unavailable unless configured separately.
- [x] Validate malformed/partial provider output offline, remove automatic retries, apply a 30-second provider timeout, and keep credentials out of request URLs and error responses. The built tone function has a 45-second duration limit.

Environment changes are not retroactive: **four older READY previews still exist and must not be used for database-write testing** until replaced or retired with approval. No older preview was deleted or redeployed.

### Historical outstanding decisions (superseded where noted)

This checklist records the 2026-09-13 baseline, not present-day deployment status. The 59,025-artwork release, phone approval, and production deployment above supersede the old index and rollout gates. Deployment-wide abuse controls and retirement of old previews remain separate decisions; see [current limits](decisions-and-limits.md).

- [ ] Check the 2,500-artwork release on a physical phone: first uncached load, one/two locks, several Random attempts and saved links. The existing tailnet-only preview is `https://cachythistle.cinnebar-inanga.ts.net:8444/`.
- [ ] Approve deployment-wide abuse controls and any provider usage/pricing implications. The app's per-instance safeguards are deployed; they are not distributed quotas.
- [ ] Replace or retire older previews when deployment actions are approved.
- Deployment authority and hosting were subsequently approved. The full data release is in R2; the app has been deployed through Vercel CLI from a checked snapshot. The new source upload reused unchanged retained v2 assets. No paid plan upgrade was made.

The unchecked historical 2,500-artwork device checklist is not a pending gate for the deployed v3 release. User feedback on the full-index phone preview is recorded above without asserting exhaustive device coverage.

## Rollback

Keep releases immutable, including `starter-20260912`, `expanded-20260912`, and `expanded-2500-20260913`. Current v3 selection uses `static/color-index/release.json` (root and manifest hash). An older v3 pointer needs a complete compatible release; a v2 rollback needs its matching earlier app deployment. Do not overwrite samples or delete saved palettes. See [release operations](operations.md#release-and-rollback).

The environment split can be reversed using approved environment changes if necessary; production's credential was never modified. A future database migration requires its own rollback plan.
