# Workbench browser checks

`workbench-layout.mjs` checks viewport bounds, five/eight swatches, desktop drawers, mobile sheets, portrait selection, keyboard/backdrop dismissal, lock persistence, mode comparison, tone layout, share failure/retry, downloads, history, responsive transitions, image errors, and indexed-match/cancel outcomes. All museum, tone, persistence, and index responses are synthetic fixtures; it makes no database writes or paid-provider requests.

Indexed matching uses the actual v3 packager through `tests/helpers/shard-fixture.ts`: the release pointer, compressed directory/tiles/metadata, and ranged sample responses are all fixtures. Public R2 behavior is verified separately during approved releases; this suite does not upload data or contact the bucket. Avoid running builds/route-server tests concurrently with browser checks against the same checkout, since Vite-generated files can reload the page mid-scenario.

`workbench-quality.mjs` checks completed and in-flight saves across count, mode, regeneration, and comparison changes; readable accent buttons; and clipboard-denial/retry feedback in the workbench and shared palette. It mounts the actual shared route component with fixture props through Vite, so use the **dev server**, not a production preview, for this suite. Its API routes fail closed to prevent accidental database/provider calls.

It also checks that desktop/mobile actions, locked controls and modal tools share the current artwork accent; dark/light palettes retain readable text and focus indicators; and artwork selection/history restoration update the theme without changing global page colors.

`artwork-card.mjs` verifies Classic remains the default and exports without script fonts, switching to Card and back, choice retention within the page session, and both PNG formats. Card checks cover five/eight swatches, long titles, landscape/portrait artwork, mobile layout, fonts, exact swatch pixels, all four artwork corners, and failed-image/font recovery. All artwork/API responses are synthetic fixtures. Optional screenshots include both downloaded formats and the card preview.

`palette-image-size.mjs` replays the museum's no-enlargement responses for narrow artworks. It checks initial load, refresh, count changes, mode comparison, and both Classic/Card downloads on desktop/mobile without contacting the museum.

`artwork-fallback.mjs` checks sharp/direct and proxy images, museum failures with real packaged sample fixtures, corrupt/unindexed/changed images, non-public-domain exclusion from saved previews, preview recovery, duplicate hydration/error events, stale selections, shared palettes, thumbnails, both card exports, and small-phone layout. It verifies that film presentation does not alter source pixels or extracted colors, and that an explicit Tone upload is an unfiltered 200px JPEG. All network responses are fixtures; no museum, database or paid-provider calls occur. Run it with `node --import tsx tests/browser/artwork-fallback.mjs chromium` (or `webkit`) using the same environment below.

Classic preview checks compare its pixels with the downloaded PNG and verify that switching formats, loading, and retrying a failed preview keep the Save controls in place at desktop and mobile widths.

Start an isolated local dev server with empty provider/database settings, record its PID, and use an installed Playwright module/browser pair. Playwright is an optional verification tool, not a new production dependency or part of the default Node test suite.

`sheet-dismiss.mjs` checks pull-down dismissal across all five mobile tool sheets, short/cancelled pulls, control exclusions, scrolling, focus restoration, resizing, and reduced motion. Chromium uses native CDP touch input, including actual scroll checks. WebKit replays touch events through the real DOM handlers because its automation API does not provide native swipes; this is not a physical iPhone gesture test.

```fish
env DATABASE_URL='' GEMINI_API_KEY='' npm run dev -- --host 127.0.0.1 --port 5185 --strictPort
```

In another terminal, use the local installed Playwright module path when it is not available through normal package resolution:

```fish
env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-layout.mjs chromium

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-layout.mjs webkit

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-quality.mjs chromium

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-quality.mjs webkit

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/artwork-card.mjs chromium

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/artwork-card.mjs webkit

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/palette-image-size.mjs chromium

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/palette-image-size.mjs webkit

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/sheet-dismiss.mjs chromium

env PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/browser/sheet-dismiss.mjs webkit
```

`WORKBENCH_TEST_URL` can select a different localhost port. `WORKBENCH_TEST_OUTPUT` optionally saves rendered screenshots. Stop only the isolated dev server you started. No command here deploys or modifies the active artwork index.

`contrast-sample.mjs` checks the actual Palette drawer's lorem ipsum heading while resizing between desktop and small-phone widths. It verifies whole-word fitting on one line without shrinking the type, larger browser text, changed font metrics, reopening the panel, and unchanged sample colors/caption. Run it with `node tests/browser/contrast-sample.mjs chromium` (or `webkit`) using the same environment above; all artwork responses are fixtures and other external/API calls are blocked.

`search-history.mjs` checks completed searches, filter/page restoration, artwork selection, reload persistence, deduplication, exact artist-ID queries, failed/empty results, stale responses, clearing during pending requests, and blocked/corrupt browser storage. It exercises desktop/mobile Search panels with fixture-only requests and isolated storage. Run it with `node tests/browser/search-history.mjs chromium` (or `webkit`) using the same environment above.
