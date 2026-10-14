# Tableau Desktop Extension development

Issue #69 loads the standalone debug console and its local same-origin Node
analysis API as a Tableau Dashboard Extension. The UI and application analysis
client remain shared; Tableau-specific
initialization is isolated in `src/debug-ui/host-adapter.ts`.

## Development configuration

1. Install dependencies with `npm ci`.
2. Start the UI and local API with `npm run debug:ui` (default:
   `http://localhost:4173`).
3. Use [`extensions/ambient-analyst-dev.trex`](../../extensions/ambient-analyst-dev.trex)
   in Tableau Desktop's dashboard Extension object.
4. Select the local manifest, allow the localhost extension if Tableau asks,
   and confirm that the same debug console renders.

The manifest is the environment-specific source configuration. A future
production manifest should replace only its `<source-location><url>` with the
approved HTTPS hosting URL. The browser continues using relative `/api`
requests, so the future HTTPS host or approved reverse proxy must route `/api`
to the backend and enforce the approved origin/CORS policy. UI and analysis
code do not hardcode an AWS URL. The development manifest requests no full-data
permission because this Issue does not access workbook data.

## Host boundary

The local API permits only an explicit HTTP loopback origin (`localhost`,
`127.0.0.1`, or `::1`) on the request's loopback port. The two loopback
hostnames may differ because both are explicitly constrained to loopback; it
does not derive trust from an arbitrary `Host` header and rejects
non-loopback or mismatched-port pairs with `403`.

The browser adapter treats a top-level page as `standalone` and does not load
or initialize Tableau there. In an embedded frame it loads the Tableau
Extensions API library only for that host, calls `tableau.extensions.initializeAsync()`,
and reports `tableau`, `tableau-unavailable`, or `tableau-error` status. The
standalone replay remains usable when Tableau globals are absent. Both hosts
call the same local API and application-layer replay path. The API uses
bounded in-memory results and safe error responses, so failed runs do not
expose provider/tool payloads or affect the host page.

View actions are isolated in `src/debug-ui/view-actions.ts`. The shared
boundary accepts only validated `set-filter` and `set-parameter` proposals,
requires a verified `INTERVENE` flow, applies only after a user click, captures
the immediately preceding state, and supports scoped Undo. Standalone uses a
synthetic mock fixture; those identifiers are never a production mapping. The
Tableau adapter resolves exact worksheet/filter/parameter targets at execution
time and fails closed when an explicit approved configuration or current target
state is unavailable. No target is discovered or authorized automatically, and
no persistent workbook write is performed.

The embedded browser only constructs the live adapter when the host supplies an
explicit approved configuration and the Tableau dashboard API is available. In
the absence of either, a badge click is rejected safely. The synthetic fixture
configuration is never treated as a live Tableau mapping.

## Manual Tableau Desktop smoke test

This repository change has not been executed in Tableau Desktop: status is
**UNVERIFIED** until the planned Windows check.

On a supported Tableau Desktop installation:

1. Start `npm run debug:ui` and confirm the standalone URL opens in a browser.
2. Open a safe test workbook and a dashboard in Tableau Desktop.
3. Add a Dashboard Extension object and select the development `.trex` file.
4. If prompted, explicitly approve the localhost/trust permission for this
   test extension. Record the exact prompt and Desktop version.
5. Confirm the debug console renders, choose a deterministic scenario, and run
   Replay. Confirm the visible status, stages, evidence, and intervention
   behavior match the standalone browser. Before applying a live view action,
   record and approve the actual worksheet, field/parameter, permitted value,
   and scope for this workbook; never substitute the synthetic fixture names.
6. Click the `!` badge once and record the actual pre/post dashboard state,
   then click Undo and record the restored state. If the target or prior state
   cannot be verified, the adapter must fail closed and the result is
   **UNVERIFIED**, not a successful smoke test.
7. Remove the extension or restore the original dashboard state after testing.

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

## Fault isolation

Use the first failing boundary as the diagnosis boundary:

- Frontend/static failure: the page or debug sections do not render; check the
  browser console and `/debug-ui/*.js` asset requests.
- Local API failure: inspect the POST response. `400` indicates request
  validation, `429` indicates bounded active-run capacity, and `502` indicates
  a timeout or application flow that failed closed. The API stores at most 32
  runs in memory, evicts the oldest run beyond that bound (`GET` then returns
  `404`), and does not persist runs across process restarts.
- A timeout response does not release an active-run slot while its underlying
  analysis remains pending. With both slots occupied, new POST requests receive
  `429`; capacity recovers only after the underlying promise settles. A
  permanently pending operation therefore remains fail-closed until it settles
  or the local service is restarted.
- Application-flow result: `FAILED`, `IGNORED`, or `INSUFFICIENT EVIDENCE` with
  stages and audit events means transport succeeded; inspect those events and
  the sanitized result for the failing boundary.
- Tableau host failure: if standalone browser checks pass but the extension is
  blank or unavailable, compare the manifest source URL/port and inspect the
  Desktop log paths above. Do not infer Desktop support from Chromium CI.

## Compatibility boundary

Tableau's Dashboard Extensions API support baseline is Tableau Desktop 2018.2
and later. The manifest declares Extensions API minimum version `1.7`, but the
project does not claim a tested Tableau Desktop version matrix yet. The required
browser and CI checks cover Ubuntu/Chromium and do not cover Tableau Desktop,
Windows, or the real Extensions API runtime; the embedded smoke test remains
**UNVERIFIED** until the planned Windows check.
