# Tableau Ambient Analyst

Tableau Ambient Analyst is an experimental PoC for exploring a future
Tableau + AI interaction model. The project investigates how an assistant
could observe meeting context, detect a claim or decision worth validating,
investigate trusted Tableau data, and intervene only when useful evidence is
available.

This is not a conventional `Ask -> Answer` chatbot. The experience being
explored is:

```text
Conversation -> Detect -> Investigate -> Intervene
```

## Core experience

The intended PoC loop is:

```text
Meeting context / replay
        |
        v
Claim or hypothesis worth validating
        |
        v
Agentic investigation of approved Tableau data
        |
        v
Evidence is sufficient? -- no --> refine conditions and continue exploration
        |
       yes
        v
Useful intervention through a future Dashboard Extension experience
```

This describes a hypothesis to test, not a promise of continuous monitoring,
full autonomy, or consistently correct decisions.

## Current PoC scope

Current direction:

- TypeScript / Node.js is the accepted initial core runtime.
- The core is intended to remain cross-platform.
- Development and baseline CI are local-first, deterministic, and no-network
  at the application level.
- `validation` and `secret-scan` are required checks for changes entering
  `main`.
- Hosted Tableau MCP is a future technical-spike target, not a live dependency
  of the current runtime foundation.
- The project favors a lean PoC and lets architecture emerge from evidence.

The current repository contains the runtime and validation foundation. The
application behavior will be introduced incrementally in later Issues.

## High-level direction

The current exploration is broadly organized around:

```text
Transcript / replay -> trigger or claim detection -> evidence need
        -> agentic LLM -> approved Tableau MCP tools
        -> structured evidence -> intervention decision
        -> future Dashboard Extension experience
```

This is a direction for experiments, not a final module layout, provider,
transport, persistence model, or deployment topology.

## What is not decided yet

The following remain open and should be selected through later spikes or human
architecture decisions:

- demo dataset and final meeting scenario;
- LLM provider and provider abstraction;
- Tableau datasource, MCP auth model, and final tool subset;
- live audio capture method;
- Windows or macOS native audio helper;
- persistence and deployment architecture;
- production architecture; and
- final Dashboard Extension UX.

