# Vercel footprint and legacy compatibility

Deployed September 16, 2026. Production is
`dpl_8V2UuiqivHgYgJXxB6mxLxhLb4SJ`; both protected earlier deployments remain
READY. All 3,953 compatibility objects and old redirected URLs passed complete
hash/header verification. The active v3 release and application behavior are
unchanged. No source-control commit or push was made.

The initial disposable REST test failed: two PUTs using `If-None-Match: *`
both returned 200 and the second replaced the first body. No release objects
were written through that transport. The replacement S3 transport passed the
live safety gate (412, original bytes preserved, task-owned probe deleted and
404 verified) before the approved copy. Its bucket-only, 24-hour credential
was revoked immediately afterward; authentication then returned 401 and the
local credential file was removed. Do not use the existing v3 REST uploader
as a workaround: it retains the unverified endpoint/header assumption and
was not changed in this task.

## Measured build reduction

| Local adapter output | Before | After |
| --- | ---: | ---: |
| Static bytes | 477,461,866 | 964,423 |
| Static files | 3,977 | 24 |

The removed payload is exactly 476,497,443 bytes (99.8% of the old output).
This is a local artifact measurement, not a reduction already observed in
Vercel's time-weighted storage meter. Function bundles are a separate metric.
The actual remote production build reported 964,207 bytes / 24 static files;
the 216-byte difference from the local build is generated CSS output.

All 3,953 legacy files were moved, without byte changes, from
`static/color-index/` to `archives/color-index/`. Every file hash was checked
before and after relocation. These recovery copies remain in the repository's
working tree; `.vercelignore` excludes them from uploaded source, and they are
outside SvelteKit's static directory. No artwork originals were removed.

| Immutable release | Files | Bytes |
| --- | ---: | ---: |
| starter-20260912 | 484 | 57,784,710 |
| expanded-20260912 | 967 | 116,745,292 |
| expanded-2500-20260913 | 2,502 | 301,967,441 |

The active `static/color-index/release.json`, v3 R2 assets, Random selection,
rights policy, previews, database and unrelated working-tree changes are unchanged.

## Prevention

`npm run build` checks static source, builds, then checks the adapter's actual
`.vercel/output/static`. Each check prints bytes and the ten largest files,
warns above 10,000,000 bytes, fails above 25,000,000 bytes, and rejects the
three legacy directories even if empty. Symlinks and embedded archives also
fail closed. The budget has no environment-variable bypass; change it only
after explicit review. `npm run check:static` checks an existing build.

## Compatibility and ordered rollout

The read-only Worker adds exactly the three `/v2/RELEASE/` prefixes, allowing
only `index.json`, `artworks.json`, `report.json` and SHA-256-named `.rgba`
samples. Legacy JSON is capped at 16 MiB (the large index exceeds v3's 8 MiB
cap); samples remain capped at 160,000 bytes. Existing v3 and 161,000-byte
pack-range bounds are unchanged. CORS, byte identity and immutable delivery
remain required. No original-image or write routes are introduced.

`vercel.json` redirects the three old `/color-index/RELEASE/:path*` prefixes
to their corresponding public Worker paths. These are reversible 307 redirects,
not permanently cached redirects. They avoid a Vercel function/proxy data hop.
The release pointer is not redirected. Local Vite does not execute Vercel's
edge redirects; hosted verification is still required.

With separate external-write/deployment approval:

1. Inventory the preserved files using `npm run colors:legacy`. This default
   mode hashes every file and named sample without network requests or writes.
2. Use a separately approved, bucket-only, short-lived S3 credential in an
   owner-only JSON file with `accessKeyId` and `secretAccessKey`. The native
   signed transport requires curl 8.3 or newer; credentials are not command-line
   arguments. Never paste their values into commands or logs. Run
   `npm run colors:legacy -- --upload --credentials-file /secure/path/credential.json`.
   Every upload first requires an absent disposable key, then proves conditional
   rejection (412), unchanged original bytes and successful probe cleanup.
   Wrangler OAuth cannot authenticate the S3 endpoint.
3. The transport reads each destination, refuses different bytes, writes only
   absent objects, verifies stored hashes, and writes index entry points last.
   Four concurrent requests drain and stop scheduling on error; reruns revalidate
   existing bytes. Copy exactly
   the three `v2/RELEASE/` prefixes into `chromacollection-index`; no v3 writes or
   release deletions. Account storage was 75.18 GB on September 16. The user
   approved the extra 0.477 GB (under $0.01/month before billing rounding, plus
   operations). Do not claim the copy fits an unused free storage allowance.
   Revoke the migration credential after use, confirm rejected authentication,
   and remove its local file. Deletion is limited to the task-owned safety key;
   release-object deletion is not supported by this transport.
4. Deploy `workers/color-index/wrangler.jsonc` through the approved Worker
   workflow. Then run `npm run colors:legacy -- --verify-public` to GET and
   hash every object and check its CORS/cache/content-type headers. This reads
   about 476.5 MB with at most four concurrent requests. Do not deploy the app
   if it fails.
