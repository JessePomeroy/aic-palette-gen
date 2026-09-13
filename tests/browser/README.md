# Workbench browser checks

`workbench-layout.mjs` checks viewport bounds, five/eight swatches, desktop drawers, mobile sheets, portrait selection, keyboard/backdrop dismissal, lock persistence, mode comparison, tone layout, share failure/retry, downloads, history, responsive transitions, image errors, and indexed-match/cancel outcomes. All museum, tone, persistence, and index responses are synthetic fixtures; it makes no database writes or paid-provider requests.

Start an isolated local dev server with empty provider/database settings, record its PID, and use an installed Playwright module/browser pair. Playwright is an optional verification tool, not a new production dependency or part of the default Node test suite.

```bash
DATABASE_URL='' GEMINI_API_KEY='' npm run dev -- --host 127.0.0.1 --port 5185 --strictPort
```

In another terminal, use the local installed Playwright module path when it is not available through normal package resolution:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-layout.mjs chromium

PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx tests/browser/workbench-layout.mjs webkit
```

`WORKBENCH_TEST_URL` can select a different localhost port. `WORKBENCH_TEST_OUTPUT` optionally saves rendered screenshots. Stop only the isolated dev server you started. No command here deploys or modifies the active artwork index.
