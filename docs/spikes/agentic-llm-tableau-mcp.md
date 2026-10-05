# Agentic LLM + Tableau MCP technical spike

## Status

**Technical spike complete — agentic feasibility is partially supported.**

This document records the experiment boundary and final stopping point for
Issue #17. It does not select a production provider or add a provider
abstraction. Its architecture recommendation is recorded in
[ADR-0002](../adr/0002-proposed-agentic-tableau-analysis-boundary.md) as
Proposed, not Accepted. The measured conclusion is
`AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED`; it is not a claim that LLM-only
orchestration is sufficient. Detailed pilot and measured-run results are recorded in
[`agentic-llm-measured-runs.md`](agentic-llm-measured-runs.md).

> **Historical / Superseded sections below:** this document preserves the
> original experiment plan and interim checkpoints. The corrected Second Phase
> C evaluation in [`agentic-llm-measured-runs.md`](agentic-llm-measured-runs.md)
> is the canonical final result. Do not use an interim `INCONCLUSIVE`,
> `NOT_READY`, or "do not close" statement below as the final Issue #17
> conclusion.

Final close-out scope is an OpenAI architecture-feasibility spike. Anthropic
and Bedrock live comparison was explicitly deferred by Human Decision and is
follow-up work, not a completion blocker. `SPIKE_FINDINGS=COMPLETE` and
`SCOPE_SATISFACTION=ACCEPTABLE_WITH_DOCUMENTED_DEFERRED_WORK`; merge readiness
remains `PENDING_REVIEW` until Independent Review completes successfully.

## Question

After receiving one initial exploration policy and completion condition, can a
modern agentic LLM continue a bounded Tableau MCP investigation without
additional sequential instructions from a human or application?

## Hypothesis

Provider-managed MCP/tool loops may own the choice of the next approved
exploration step, while the application retains completion verification,
authorization, bounds, accounting, and human escalation.

## Capability result

Current official capability reconnaissance is recorded in
[`agentic-provider-capabilities.md`](agentic-provider-capabilities.md).
OpenAI Responses remote MCP, Anthropic's remote MCP connector, Bedrock
AgentCore Gateway, and Bedrock Converse tool use are materially different
configurations. They must not be hidden behind a false uniform provider
abstraction before a live run.

## OpenAI smoke evidence

The human-approved first experiment configuration was checked on 2026-10-04:

- `GET /v1/models`: HTTP 200; `gpt-5.6-luna` was present.
- `POST /v1/responses`: HTTP 200 using `gpt-5.6-luna`.
- Usage: 13 input tokens, 5 output tokens, 18 total tokens.
- Approximate smoke cost: `$0.00000860`.
- The API key was read from the approved macOS Keychain service only for the
  child process making the request. Its value was not displayed, logged, or
  stored.

This proves model/API connectivity only. It does not prove remote MCP access
or any Tableau analysis capability. No fallback model was used.

## OpenAI remote MCP configuration

The current official OpenAI configuration uses a Responses request `tools`
entry with `type: "mcp"`, `server_label`, and `server_url`. If the remote
server requires OAuth, the access token is supplied as `authorization` on the
request and must not be written to repository artifacts. `allowed_tools` can
restrict the tools imported from the server. For the bounded Hosted feasibility
experiment, `require_approval: never` was used only with the three approved
read-only model-visible tools. This is an experimental setting, not a
production approval recommendation. Hosted OAuth scope breadth and Viewer
least-privilege authentication remain unresolved.

Tool discovery and calls are represented in the Responses result as
`mcp_list_tools` and `mcp_call` items. Call output or errors are returned as
tool-result data and remain untrusted evidence. The application must continue
to enforce evidence completion, time/call/result limits, authorization, and
stop-on-auth-or-permission-failure behavior.

## Proposed experiment boundary (human approval required)

The following is a bounded proposal, not an authorization to connect:

| Boundary | Proposed value |
| --- | --- |
| Common benchmark | #16 `EvaluationCase` definitions and completion conditions |
| Provider configurations | OpenAI Responses API with `gpt-5.6-luna` for the first bounded experiment; other providers remain unapproved candidates |
| Cases | First batch after approval: `incomplete-first-result`, `empty-result-recovery`, `hypothesis-disproved`, `insufficient-evidence`; one run each |
| Tableau datasource | Approved: `Tableau Public Per Day(2025/04-)`, LUID `14f3ac6d-1171-4065-baac-c63bdce1470f`; final demo data is excluded |
| MCP endpoint | Hosted Tableau MCP at `https://mcp.tableau.com`, subject to OAuth and site approval |
| Tools | Approved allowlist: `list-datasources`, `get-datasource-metadata`, and `query-datasource`; `list-datasources` is connection/target verification only |
| Writes | No persistent Tableau writes; no inferred permission expansion |
| Tool calls | Initial maximum: 6 per run |
| Retries | Initial maximum: 1 recoverable retry per run; no auth/permission retry |
| Timeout | Proposed maximum: 10 minutes per run |
| Result size | Maximum 100 rows; aggregation-first, bounded semantic summaries/evidence IDs preferred; no raw transport dump or bulk row-level data |
| Logs | Provider, case, timings, tool names, statuses, evidence IDs, token/cost metadata when available |
| Cost | A human-approved per-provider and total spend cap is still required before execution |

The OpenAI model and endpoint candidate, Tableau datasource, tool allowlist,
read-only boundary, and 100-row result limit are approved for the first
experiment. The Tableau Cloud site, OAuth client identity/registration path,
redirect URI, exact OAuth scope negotiation, and final spend boundary remain
human-owned prerequisites.

## Hosted Tableau MCP boundary check

The candidate endpoint is `https://mcp.tableau.com`. An unauthenticated HTTPS
request reached the endpoint and returned HTTP 401 with a Bearer challenge.
The protected-resource metadata endpoint returned HTTP 200 and identified
`https://sso.online.tableau.com` as the authorization server. The advertised
scope set includes read scopes as well as write-capable scopes, so the
unauthenticated challenge is not evidence that this experiment has a
read-only boundary.

No Tableau OAuth session was available to this process. Consequently, no site
was selected, no datasource was enumerated, no tool list was retrieved, and no
Tableau data or write operation was attempted. The approved datasource and
allowlist below are configuration decisions, not evidence that they are
currently accessible through this process.

Hosted Tableau MCP documentation describes per-user OAuth and Tableau Cloud
permissions. Site selection is part of the OAuth connection, particularly for
multi-site users. The hosted service's catalog is still constrained by the
user's Tableau permissions and any site-level tool exclusions.

## OAuth feasibility check

The live protected-resource metadata and authorization-server metadata were
checked without sending credentials or starting a browser authorization:

| Item | Observed value |
| --- | --- |
| OAuth version | OAuth 2.1 for Hosted Tableau MCP |
| Authorization endpoint | `https://sso.online.tableau.com/oauth2/authorize` |
| Token endpoint | `https://sso.online.tableau.com/oauth2/token` |
| Revocation endpoint | `https://sso.online.tableau.com/oauth2/revoke` |
| Grant types advertised | `authorization_code`, `refresh_token`, and a Salesforce cloud-to-cloud grant |
| Response type | `code` |
| PKCE | `S256` advertised |
| Token endpoint authentication | `none` advertised; no client secret was requested or supplied |
| CIMD | `client_id_metadata_document_supported: true` |
| Dynamic registration | No `registration_endpoint` was advertised in the authorization-server metadata |
| Redirect URI / client ID | Supplied by the MCP client; not selected locally |

The important distinction is that the Hosted Tableau path advertises CIMD, not
RFC 7591 Dynamic Client Registration. With CIMD, the MCP client's `client_id`
is an HTTPS URL for a client metadata document; it is not a Tableau Connected
App client ID. The official Tableau MCP authorization implementation fetches
and validates that document, including its redirect URI list, when the
`client_id` is a URL. The document must be reachable by the Hosted service and
must identify itself with the same URL.

Therefore, the absence of `registration_endpoint` does not imply that a human
must create a client ID. It means the local harness must implement the MCP
CIMD client path (including hosting the metadata document at an HTTPS URL).
No Tableau Connected App or manual pre-registration is required by the evidence
currently available. The exact hosting mechanism for a temporary CIMD document
is still an implementation choice and must not expose secrets.

### Minimal local OAuth bootstrap proposal