5. Build and deploy an explicitly approved snapshot containing the user's
   existing deployed changes plus this cleanup. Keep both listed deployments
   below; do not commit or push unrelated changes implicitly.
6. Run `npm run colors:legacy -- --verify-old` after rollout. It requires the
   old URLs to redirect to the exact new objects, then verifies headers and
   hashes. Check representative 307 Location headers separately. Verify current
   v3 indexed search, public-domain fallback previews, shared palettes and
   non-public-domain exclusions in the deployed browser. No paid Tone calls or
   production database writes are needed for this read-only smoke check.
7. Measure Usage with the same date range after refresh, then track the rolling
   trend. Do not call artifact savings measured billing savings.

Preserve pre-cleanup production `dpl_3YqDtYD3CC6p6NUeBtoZyQfo3hHF` and the
earlier rollback `dpl_A1wRHotpa4RfnZRU3MwRGSacH2CF`. To reverse this rollout,
restore the pre-cleanup deployment's production aliases using the approved rollback
workflow. Keep the added compatibility objects/Worker routes: cached clients
can still need them. Do not delete either protected deployment or R2 objects.

## Verification recorded

- Local build: 964,423 static bytes; remote production: 964,207 bytes. Both
  contain 24 static files and no legacy directories.
- Svelte/TypeScript: zero errors or warnings.
- Node suite: 137 passed, including nine legacy/S3 tests covering immutable
  conflicts, racing writes, safety cleanup, bounded concurrency and transport
  restrictions. The live S3 probe, not mocks, establishes conditional behavior.
- Chromium fallback suite: 15 passed, including rights exclusion, shared
  palettes, stale responses, failed images and mobile/desktop states.
- Chromium workbench suite: 31 checks passed, including matching, cancellation,
  history, export/share fixtures and responsive layout; no page errors.
- WebKit could not launch: missing system library `libicudata.so.74`. No
  WebKit success is claimed.
- Live release pointer still matches local; public v3 manifest returned 200,
  wildcard CORS, immutable caching and the expected SHA-256
  `8d8c3d840db731b95068ec64a0eabdf10f4cde9c82abf9989fcd19d2c549103f`,
  with 59,025 artworks. A 64-byte pack range returned 206 with exact range
  headers; an oversized range returned 416.
- R2 copy, public Worker verification and old-URL verification each passed
  all 3,953 files / 476,497,443 bytes. Inventory SHA-256:
  `728bf9940851fa76e8752be1cebd8453312ac7772c09889434472df7435ea959`.
- Worker version: `c1ae0817-e517-4dc8-b042-ae19d71e217b`, unchanged sole bucket
  binding. All three representative index URLs returned exact 307 targets.
- Source snapshot: 133 byte-matched files, digest
  `dbe91e766f72e54e19cbff877ed50592cf964ab16c97f46c1389c55ecf46b72f`.
  Application source and release pointer match the preceding deployed snapshot;
  private files and archived payloads were excluded.
- Production's project target is `dpl_8V2UuiqivHgYgJXxB6mxLxhLb4SJ`, READY
  at `https://www.chromacollection.online`. Both protected older IDs remain READY.
- Live Chromium: the user-provided Paperweight palette returned 200 and retained
  all five exact colors, mode and rendered preview at desktop/mobile sizes,
  without horizontal overflow. A real indexed match from The Bedroom preserved
  lock `#afa789` and displayed a loaded Cushion Cover preview. Burt Lancaster
  metadata remained non-public-domain and no saved preview was shown. All live
  checks had no page errors; only GET/HEAD/OPTIONS were permitted. No production
  database writes or paid Tone calls occurred.

## Weekly review

Record the date range and team/project Deployment Storage, Functions Storage,
FOT, FDT, requests and deployment counts. Review at 50%, 70% and 85% of a quota;
these are manual operating thresholds, not installed automated alerts. Compare
weekly snapshots and investigate any new multi-GB daily transfer burst. Check
the static budget, release pointer, representative immutable asset, successful
proxy cache headers and recent bot/cache-miss traffic. Present exact IDs before
manual pruning; production plus a verified rollback is the minimum protected set.

Defer proxy changes unless ChromaCollection FOT exceeds 500 MB or 5% of team
transfer. Do not alter Random or rights policy to save transfer. Hobby is for
personal/noncommercial use; lower resource consumption does not make a
commercial storefront eligible. A hosting decision is separate from cleanup.

Vercel storage accumulates from daily project maxima; retained logical bytes,
historical usage and provider-metered GB-months are different. The dashboard's
August 17–September 16 selection is not a September 17 reset promise. See
[storage accounting](https://vercel.com/docs/deployment-storage),
[retention exceptions](https://vercel.com/docs/deployment-retention) and
[Hobby eligibility](https://vercel.com/docs/plans/hobby).

Upload references: [R2 REST upload](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/)
and [documented S3 conditional writes](https://developers.cloudflare.com/r2/api/s3/api/).