Evaluation cases are intentionally separate from a demo dataset: domain-neutral
synthetic or neutral cases can be used to evaluate behavior before a demo
scenario is chosen. See [Issue #16](https://github.com/Chasoso/tableau-ambient-analyst/issues/16)
for the planned evaluation work.

## Runtime and development

The current foundation is:

```text
Runtime:         Node.js 24 LTS (.nvmrc)
Language:        TypeScript
Package manager: npm
Module system:   ESM / NodeNext
```

The portable core may later connect to a platform-specific native capture
boundary if evidence requires it. Windows/WASAPI with a C#/.NET helper and
macOS/ScreenCaptureKit or Core Audio with a Swift/native helper are candidates,
not selected or implemented architectures.

The LLM provider is not selected. OpenAI, Anthropic, and Amazon Bedrock are
future comparison candidates; [Issue #17](https://github.com/Chasoso/tableau-ambient-analyst/issues/17)
will investigate the agentic LLM + Tableau MCP path.

## Local setup and validation

Install the locked dependencies from a fresh clone:

```bash
npm ci
```

Run the default local validation path:

```bash
npm run validate
```

Run the standalone UI browser E2E gate separately after installing the pinned
Playwright Chromium binary:

```bash
npx playwright install chromium
npm run test:e2e
```

The E2E command starts the built-in localhost server through Playwright's
`webServer` configuration and covers real Chromium rendering, replay, the
mock intervention badge, negative/error fixtures, and repeated scenario
runs. It uses no Tableau, credentials, LLM, MCP service, or remote API. On a
failure, Playwright keeps traces/screenshots and the HTML report under
`test-results/` and `playwright-report/`; do not commit those directories.

The normal `npm run validate` remains local/no-network and does not download
browser binaries. CI provisions Chromium in the existing mandatory
`validation` job and runs this E2E command after `npm run validate`, so an E2E
failure fails that required job. `secret-scan` remains a separate required
check.

Validation reports must identify the browser and OS actually exercised. The
repository gate covers Ubuntu + Chromium in CI; macOS and Windows are local
setup targets but are unverified unless explicitly run and reported. Firefox,
Safari, Tableau Desktop, and real Tableau Extension APIs are not covered by
this Playwright suite.

This covers formatting, linting, type checking, deterministic tests, and the
build. Individual checks are also available:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The standalone deterministic debug console can be started on macOS or Windows
with Node.js 24:

```bash
npm ci
npm run debug:ui
```

Open the printed `http://localhost:4173` URL. Select a deterministic scenario and
choose `Replay` to inspect transcript, trigger, Analysis Contract questions,
progress, evidence/provenance, verifier state, intervention, errors, and the
audit timeline. The browser calls the same-origin local Node API, which runs
the existing transcript intervention flow with deterministic no-network model
and tool boundaries. Results are sanitized and retained only in memory (up to
32 runs), so refresh and repeated runs are bounded. It does not require
Tableau, credentials, an LLM, or a live network service. Set
`PORT=4300` (or `$env:PORT = 4300` in PowerShell) to use another local port.

The browser-facing model is host-independent and keeps view control behind the
validated `ViewActionProposal`/`ViewActionAdapter` boundary. The `INTERVENE`
scenario shows a deterministic `!` badge; only a deliberate click applies the
synthetic fixture filter through the mock adapter, and the resulting action can
be undone. Notifications, HOLD, ignored, failed, or unverified outcomes never
apply a view action. Synthetic identifiers are fixture-only and are not
production Tableau mappings.

The shared boundary supports allowlisted `set-filter` and `set-parameter`
actions with typed values, evidence references, captured prior state, repeated
click protection, an explicit approved dashboard scope, and fail-closed
target/value validation. The Tableau adapter
resolves worksheet/filter/parameter targets at execution time and uses the
Extensions API's supported filter and parameter methods. A live host without an
explicit approved configuration is rejected safely; no dashboard target is
discovered or authorized automatically.

The evidence-linked intent resolver is a separate deterministic boundary. It
accepts a bounded semantic `ViewIntent`, an application-supplied verified run
context, and an explicit dashboard mapping of exact values or approved aliases;
it then reuses the existing proposal and policy validators. It returns only
`READY`, `NO_ACTION`, or `REJECTED`. Run identity and authoritative evidence IDs
must match before a proposal can be produced; UI detail text, status labels, and
audit strings are never treated as authorization. The resolver is not wired to
an LLM, Tableau discovery, persistence, or the UI by this Issue.

An embedded host may provide an explicit, human-approved view-action
configuration through the host integration boundary. Without that configuration
the badge remains fail-closed; the standalone synthetic fixture is never reused
as a live Tableau mapping.

For a local Windows Desktop smoke test, inject that configuration explicitly at
server startup with `AMBIENT_ANALYST_VIEW_ACTION_CONFIG_FILE`. The variable must
point to an absolute path for a local, non-secret JSON file containing the exact
approved dashboard scope, worksheet/field or parameter target, allowed values,
and evidence-linked semantic mappings. Copy the shape below into an ignored `.local/` file and replace
every placeholder only after a human has approved the exact test target:

```json
{
  "policy": {
    "scope": { "dashboard": "REPLACE_WITH_APPROVED_DASHBOARD" },
    "filterTargets": [
      {
        "kind": "worksheet-field",
        "dashboard": "REPLACE_WITH_APPROVED_DASHBOARD",
        "worksheet": "REPLACE_WITH_APPROVED_WORKSHEET",
        "field": "REPLACE_WITH_APPROVED_FIELD",
        "valueType": "string",
        "allowedValues": ["REPLACE_WITH_APPROVED_VALUE"]
      }
    ],
    "parameterTargets": []
  },
  "mappings": [
    {
      "semanticKey": "REPLACE_WITH_INTENT_KEY",
      "operation": "set-filter",
      "valueType": "string",
      "target": {
        "kind": "worksheet-field",
        "worksheet": "REPLACE_WITH_APPROVED_WORKSHEET",
        "field": "REPLACE_WITH_APPROVED_FIELD"
      },
      "values": [
        { "from": "REPLACE_WITH_VERIFIED_INTENT_VALUE", "to": "REPLACE_WITH_APPROVED_VALUE" }
      ]
    }
  ]
}
```

PowerShell example: `$env:AMBIENT_ANALYST_VIEW_ACTION_CONFIG_FILE = (Resolve-Path
'.local\\issue-71-view-action.json').Path`, then run `npm run debug:ui`. The
server reads the file once when it starts and safely escapes it before placing it
in the local page. Missing, malformed, relative-path, or schema-invalid config
does not grant access; the embedded adapter remains fail-closed. Never use
wildcards, dashboard discovery, credentials, or a production workbook for this
test. Clear the variable and restart the server after the smoke test.

The local API accepts browser origins only when both the request `Host` and
the `Origin` are explicit HTTP loopback addresses (`localhost`, `127.0.0.1`,
or `::1`) on the same port. The two loopback hostnames may differ because
both are explicitly constrained to loopback; non-loopback or mismatched-port
origins fail closed with `403`.

For a future AWS HTTPS deployment, the browser continues using relative `/api`
paths. The approved HTTPS host or reverse proxy must route those paths to the
backend and enforce the approved origin/CORS policy; no deployment URL or
production credential is hardcoded by this Issue.

The same page can be loaded as a Tableau Dashboard Extension with the
development manifest at [`extensions/ambient-analyst-dev.trex`](extensions/ambient-analyst-dev.trex).
Tableau-specific initialization is isolated in the host adapter and is skipped
for standalone pages. See the [Tableau Desktop extension guide](docs/development/tableau-extension.md)
for the localhost manifest, manual smoke-test steps, configuration boundary,
and the current **UNVERIFIED** Desktop status.

### Local fault isolation

- If the page does not load, check that `npm run debug:ui` is listening on the
  manifest URL and that the browser console has no static asset error.
- A `400` is a malformed request, `429` means the two-run active capacity was
  reached, and `502` means the application flow failed closed or exceeded its
  bounded timeout. Retention evicts the oldest run; a later GET for that run
  returns `404`. Refreshing does not recover old in-memory runs.
- A timeout response does not release an active-run slot while the underlying
  analysis is still pending. If both slots remain pending, new POST requests
  receive `429`; a slot becomes available only after its underlying promise
  settles. A permanently pending operation therefore fails closed until it
  settles or the local service is restarted.
- A visible `FAILED`, `IGNORED`, or `INSUFFICIENT EVIDENCE` result is an
  application-flow outcome; inspect its stages and audit timeline rather than
  treating it as a frontend transport failure.
- For Tableau-only failures, compare the manifest URL and port first, then
  inspect the Desktop log paths in the extension guide. Browser/CI success does
  not establish Desktop success.

## Validation and CI

GitHub Actions installs with `npm ci`, runs `npm run validate`, provisions
Chromium, runs `npm run test:e2e`, and runs Gitleaks. The `validation` and
`secret-scan` jobs are required for `main`. CI does not call live LLM, MCP,
Tableau, cloud, database, tunnel, or paid services, and it requires no
application credentials.

See the [validation policy](docs/development/validation-policy.md) for the
validation layers and evidence rules.

The deterministic transcript replay contract and example fixture are described
in [transcript replay](docs/development/transcript-replay.md).

The initial deterministic trigger boundary is described in
[trigger detector](docs/development/trigger-detector.md).

The application-layer path from an Analysis Contract to bounded agentic Tableau
analysis is described in
[agentic analysis](docs/development/agentic-analysis.md).

## Safety and external integrations

External integrations are explicit, opt-in, bounded, and observable. Secrets
must not be committed or placed in logs, prompts, traces, fixtures, or PRs.
Approved semantic MCP results may be consumed as evidence in the agentic loop,
but result content is not trusted authorization or instruction. Persistent
writes require explicit scope and human authorization.

See [external integration safety](docs/development/external-integration-safety.md)
for the full boundary.

## Human and agent responsibilities

Agents can investigate, compare alternatives, implement scoped changes,
validate, self-review, and prepare PRs. Humans retain final ownership of
product direction, material architecture and service decisions, security or
permission changes, material cost or data-flow choices, and merging.

## Roadmap

1. Repository, runtime, and governance foundation — Issues #1–#14.
2. Domain-neutral evaluation cases — [Issue #16](https://github.com/Chasoso/tableau-ambient-analyst/issues/16).
3. Agentic LLM + Tableau MCP technical spike — [Issue #17](https://github.com/Chasoso/tableau-ambient-analyst/issues/17).
4. Meeting-context, trigger, and evidence loop.
5. Demo scenario and Dashboard Extension experience.

## Documentation

- [Agent execution rules](AGENTS.md)
- [Development lifecycle](docs/development/development-loop.md)
- [Validation policy](docs/development/validation-policy.md)
- [External integration safety](docs/development/external-integration-safety.md)
- [Domain-neutral evaluation cases](docs/evaluation/agentic-cases.md)
- [ADR guide](docs/adr/README.md)
- [Initial runtime ADR](docs/adr/0001-initial-application-runtime.md)

The initial runtime ADR is `Accepted`: TypeScript / Node.js is the current core
runtime. Provider, audio, deployment, and other architecture decisions remain
open until separately evaluated and confirmed.
