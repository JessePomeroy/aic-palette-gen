# Developer and operator handbook

[Documentation home](README.md) · [Data pipeline](data-pipeline.md) · [Release evidence](release-checklist.md)

## Scope and safety

Treat the application, production database, local data jobs, and hosted deployment as separate systems. Running a local scan is not permission to publish assets, migrate Neon, delete originals, push a branch, or replace a hosted preview. No maintenance command should print connection strings, API keys, or full private environment files.

The paths below that identify this machine are for the existing approved job. General examples use placeholders and must be adapted deliberately. Do not point recursive cleanup commands at a repository root, home directory, or a loosely expanded variable.

## Local development

The working repository is named `aic-palette-gen`, while the product name is ChromaCollection. Inspect its `AGENTS.md`, current Git state, and scripts before changes. Both `package-lock.json` and `pnpm-lock.yaml` currently exist; the examples here use the npm script invocations verified during this work. Do not casually regenerate both lockfiles or change dependency policy as part of unrelated edits.

```fish
npm install
npm run check
npm test
```

Configure private environment values only in the intended ignored development environment. Preserve an existing `.env`; use `.env.example` only as a template for a fresh setup. There is no need to print that file to verify ordinary local code behavior.

| Setting | Required for | Not required for |
|---|---|---|
| `DATABASE_URL` | Saving/loading shared palettes | Offline scans, local palette extraction, a build that makes no persistence query |
| `GEMINI_API_KEY` | Explicit server-side Tone generation | Dominant/Vibrant extraction, indexed matching, offline color analysis |

Use an isolated development Neon branch for write tests. The database initializer changes a database schema and should only be run against an explicitly approved new development database that needs the table:

```fish
npx tsx scripts/init-db.ts
```

It is not a migration tool. Never run it automatically just because a connection is reachable.

When a development server is needed for implementation or visual verification, use an isolated port and record the exact process you started. For example, `npm run dev -- --host 127.0.0.1 --port 5185 --strictPort`. Stop only that owned process when the task is over. Reading or writing documentation does not itself require starting the application server.

## Verification layers

| Check | Purpose |
|---|---|
| Focused `node --import tsx --test tests/<file>.test.ts` | Reproduce a narrow behavior quickly |
| `npm test` | Run the repository's Node test suite, including fixture-based route checks |
| `npm run check` | Synchronize SvelteKit types and run Svelte/TypeScript diagnostics |
| Focused `npx biome check ...` | Check changed code files without reformatting unrelated work |
| `npm run build` | Verify the local production build and adapter output |
| `git diff --check` | Catch whitespace errors; not a substitute for reviewing new/untracked files |
| Browser/device checks | Confirm actual rendered states, interaction, responsive layout, exports, and errors |

The optional [workbench browser suite](../tests/browser/README.md) provides repeatable Chromium/WebKit viewport and interaction checks against an isolated local server. Its museum, sharing, Tone, and index responses are fixtures. It requires an already installed compatible Playwright module/browser pair and is separate from `npm test`.

Tests using stubbed database/provider transports are not live external-service tests. Earlier real development sharing and the single approved live Tone call are documented separately in the release checklist. Do not repeat paid/live provider calls merely to increase test counts. A passing build is not a deployment, and desktop CPU throttling is not a physical-phone measurement.

## Offline command map

| Script | Role | Output/restart model |
|---|---|---|
| `colors:package` | Package a completed, audited scan as v3 tiles and sample packs | New directory only; validates canonical hashes; manifest written last |
| `colors:upload` | Upload an explicitly approved release to the dedicated R2 bucket | Checkpointed, checksum-confirmed uploads; manifest withheld without `--publish` |
| `colors:catalog` | Import an extracted historical bulk artwork folder | Deterministic catalog/provenance/exclusions; missing files can be completed without overwriting differing data |
| `colors:refresh` | Collect and reconcile the live eligible catalog | Immutable saved pages, bounded ID traversal, final coverage checks |
| `colors:download` | Prepare/extend a category-balanced corpus, up to 2,500 artworks | New directory; reuses completed manifests, not an interrupted-job resume engine |
| `colors:index` | Build the runtime-format v2 index from explicit local sources | New directory only; aggregate JSON and raw RGBA samples |
| `colors:batch` | Process 1–100 records of a frozen catalog | Per-image receipts and checkpoint; offline unless downloads are explicitly enabled |
| `colors:scan` | Pilot, all remaining batches, final sample/original audit | Continues automatically until complete or a pause/safety failure |
| `colors:supervise` | Monitor an existing owned scan and resume safe transient pauses | Backoff, exited-owner lock recovery, separate monitor status, fail-closed safety pauses |