The smallest supported path for this spike is:

1. Start a local harness with an ephemeral loopback callback and state/PKCE.
2. Serve a minimal HTTPS CIMD document whose `client_id` is its own URL and
   whose redirect URI list contains the harness callback.
3. Build the Tableau authorization URL using that CIMD URL as `client_id`,
   `response_type=code`, and `code_challenge_method=S256`.
4. Open the URL for human Tableau sign-in/consent; receive the callback locally
   and exchange the code in memory.
5. Pass the resulting Tableau access token only in each OpenAI Responses MCP
   request's `authorization` field.

The OpenAI API does not perform this bootstrap. Its current documentation says
OAuth client registration and authorization are handled separately by the
application; the application supplies the resulting access token in
`tools[type="mcp"].authorization` on every request. OpenAI does not store or
return that token.

The Hosted Tableau MCP docs explain why clients such as Claude Code can add the
endpoint and then authenticate in the client UI: the MCP client owns the OAuth
discovery, CIMD/bootstrap, browser authorization, and token handling. The docs
do not indicate that Tableau requires a manually created Connected App for this
hosted flow.

Reference material: [OpenAI MCP authentication and client responsibility](https://developers.openai.com/api/docs/guides/tools-connectors-mcp),
[Hosted Tableau MCP](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp),
[Tableau OAuth](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/authentication/oauth),
and the [official CIMD authorization implementation](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/authorize.ts).

The HTTPS publication options for the local CIMD document are compared in
[`tableau-cimd-exposure-options.md`](tableau-cimd-exposure-options.md). No
option has been activated yet.

No token, authorization code, cookie, or Authorization header should be pasted
into chat. Access and refresh tokens must not be persisted by this spike.

Until then:

```text
HUMAN_ACTION_REQUIRED — browser sign-in/consent only when the CIMD bootstrap is ready
```

### Approved evaluation datasource boundary

The fixed neutral evaluation target is:

- Name: `Tableau Public Per Day(2025/04-)`
- Datasource LUID: `14f3ac6d-1171-4065-baac-c63bdce1470f`
- Use: #16 evaluation cases only; not a final conference/demo dataset

After OAuth, `list-datasources` may verify that this LUID is visible, but it
must not be used to browse unrelated datasources. The harness must then use the
fixed LUID for metadata and query calls.

### Approved minimum tool allowlist

The approved minimum read-only set is:

| Tool | Purpose | Write behavior | Why needed / alternative |
| --- | --- | --- | --- |
| `list-datasources` | Confirm the approved LUID is visible | Read | Connection/target verification only; do not browse unrelated datasources |
| `get-datasource-metadata` | Confirm fields/parameters needed by the neutral cases | Read | Needed to map evidence requirements without embedding Tableau fields in #16 cases |
| `query-datasource` | Retrieve bounded metric, period, segment, and filter evidence | Read | Core analysis capability; unrestricted SQL/code execution is not required |

`get-view-data` and tools that create, upload, download, modify, or otherwise
persist Tableau content are excluded. Unrestricted SQL/code execution is also
outside the boundary. OAuth must still be checked after authentication to
confirm that the approved calls are actually permitted.

Result limits should be configured at the Tableau boundary and kept to bounded
semantic summaries/evidence IDs for the run record. The hosted endpoint's
available scope and tool catalog must not be treated as authorization to
expand this allowlist. The application must enforce the 100-row maximum even
if the remote tool exposes a larger limit.

## Historical live prerequisites — superseded

The following actions were required before the live portion could run and have
now been completed for the current bounded batch:

1. The harness implements the CIMD document and local state/PKCE callback path.
2. Human completes OAuth for the target Tableau Cloud site through the hosted
   MCP endpoint when the harness presents the authorization URL.
3. The harness verifies the approved datasource LUID and three-tool allowlist,
   then confirms the 100-row/no-write boundary.
4. The harness passes the access token only to OpenAI's MCP authorization
   field and keeps it in memory.
5. Human confirms the data-flow, retention/logging boundary, and remaining
   experiment spend cap.

The local harness completed OAuth with the dedicated Viewer, verified the
approved datasource and tools, and completed the bounded four-case batch. The
live integration is therefore classified as:

```text
PASS for connectivity / integration
INCONCLUSIVE for agentic behavior
```

The detailed measured-run record explains why transport success is not treated
as an agentic behavior PASS.

## Planned run evidence

When prerequisites are supplied, each run must record bounded structured data:

- provider/configuration and case ID;
- start/end time and latency;
- ordered semantic tool names and success/empty/error status;
- evidence IDs obtained and required evidence completion;
- final outcome (`supported`, `revised`, `rejected`, or
  `insufficient-evidence`);
- empty/error recovery, redundant calls, and premature stop observations;
- token usage and approximate cost when exposed; and
- failure classification and whether application-side orchestration was
  required.

Raw auth material, raw MCP transport, unrestricted provider traces, full
transcripts, and unnecessary datasource rows must not be recorded.

## Evaluation cases

The #16 cases remain the source of truth. At minimum, the live run must cover:

| Required behavior | Cases |
| --- | --- |
| multi-step continuation after incomplete evidence | `incomplete-first-result`, `dimension-change`, `temporal-comparison` |
| empty-result recovery | `empty-result-recovery` |
| hypothesis disproof/revision | `hypothesis-disproved` |
| insufficient evidence and stopping | `insufficient-evidence` |
| one-call stopping | `one-call-sufficient` |

The evaluation dataset is not the demo dataset. No `#Vizトーク` scenario or
final Tableau demo datasource is required or selected here.

## Expected responsibility boundary to test

The experiment should measure, rather than assume, whether the provider can
own:

- choosing the next approved exploration step;
- changing an approved condition or dimension;
- retrying a bounded recoverable exploration error; and
- revising or rejecting a hypothesis.

The application must retain:

- required-evidence and completion verification;
- datasource, tool, permission, and result authorization;
- call, retry, timeout, token, and cost bounds;
- authentication/permission failure handling;
- run accounting and bounded observability; and
- human escalation and all persistent-write decisions.

These are the proposed evaluation dimensions, not an accepted architecture.

## Historical validation — superseded

- `npm ci`: passed on the clean `main` baseline and feature branch.
- `npm run validate`: passed on the feature branch (41 tests).
- `git diff --check`: passed on the feature branch after instrumentation changes.
- OpenAI smoke: passed; not an evaluation run.
- Hosted Tableau MCP initialize, tools/list, metadata, and bounded query checks:
  passed with the approved dedicated Viewer boundary.
- Four measured cases: executed once each; agentic behavior inconclusive because
  final answers/outcomes were not captured and continuation was not observed.
- normal CI remains deterministic and has no live provider/MCP dependency.

## Tableau MCP boundary result

- **Endpoint:** `https://mcp.tableau.com`.
- **Authentication:** Hosted Tableau MCP OAuth 2.1 through Tableau SSO;
  the dedicated Viewer token was held in memory only.
- **Connection result:** authenticated MCP initialize and approved read-only
  calls succeeded.
- **Approved datasource:** `Tableau Public Per Day(2025/04-)`, LUID
  `14f3ac6d-1171-4065-baac-c63bdce1470f`.
- **Approved tools:** `list-datasources` for fixed-target verification,
  `get-datasource-metadata`, and `query-datasource`.
- **Approved boundary:** read-only, aggregation-first, maximum 100 rows, no
  persistent writes, and no unrestricted SQL/code execution.
- **No site-level settings changed:** the broad Hosted MCP OAuth challenge was
  accepted only for this temporary spike exception; effective safety remained
  the dedicated Viewer, approved datasource, allowed tools, and application
  read-only policy.

OpenAI smoke connectivity, authenticated remote-MCP request semantics, and the
approved Tableau boundary check are complete. The remaining gap is usable
behavioral instrumentation; no additional paid measured run is authorized by
the current record.

## Historical recommendation — superseded

At this checkpoint the recommendation was to defer the agentic conclusion.
That interim conclusion was superseded by the corrected Second Phase C
evaluation: `SPIKE_FINDINGS = COMPLETE`,
`AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED`, and
`ARCHITECTURE_PRINCIPLE = SUPPORTED_WITH_CAVEATS`. Issue #17 may close with
the architecture recommendation remaining Proposed; see the canonical
measured-run record for the final disposition.
