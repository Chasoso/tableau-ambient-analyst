# Agentic LLM + Tableau MCP technical spike

## Status

**Inconclusive — OpenAI smoke passed; Tableau boundary approval is pending.**

This document records the experiment boundary and the current stopping point
for Issue #17. It does not select a production provider, create an ADR, add a
provider abstraction, or claim live evidence.

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
restrict the tools imported from the server. The default approval behavior
requires approval before data is shared; no approval relaxation is authorized
for this spike yet.

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
| Tableau datasource | One human-approved synthetic or neutral evaluation datasource; final demo data is excluded |
| MCP endpoint | Hosted Tableau MCP at `https://mcp.tableau.com`, subject to OAuth and site approval |
| Tools | Candidate minimum: bounded `list-datasources` for discovery, `get-datasource-metadata`, and `query-datasource`; exact names/scope require authenticated discovery and approval |
| Writes | No persistent Tableau writes; no inferred permission expansion |
| Tool calls | Initial maximum: 6 per run |
| Retries | Initial maximum: 1 recoverable retry per run; no auth/permission retry |
| Timeout | Proposed maximum: 10 minutes per run |
| Result size | Bounded semantic summaries/evidence IDs only; no raw transport dump or unbounded row-level data |
| Logs | Provider, case, timings, tool names, statuses, evidence IDs, token/cost metadata when available |
| Cost | A human-approved per-provider and total spend cap is still required before execution |

The OpenAI model and endpoint candidate are now human-approved for the first
experiment, but the Tableau site, datasource, tool allowlist, OAuth scope,
result boundary, and final spend boundary remain human-owned decisions.

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
Tableau data or write operation was attempted.

Hosted Tableau MCP documentation describes per-user OAuth and Tableau Cloud
permissions. Site selection is part of the OAuth connection, particularly for
multi-site users. The hosted service's catalog is still constrained by the
user's Tableau permissions and any site-level tool exclusions.

### Candidate neutral datasource boundary

There is currently no authenticated datasource candidate to name. The next
safe discovery step is a bounded `list-datasources` call after a human selects
the Tableau Cloud site and approves discovery. A candidate must be synthetic or
otherwise neutral, support current metric/period/segment/filter behavior, and
have sensitivity and permissions explicitly confirmed. Documentation examples
are not datasource selection evidence.

### Candidate minimum tool allowlist

After datasource approval, the smallest proposed read-only set is:

| Tool | Purpose | Write behavior | Why needed / alternative |
| --- | --- | --- | --- |
| `list-datasources` | Bounded discovery before a datasource is selected | Read | Needed only for discovery; remove from the evaluation run after selection if the datasource identifier is fixed |
| `get-datasource-metadata` | Confirm fields/parameters needed by the neutral cases | Read | Needed to map evidence requirements without embedding Tableau fields in #16 cases |
| `query-datasource` | Retrieve bounded metric, period, segment, and filter evidence | Read | Core analysis capability; unrestricted SQL/code execution is not required |

`get-view-data` and tools that create, upload, download, modify, or otherwise
persist Tableau content are excluded from the initial proposal. Any exact
tool name, datasource identifier, result limit, and OAuth scope must be
rechecked after authenticated discovery and human approval.

Result limits should be configured at the Tableau boundary and kept to bounded
semantic summaries/evidence IDs for the run record. The hosted endpoint's
available scope and tool catalog must not be treated as authorization to
expand this allowlist.

## Required live prerequisites

The following minimum actions are required before the live portion can run:

1. Human approves the OpenAI remote-MCP request configuration, including the
   approval behavior and credential handoff boundary.
2. Human completes OAuth for one approved Tableau Cloud site through the
   hosted MCP endpoint.
3. Human selects a synthetic or neutral datasource and approves its sensitivity,
   permissions, and use for #16 evaluation cases.
4. Human approves the exact read-only tool allowlist, result-size limit, and
   no-write boundary.
5. Human confirms the data-flow, retention/logging boundary, and remaining
   experiment spend cap.

The local environment now has approved OpenAI smoke access, but no Tableau
OAuth session, approved site, datasource, tool allowlist, or data-flow boundary.
The live Tableau experiment is therefore classified as:

```text
NOT RUN — Tableau boundary approval missing
```

This is not a provider PASS, FAIL, or application defect.

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

## Current validation

- `npm ci`: passed on the clean `main` baseline and feature branch.
- `npm run validate`: passed on the feature branch (41 tests).
- `git diff --check`: passed on the feature branch before the latest commit.
- OpenAI smoke: passed; not an evaluation run.
- live Tableau MCP runs: `NOT RUN — Tableau boundary approval missing`.
- normal CI remains deterministic and has no live provider/MCP dependency.

## Tableau MCP human decision required

- **Endpoint:** `https://mcp.tableau.com`.
- **Authentication:** Hosted Tableau MCP uses OAuth 2.1 through Tableau SSO;
  the unauthenticated endpoint returned HTTP 401 and exposed a Bearer
  protected-resource challenge. No OAuth token was available to this process.
- **Connection result:** server reachable; authenticated MCP connection not
  established.
- **Candidate datasource:** none selected because authenticated enumeration has
  not been approved.
- **Candidate tools:** bounded `list-datasources` for discovery,
  `get-datasource-metadata`, and `query-datasource`; read-only proposal only.
- **Recommended minimum boundary:** one human-selected neutral datasource,
  those read-only tools only, bounded result size, no persistent writes, and no
  unrestricted SQL/code execution.
- **Exact human decisions requested:**
  1. approve one Tableau Cloud site and complete the hosted OAuth connection;
  2. select one synthetic/neutral datasource for #16 evaluation;
  3. approve the exact read-only tool allowlist and result limit; and
  4. approve the data-flow, logging/retention, and remaining spend boundary.

OpenAI smoke connectivity, official remote-MCP request semantics, and the
unauthenticated Tableau boundary check are already complete. The remaining
actions are material Tableau permission, data, and security decisions, not
implementation gaps.

## Recommendation

**DEFER live execution pending Tableau human prerequisites.** Do not mark Issue #17
complete or accept a provider/architecture decision from this documentation
alone. After a bounded live run, issue a separate human-reviewed
`KEEP`/`REVISE`/`REJECT`/`DEFER` recommendation.