Detailed invocations and contracts are in [catalog import](full-artwork-catalog.md), [live/full scan](full-color-scan.md), [one batch](local-color-batches.md), and [runtime index](color-index.md). Do not run multiple scrapers simultaneously, even if their output directories differ.

## Scan monitoring and restarts

The completed approved scan ran in a **transient user-level systemd service**, outside the interactive command session. It stopped normally after the successful 2026-09-14 audit. The following describes its operating model for authorized future work: it survives normal chat/terminal activity while the user session/service manager and machine remain available, but is not an enabled boot service or a guarantee across reboot, logout, power loss, or storage failure. Do not restart a completed scan merely because its service is inactive.

Current service name:

```text
chromacollection-full-scan-20260913.service
```

Read-only checks:

```fish
systemctl --user show chromacollection-full-scan-20260913.service \
  -p ActiveState -p SubState -p MainPID -p NRestarts

journalctl --user -u chromacollection-full-scan-20260913.service \
  -n 30 --no-pager
```

Read these local files for the existing job:

```text
/home/strayblackdog/Documents/temp/chroma-full-scan-20260913/checkpoint.json
/home/strayblackdog/Documents/temp/chroma-full-scan-20260913/scan-status.json
/home/strayblackdog/Documents/temp/chroma-full-scan-20260913/monitor-status.json
/home/strayblackdog/Documents/temp/chroma-full-scan-20260913/pilot-report.json
/home/strayblackdog/Documents/temp/chroma-full-scan-20260913/scan-report.json
```

The checkpoint is the authoritative per-image progress count. `scan-status.json` describes the last completed batch and can lag while the next batch is running. `monitor-status.json` distinguishes a running supervisor, a scheduled safe restart, completion, and attention required. A process being alive does not by itself prove image progress; compare checkpoint timestamps/counts over time and inspect retry schedules.

### Automatic recovery policy

The inner runner already performs bounded retries for transient image/network errors and honors `Retry-After`. The supervisor resumes exhausted transient server/network pauses after a further five-minute cooldown. It also rechecks disk-space pauses: it cannot advance until the original free-space gate passes.

The supervisor preserves pending retry timestamps across its own restart. It will recover only this job's ordinary numeric-PID lock files, and only after a zero-signal process check proves the recorded owner no longer exists. A live owner, malformed lock, unexpected path, or changed lock is not removed.

High image-failure rates, failed pilot acceptance, invalid/corrupt artifacts, changed inputs, unknown errors, and a requested cooldown longer than a day require inspection. They are **not** automatically bypassed. These stops protect data quality and the museum service; “restart when paused” does not mean discarding those checks.

The service uses `Restart=on-failure`, a 300-second service restart delay, and `RestartPreventExitStatus=2`. The supervisor returns exit status 2 for a safety/unknown failure and 75 for a recognized interruption escaping its loop. Unexpected abnormal process exits can therefore restart, while known safety stops remain visible. An intentional `systemctl --user stop` is not automatically undone by the restart policy.

### Stop or resume the approved job

Only use these mutations for the owned, approved service—not a broad process-name kill:

```fish
systemctl --user stop chromacollection-full-scan-20260913.service
systemctl --user start chromacollection-full-scan-20260913.service
```

Starting it again will still refuse an unresolved safety pause. Inspect the reason and underlying records rather than deleting the status file to force progress. No command here grants approval to alter the catalog, remove skipped receipts, lower failure thresholds, or delete originals.

If the transient unit no longer exists, recreate it only after verifying no writer owns either scan lock. The working command is a direct Node process with `--import tsx`, running `scripts/supervise-color-scan.ts` against the **same** frozen catalog, reuse manifest, and scan output. Resolve the local Node executable; do not assume a machine-specific runtime path will work in another checkout. Keep unit configuration free of secrets—the scanner needs no Neon or Gemini credentials.

## Recognizing completion

Completion requires the frozen catalog to be fully accounted for and the final audit to succeed. Check:

1. The checkpoint cursor equals the frozen catalog count.
2. Indexed plus skipped equals that cursor.
3. `scan-report.json` exists and reports completion.
4. The sample-verification and original-hash counts agree with indexed results.
5. Skip reasons are reviewed separately; a completed run can still contain unavailable images.

The monitor stops after completion. A service that is inactive with a successful exit and a valid final report is not a stalled scan that should be restarted.

## Failure guide

