# ChromaCollection documentation

ChromaCollection turns artwork into usable color palettes. It combines museum discovery, browser-based palette extraction, color-constrained artwork matching, and export/share tools in an artwork-first workbench.

Updated **2026-09-14 UTC**: the completed scan's **59,025-artwork R2 release is live** at [ChromaCollection](https://www.chromacollection.online). Data publication and app deployment remain separate operator steps; [release evidence](release-checklist.md) records the completed rollout, browser checks, and user phone feedback.

## Start here

| Reader or question | Guide |
|---|---|
| “What is this website, and how do I use it?” | [Website guide](user-guide.md) |
| “How did we make the art database?” | [Database and color-index pipeline](data-pipeline.md) |
| “Show me the whole data journey” | [Visual pipeline graph](diagrams/data-pipeline.svg) |
| “How does the code fit together?” | [Architecture and algorithms](architecture.md) |
| “What do the server endpoints accept?” | [API and persistence reference](api-reference.md) |
| “How do I run, monitor, test, and release it?” | [Developer and operator handbook](operations.md) |
| “What are the limitations and remaining decisions?” | [Decisions, limitations, and roadmap](decisions-and-limits.md) |

## The project in plain language

The museum provides information about artworks and links to their images. ChromaCollection groups the colors in a selected image into a palette, then lets someone keep favorite colors, compare approaches, discover related artwork, and export the result.

Finding another artwork with several chosen colors is a different problem from generating a five-color palette. We pre-analyze artwork images into compact color profiles and preserve small, exact pixel samples. The profiles narrow the search; the samples verify that **every locked color** is sufficiently present. This avoids downloading and analyzing a whole set of museum images during each search.

![How ChromaCollection builds and uses its art catalog, color index, and separate sharing database](diagrams/data-pipeline.svg)

[Open the full-size graph](diagrams/data-pipeline.svg). Its written equivalent and an editable Mermaid version are in the [pipeline guide](data-pipeline.md).

## What “our database” means

There are four distinct stores:

| Store | Purpose | Location |
|---|---|---|
| Artwork catalog | Titles, artists, dates, media, rights flags, and museum/image identifiers | Local staging JSON; paginated release metadata in R2 |
| Color index and verification samples | Searchable image-color evidence | Local audited files; versioned R2 tiles and sample packs |
| Recent palette history | Restore this browser's palettes, locks, and tone descriptions | Browser local storage, with an in-memory fallback |
| Saved palette links | Open a palette by a shareable UUID | Neon Postgres, queried by the application server |

**Neon is not the artwork-image warehouse.** The full scan does not insert its catalog, original JPEGs, signatures, or pixel samples into Neon. Generating a palette does not itself create a database share link.

## Verified milestones, not a live dashboard

| Milestone | Observed result |
|---|---|
| Full-scan app index | 59,025 indexed public-domain artworks in `v3/full-59025-20260914` |
| Historical bulk snapshot | 134,078 artwork records; 57,556 eligible artworks with image IDs |
| Historical archive date | 2025-02-16; downloaded and checked on 2026-09-13 |
| Live catalog refresh | 59,056 eligible records, saved across 591 pages |
| Reconciliation | 1,707 additions, 207 removals, 511 changed image IDs, 5,496 changed normalized metadata records |
| Larger scan pilot | 293 indexed and 7 HTTP-403 skips out of 300; integrity audit passed |
| Full scan | Completed and audited: 59,025 indexed, 31 skipped; originals retained |

The live catalog's observation window was 02:59:02–03:08:55 UTC on 2026-09-13. It is a frozen local view collected over time, not an atomic snapshot of the museum's database. Metadata eligibility does not guarantee an image download will succeed.

## Existing specialist guides

- [Locked-color index](color-index.md): exact matching policy, on-demand v3 runtime, and historical experiments.
- [Historical catalog import](full-artwork-catalog.md): bulk archive validation and normalization.
- [Local color batches](local-color-batches.md): one bounded batch, restart behavior, and saved artifacts.
- [Full scan](full-color-scan.md): live refresh, pilot gate, full processing, and final audit.
- [Release checklist](release-checklist.md): dated local verification evidence and remaining external release approvals.

The specialist guides retain historical experiments. Their old results should not be mistaken for new measurements or current production status. When behavior changes, update the guide nearest that behavior, its source links, and any affected diagram.

## Terminology

**Palette:** the small set of colors shown to the user. **Lock:** an exact swatch preserved in its palette slot. **Signature/fingerprint:** a histogram describing colors across an image sample. **Canonical sample:** the precise resized pixels used both to build the signature and to verify a match. **Corpus:** a selected set of artworks. **Frozen catalog:** an immutable input list for a scan. **Receipt:** one artwork's indexed result or explicit skip reason. **Release:** a deliberately published, internally consistent set of runtime assets.
