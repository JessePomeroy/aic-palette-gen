# Decisions, limitations, and roadmap

[Documentation home](README.md) · [Architecture](architecture.md) · [Operations](operations.md)

This document records what the current implementation deliberately does, what it does not establish, and which changes need a separate decision. It is not a promise that every proposed improvement will be implemented.

## Decisions embodied in the code

### Precompute image evidence; verify the same pixels

Downloading many candidate images during each locked-color search is slow and dependent on museum availability. The current approach performs preparation ahead of time, retrieves candidates from histograms, and checks the precise saved sample pixels. This makes indexing and runtime verification consistent without pretending a rounded histogram is exact evidence.

Tradeoff: retained pixel samples and a versioned index need storage, validation, hosting, and release management. A smaller palette summary alone is not sufficient for every-lock matching.

### Treat locks as workbench state

Locks preserve exact swatches in exact positions across artwork changes. New extraction fills unlocked slots. This supports exploring several works around a chosen color theme.

Tradeoff: manually selecting unrelated artwork can keep a locked color that is not present in that image. Only successful indexed matching establishes the current matching-policy conditions.

### Keep ordinary extraction local; make Tone explicit

Dominant and Vibrant use browser Canvas/k-means. Tone is an optional server/provider request intended to interpret atmosphere rather than reproduce literal pixels.

Tradeoff: local clustering may vary between runs and browser decoding/resize behavior. Tone depends on configuration, provider availability, and usage limits, and may invent an interpretive palette. Neither is used as the index's strict pixel proof.

### Separate collection search from shared-palette persistence

The art index and catalog are file-based. Neon stores small user-selected shared palettes. Browser history is another independent store.

Tradeoff: shared artwork presentation still needs museum metadata; sharp images use the museum, while verified indexed samples can supply labeled low-resolution previews. Local history is not cross-device, and no account or revocation model exists. The full collection does not become a Neon image cache simply because a database connection is available.

### Freeze inputs and retain an audit trail

The catalog refresh is recorded as an observation window. Batch fingerprints prevent changed inputs from quietly reusing a checkpoint. Receipts distinguish indexed results from unavailable inputs. Source and sample hashes support integrity checks.

Tradeoff: fixed jobs do not automatically incorporate new museum records during a long scan. A changed recipe/catalog requires deliberate new work. Hashes are consistency evidence, not rights certification or independently labeled accuracy.

## Important current limitations

| Area | Current limit or caveat |
|---|---|
| Locked artwork search | Full-scan release contains 59,025 works; 31 explicit skips from the frozen 59,056-record catalog |
| Unlocked Random | Capped listing-position sampling; not a uniform full-collection random draw |
| Search filters | Live discovery filters do not constrain Random matching or unlabeled “similarity” beyond their implemented path |
| Color presence | Whole-image sample includes backgrounds, frames, and display cases |
| Perceptual accuracy | Experimental tolerances; no broad independently labeled calibration set |
| Image profiles | No automatic ICC normalization; network batch path skips embedded JPEG profiles |
| Image fallback | Only matching, verified indexed samples; at most 200px of detail, labeled in the UI and artwork exports; does not make live discovery/metadata work offline |
| Grayscale | Informational conservative tags; no automatic exclusion and no full semantic classification |
| Full scan | Completion depends on an audited final report; metadata eligibility alone is not downloaded-image coverage |
| Runtime scale | On-demand R2 data; 12 MiB response-body budget, 2,500 checks, 30-second deadline; difficult queries can be incomplete |
| Sharing | Anonymous public links; no account permissions, revocation UI, edit API, or deletion API |
| History | Browser-local: 24 recent palettes and 10 recent searches; searches restore filters/page and refetch live results; not a complete backup or cross-device sync |
| Abuse controls | Per-instance memory limits; not distributed quotas or authenticated access control |
| Image proxy | Restricted museum target, but no explicit byte cap/server deadline in the handler |
| Deployment | Current local work is not automatically present on production or older previews |
| Long-running jobs | Transient user service survives interactive sessions, not guaranteed reboot/logout/power-loss recovery |

## What the tests establish—and what they do not

The suite covers strict all-lock matching, conservative candidate retrieval, sample corruption, catalog identity, cancellation, lock ownership, history validation, export-relevant color behavior, request validation, redacted route errors, resumable batches, live-refresh accounting, pilot gating, and supervisor recovery policy.

Historical browser checks cover specific Chromium/WebKit scenarios and local fixtures. Numerical canonical-sample agreement is not the same thing as “humans judged all matches correct.” A live provider test is not a guarantee of availability or output quality on every later request. A successful app build is not a production release.

Keep those distinctions in marketing, demonstrations, and release notes. Avoid claims such as “searches every artwork,” “perfect color matching,” “all data lives in Neon,” “fully offline website,” “private share links,” or “WCAG-certified” unless the implementation and evidence change to support them.

## Decisions after the production release

1. **Review completeness and failures.** Inspect the final audit, actual indexed count, unavailable-image reasons, duplicate samples, and source provenance. Decide whether a separate retry corpus is worthwhile; do not erase the original skip trail.
2. **Validate human-facing accuracy.** Build a labeled query/artwork set spanning neutrals, warm paper, colored accents, frames, backgrounds, media, and different image profiles. Separate false accepts, false rejects, and unavailable data.
3. **Measure broader query performance.** R2 sharding, bounded browser retrieval and sample ranges are implemented and deployed. User phone feedback is positive; difficult combinations can still hit the byte/check/deadline limits. Any move to server-side search or changed acceptance needs separate evidence and approval.
4. **Maintain publication and rollback.** Keep manifests and assets immutable, preserve compatible older deployments, and use the documented upload/deployment workflow. The first full release is complete; future refreshes are deliberate releases, not automatic changes to the frozen catalog.
5. **Review abuse controls and privacy.** Decide deployment-wide request/spend limits and an accurate public data-handling explanation. No paid upgrade or new external policy is implied by the current local work.
6. **Decide retention separately.** Original-image removal is not a scan step. Confirm successful verification, reproducibility needs, backups, and exact cleanup targets before any approved deletion.

Potential features such as uploaded images, arbitrary hex editing, background-aware matching, similarity embeddings, account libraries, or full semantic artwork classification are outside the present implementation. They should be scoped as product changes, not slipped into maintenance of the existing pipeline.
