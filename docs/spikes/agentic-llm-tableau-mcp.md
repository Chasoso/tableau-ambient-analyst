# Agentic LLM + Tableau MCP technical spike

## Status

**Inconclusive — live prerequisites are missing.**

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

## Proposed experiment boundary (human approval required)

The following is a bounded proposal, not an authorization to connect:

| Boundary | Proposed value |
| --- | --- |
| Common benchmark | #16 `EvaluationCase` definitions and completion conditions |
| Provider configurations | One current configuration each for OpenAI, Anthropic, and Bedrock only if prerequisites are approved |
| Cases | Cases A–G, one run per provider/configuration initially |
| Tableau datasource | One approved synthetic or neutral evaluation datasource; final demo data is excluded |
| MCP endpoint | One approved Hosted Tableau MCP or explicitly approved self-hosted endpoint |
| Tools | Read-only metric retrieval, period comparison, breakdown, and bounded filter/condition adjustment only after actual tool discovery |
| Writes | No persistent Tableau writes; no inferred permission expansion |
| Tool calls | Proposed maximum: 8 per run |
| Retries | Proposed maximum: 2, only for documented transient/recoverable errors; no auth/permission retry |
| Timeout | Proposed maximum: 10 minutes per run |
| Result size | Bounded semantic summaries/evidence IDs only; no raw transport dump or unbounded row-level data |
| Logs | Provider, case, timings, tool names, statuses, evidence IDs, token/cost metadata when available |
| Cost | A human-approved per-provider and total spend cap is still required before execution |

The actual Tableau tool names, endpoint, datasource, model/configuration,
authentication mechanism, and cost cap cannot be selected by this spike
without human-owned service, permission, data-flow, and cost decisions.

## Required live prerequisites

The following minimum actions are required before the live portion can run:

1. Human selects at least one provider configuration and approves its cost
   boundary.
2. Human supplies access through an approved credential mechanism without
   placing credential values in the repository, prompt, logs, traces, Issue,
   or PR.
3. Human approves a Tableau Cloud/Server site, synthetic or neutral datasource,
   MCP endpoint, and read-only tool allowlist.
4. The selected provider can reach the approved MCP boundary using its current
   supported transport/auth mechanism.
5. Human confirms the data-flow and retention/logging boundary.

The local environment currently has no provider/Tableau credential or approved
endpoint configuration. The live experiment is therefore classified as:

```text
NOT RUN — prerequisite missing
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

- `npm ci`: passed on the clean `main` baseline.
- `npm run validate`: passed on the clean `main` baseline (41 tests).
- `git diff --check`: passed before branch creation.
- live provider runs: `NOT RUN — prerequisite missing`.
- live Tableau MCP runs: `NOT RUN — prerequisite missing`.
- normal CI remains deterministic and has no live provider/MCP dependency.

## Human prerequisite required

- **Missing prerequisite:** approved provider credential/configuration, Tableau
  datasource, MCP endpoint/tool allowlist, and spend/data-flow authorization.
- **Why required:** Issue #17 explicitly requires Layer 3 live evidence; local
  fixtures or documentation cannot establish provider-side exploration behavior.
- **Provider/service:** OpenAI Responses MCP, Anthropic MCP connector, and/or
  Bedrock AgentCore/Converse, plus Tableau MCP.
- **Permission/cost implication:** external data leaves the local boundary and
  provider/Tableau usage may incur account, quota, or paid-service cost.
- **Exact minimal human action:** choose one provider configuration, approve a
  read-only neutral datasource and MCP tool boundary, provide access through an
  approved secret mechanism, and set a spend cap.
- **Already complete:** current official capability reconnaissance, experiment
  boundary, safety/logging policy, and deterministic baseline verification.
- **After prerequisite:** run the bounded #16 cases, record structured evidence,
  compare orchestration responsibility, and update this document with results.

## Recommendation

**DEFER live execution pending human prerequisites.** Do not mark Issue #17
complete or accept a provider/architecture decision from this documentation
alone. After a bounded live run, issue a separate human-reviewed
`KEEP`/`REVISE`/`REJECT`/`DEFER` recommendation.
