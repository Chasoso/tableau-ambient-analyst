# Tableau Desktop Extension development

Issue #68 loads the existing standalone debug console as a Tableau Dashboard
Extension. The UI and fixture analysis client remain shared; Tableau-specific
initialization is isolated in `src/debug-ui/host-adapter.ts`.

## Development configuration

1. Install dependencies with `npm ci`.
2. Start the UI with `npm run debug:ui` (default: `http://localhost:4173`).
3. Use [`extensions/ambient-analyst-dev.trex`](../../extensions/ambient-analyst-dev.trex)
   in Tableau Desktop's dashboard Extension object.
4. Select the local manifest, allow the localhost extension if Tableau asks,
   and confirm that the same debug console renders.

The manifest is the environment-specific source configuration. A future
production manifest should replace only its `<source-location><url>` with the
approved HTTPS hosting URL; UI and analysis code do not need a production URL
rewrite. The development manifest requests no full-data permission because this
Issue does not access workbook data.

## Host boundary

The browser adapter treats a top-level page as `standalone` and does not load
or initialize Tableau there. In an embedded frame it loads the Tableau
Extensions API library only for that host, calls `tableau.extensions.initializeAsync()`,
and reports `tableau`, `tableau-unavailable`, or `tableau-error` status. The
standalone fixture replay remains usable when Tableau globals are absent.

The adapter is intentionally not a View Action implementation. Worksheet,
filter, and parameter operations remain in the future #71 boundary. No live
Tableau data, MCP, credentials, or persistent workbook writes are used here.

## Manual Tableau Desktop smoke test

This repository change has not been executed in Tableau Desktop: status is
**UNVERIFIED** until the planned Windows check.

On a supported Tableau Desktop installation:

1. Start `npm run debug:ui` and confirm the standalone URL opens in a browser.
2. Open a safe test workbook and a dashboard in Tableau Desktop.
3. Add a Dashboard Extension object and select the development `.trex` file.
4. If prompted, explicitly approve the localhost/trust permission for this
   test extension. Record the exact prompt and Desktop version.
5. Confirm the debug console renders, choose a deterministic fixture, and run
   Replay. Confirm the visible status, stages, evidence, and mock intervention
   behavior match the standalone browser.
6. Remove the extension or restore the original dashboard state after testing.

If Tableau refuses the extension, shows a blank zone, or reports a trust or
security error:

- Confirm that `npm run debug:ui` is still listening and that the manifest URL
  exactly matches the local server URL. If `PORT` is changed, update the
  manifest source URL to the same port. Do not silently switch to a different
  host or port.
- Remove and re-add the extension after changing the manifest. Tableau loads
  manifest changes when the extension is added again; a browser refresh alone
  is not sufficient.
- Inspect Tableau Desktop diagnostics for the manifest or load error. On
  Windows, start with `%USERPROFILE%\\Documents\\My Tableau Repository\\Logs\\log.txt`;
  on macOS, start with `~/Documents/My Tableau Repository/Logs/log.txt`.
- Stop and record the exact error if the extension still cannot load. Do not
  broaden organization trust, network allowlists, or data permissions to make
  the smoke test pass; escalate those changes for Human Decision.

If Desktop or the safe test workbook is unavailable, record `UNVERIFIED`; do
not infer a successful embedded smoke test from browser or CI evidence. Any
request to change organization trust, security, or permission policy remains a
Human Decision.

## Compatibility boundary

Tableau's Dashboard Extensions API support baseline is Tableau Desktop 2018.2
and later. The manifest declares Extensions API minimum version `1.7`, but the
project does not claim a tested Tableau Desktop version matrix yet. The required
browser and CI checks cover Ubuntu/Chromium and do not cover Tableau Desktop,
Windows, or the real Extensions API runtime; the embedded smoke test remains
**UNVERIFIED** until the planned Windows check.