| Symptom | First check | Safe response |
|---|---|---|
| Checkpoint unchanged, status waiting | `retryAt`, service PID, recent log | Let the backoff finish; do not launch a competing writer |
| HTTP 500/521 or interrupted downloads | Whether the same pending item is retrying and other requests recover | Preserve it as pending; avoid interpreting temporary service failure as a color rejection |
| HTTP 403/404 receipt | Explicit skip reason and museum metadata/image identity | Keep the audit trail; do not assume the cause or bypass access restrictions |
| High skip percentage | Batch receipts and failure distribution | Inspect before resuming; do not weaken the gate automatically |
| Low disk | Actual free space on the staging filesystem | Free unrelated space deliberately or choose an approved storage plan; originals are not automatic cleanup targets |
| Sample/hash mismatch | Manifest/plan identity and the exact failing sample/source | Stop and investigate; do not silently overwrite a supposedly immutable artifact |
| Changed catalog/reuse input | Fingerprint mismatch | Use a new deliberate job or restore the exact original input; do not reuse an unrelated cursor |
| Stale lock | Recorded PID and service state | Prove the owner exited; recover only the exact owned lock |
| Browser index unavailable | Asset root, matching index/catalog, sample URLs | Keep current workbench state; do not substitute an unbounded image scan |
| Sharing unavailable | Isolated DB configuration and route status | Preserve the palette, offer export/retry; redact connection details |
| Tone unavailable | Server configuration, local/provider rate limit, timeout | Use local modes or retry explicitly; no automatic paid-provider loop |

## Release and rollback

The approved 2026-09-14 release packages 59,025 audited artworks into v3 color tiles, metadata pages, and lossless sample packs. Data lives in the **separate `chromacollection-index` R2 bucket**, in the same Cloudflare account as Angels Rest. Its only public access is the GET/HEAD/OPTIONS Worker in `workers/color-index/`; the app remains on Vercel. Existing buckets and DNS are unchanged. The public asset root is `https://chromacollection-index.thinkingofview.workers.dev/v3/full-59025-20260914`.

General commands (substitute deliberately; these are external writes only when approved):

```fish
npm run colors:package -- --scan /absolute/scan --catalog /absolute/catalog/artworks.json --output /absolute/new-assets
npm run colors:upload -- --assets /absolute/new-assets --account APPROVED_ACCOUNT_ID --prefix v3/new-release --checkpoint /absolute/upload-receipts.jsonl
# After upload and release verification, repeat the upload command with --publish.
```

The uploader reads `CLOUDFLARE_API_TOKEN` from the environment, or an existing Wrangler OAuth file via `--token-file`. Never paste credentials into commands, logs, docs, or committed config. It uploads only the allowlisted release inventory; `release-report.json`, originals, and receipts stay local. R2 confirms each object's MD5 and size; local bytes must also match the inventory SHA-256. Checkpoints are bound to account, bucket, prefix, and manifest hash. Existing differing releases are refused. Keep checkpoints outside public assets and do not edit them to skip validation.

Deploy the read-only gateway with `wrangler deploy --config workers/color-index/wrangler.jsonc` only with release authority. Verify ordinary and ranged reads, CORS, and hashes through its public URL. Publish the manifest last, then set `static/color-index/release.json` to that root and manifest SHA-256 and deploy the tested app source through the approved Vercel workflow. The manifest for this release hashes to `8d8c3d840db731b95068ec64a0eabdf10f4cde9c82abf9989fcd19d2c549103f`.

Browser queries remain bounded at 12 MiB of downloaded response bodies, 2,500 checks, and 30 seconds. Complex queries may correctly return incomplete. A rollout must verify real hosted data as well as fixtures. Full original/sample audits are retained with the scan; publication does not authorize their removal.

Review [release-checklist.md](release-checklist.md) for historical local checks and external approvals. Environment configuration changes do not update already-built deployments. Never assume an old preview uses an isolated development database merely because newer environment settings do.

Keep released asset directories immutable. A v3 rollback selects an older complete v3 root/hash and redeploys the pointer. Rolling back to the old bundled 2,500-artwork v2 release requires its matching earlier app deployment, not a v3 pointer aimed at v2 files. Rollback never overwrites samples or deletes saved palettes. Retain the frozen catalog, source manifests, provenance, receipts, originals, and audit reports until a separate retention/cleanup decision is approved.

## Maintaining these docs

Update behavior next to the relevant source link. Keep milestone counts dated; use status files for live progress. When changing data contracts, update both the written pipeline and `diagrams/data-pipeline.svg`/the Mermaid equivalent. Render the SVG and check link targets after editing. Avoid documenting credentials, private deployment tokens, or test writes as suggested production actions.
