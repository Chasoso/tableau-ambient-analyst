# Issue #17 measured run record

## Status

**Inconclusive for agentic behavior.** The authenticated OpenAI Responses API
and Hosted Tableau MCP path worked, but the first four measured runs did not
produce enough structured evidence to evaluate the cases. These runs are not
to be treated as a successful benchmark and must not be silently rerun or
overwritten.

## Boundary

- Provider: OpenAI Responses API
- Model: `gpt-5.6-luna`; no fallback was used
- MCP endpoint: Hosted Tableau MCP
- OAuth identity: dedicated Tableau Viewer
- Datasource: `Tableau Public Per Day(2025/04-)`
- Datasource LUID: `14f3ac6d-1171-4065-baac-c63bdce1470f`
- Allowed tools: `list-datasources`, `get-datasource-metadata`,
  `query-datasource`
- Query policy: read-only, aggregation-first, maximum 100 rows
- Measured cases: one run each
- Write calls, site-setting changes, and model fallback: none

The earlier four runs remain **Pilot runs**. They established transport and
integration success but lacked the instrumentation needed for behavioral
evaluation. The table below records the new four **Measured runs** separately.

## Measured runs

| Case | MCP calls | First query behavior | Recovery/continuation | Final answer/outcome | Result |
| --- | ---: | --- | --- | --- | --- |
| `incomplete-first-result` | 2 | One `query-datasource` after metadata; no second query | Not observed | Final answer and outcome were not captured | Inconclusive; success criterion not met |
| `empty-result-recovery` | 2 | Narrow filter returned a validation error, not an empty result | No follow-up query | Final answer and outcome were not captured | Setup failure; recovery not evaluated |
| `hypothesis-disproved` | 2 | One `query-datasource` after metadata; no comparison continuation observed | Not observed | Final answer and outcome were not captured | Inconclusive; hypothesis state unavailable |
| `insufficient-evidence` | 2 | One `query-datasource` after metadata | Not observed | Final answer and outcome were not captured | Inconclusive; insufficient-evidence handling unavailable |

For all four runs, the call sequence was metadata followed by at most one
query. The run record captured tool names, parameter-key summaries, usage,
latency, and tool errors. It did not capture a usable final assistant answer,
structured outcome, or reliable result-row count. Therefore these runs cannot
establish evidence completion, premature stopping, redundant calls,
hypothesis revision, or correct insufficient-evidence handling.

The empty-result case produced a bounded filter-validation error for the
sentinel condition. This is not equivalent to an empty result, so it is
recorded as a case-setup failure rather than successful recovery.

## Cost

Approximate cost uses the checked `gpt-5.6-luna` pricing formula in the spike
harness: uncached input at `$0.20` per million tokens, cached input at `$0.02`
per million tokens, and output at `$1.20` per million tokens. Pricing source:
[OpenAI GPT-5.6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
checked 2026-10-04.

- Preflight OpenAI MCP checks: approximately `$0.00243696`
- Four measured runs: approximately `$0.00530012`
- Recorded continuation total: approximately `$0.00773708`
- No additional measured rerun is authorized by this record.

No credential, OAuth token, authorization header, raw transport dump, or
unbounded Tableau result was recorded.

## Instrumentation follow-up

The harness now accepts both top-level and nested Responses output text when
extracting the bounded final answer. It also keeps the existing bounded
structured call summaries and usage/cost accounting. This correction has not
been validated by another paid measured batch. A future measured rerun needs
explicit human approval because the permitted four-case batch was already
consumed.

## Frozen setup criteria for a future final batch

These criteria are fixed before any future paid rerun. A direct, read-only
Tableau query must validate the live setup first; an OpenAI run must not be
used to discover whether the setup is valid.

| Case | Query-one requirement | Required follow-up | Setup failure |
| --- | --- | --- | --- |
| `incomplete-first-result` | Month-level `Daily View Count` trend only | Workbook Title plus aggregated `Daily View Count` | Query one already contains workbook attribution, or either bounded query is unavailable |
| `empty-result-recovery` | Valid future-date filter succeeds with exactly 0 rows | Remove only the date condition and query again | Validation error, non-empty first result, or unbounded follow-up |
| `hypothesis-disproved` | Initial hypothesis names a known non-leading workbook | Obtain the Workbook Title ranking | The selected workbook is actually first, or ranking is unavailable |
| `insufficient-evidence` | Observed timing and workbook metrics | Stop without external causal evidence | The datasource directly contains the external cause |

The future run must record, per case, the initial prompt, required evidence,
query-one evidence, missing evidence, expected follow-up, pass criteria, fail
criteria, and setup-failure criteria. The corresponding deterministic setup
contract is implemented in `src/spike/measured-case-setup.ts` and covered by
tests; live datasource validation remains a separate preflight step.

## Assessment

### Provider behavior observed

- OpenAI-to-Hosted-Tableau-MCP authentication and approved read-only tool
  calls were available.
- The measured prompts did not demonstrate multi-step continuation within
  these runs.
- Hypothesis revision and insufficient-evidence behavior remain unmeasured.

### Application-owned boundary retained

OAuth/token handling, tool and datasource allowlists, result limits, run and
retry bounds, secret handling, write prohibition, and human escalation remain
application responsibilities. No production provider or orchestration
architecture is accepted by this record.

## Next decision

`HUMAN_DECISION_REQUIRED` before any additional paid case run. The decision
needed is whether to authorize one new four-case measured batch after the
instrumentation fix, or to retain this spike as inconclusive evidence.

## Latest deterministic live setup preflight

The latest OAuth session reached Tableau with the approved dedicated Viewer
and was stopped before any OpenAI measured case. The redesigned setup
validation found:

- metadata: HTTP 200;
- `Metric Date Time (JST)`, `Workbook Title`, and `Daily View Count` were
  available;
- month-level view aggregate: HTTP 200, 12 rows;
- Workbook Title view breakdown: HTTP 200, bounded at 100 rows;
- valid future-date filter: HTTP 200, 0 rows;
- relaxed aggregate recovery query: HTTP 200, 1 row;
- Workbook ranking: at least two workbooks, with a deterministic non-leading
  hypothesis available.

All four redesigned setup contracts are **VALID**. No OpenAI case run was
started and the additional four-run Measured allowance remains unconsumed.

## Final-batch preflight attempt

After the setup contracts passed, direct MCP initialization and `tools/list`
also succeeded, and the approved tools were visible. The first OpenAI relay
preflight (`list-datasources`) then failed before any case execution:

- HTTP status: `424`
- Error type: `external_connector_error`
- Error code: `http_error`
- Failure: error retrieving the Hosted Tableau MCP tool list
- OpenAI preflight calls: 1
- Measured case calls: 0
- Measured four-case allowance: unconsumed

This is recorded as an external Hosted MCP relay failure, not as agentic case
behavior. No case was retried and no additional OpenAI call was made.

## Relay diagnostic attempt

One bounded diagnostic retry was authorized after the `424` result. The
diagnostic used a fresh OAuth exchange, then tested the same token directly
against Hosted Tableau MCP immediately before any OpenAI request. The direct
MCP baseline failed at initialization with `401 invalid_token`, so the retry
was stopped before invoking the OpenAI relay. No additional retry was made.

- Token obtained: yes; token value was not logged or persisted.
- Token age at direct initialization: approximately 0 seconds.
- Token lifetime reported by Tableau: 3,599 seconds.
- Issued scope: the previously approved Hosted MCP scope set; no scope was
  added by this attempt.
- Direct MCP `initialize`: HTTP 401, `invalid_token`.
- Direct MCP `tools/list`: not attempted after initialization failure.
- OpenAI Responses relay: not attempted in this retry.
- Measured case calls: 0; the four-case allowance remains unconsumed.

The diagnostic harness used the same model, endpoint, server label, raw OAuth
token field, approved tool allowlist, and `require_approval: "never"` setting
as the earlier relay attempts. The OpenAI MCP configuration follows the
official [OpenAI MCP servers guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp):
the application supplies the OAuth access token in the MCP tool's
`authorization` field, while `allowed_tools` limits the tools imported from the
remote server. The token is sent as the raw OAuth token in that field; the
direct HTTP MCP requests use the `Bearer` scheme.

### Failure-layer assessment

The latest failure is below the OpenAI remote MCP connector: a newly obtained
token was rejected by the direct Hosted MCP initialize endpoint. This makes
the latest relay result **inconclusive** rather than evidence of a permanent
OpenAI/Hosted-MCP incompatibility. The earlier direct MCP success and earlier
OpenAI relay success remain historical evidence; the earlier `424` remains a
separate relay diagnostic failure. Agentic behavior was not evaluated.

The issue remains `HUMAN_DECISION_REQUIRED` because the single authorized
diagnostic retry did not reach the relay and no further OAuth or relay retries
are authorized by this record.

## Case setup redesign validation

The datasource was retained and the redesigned contracts were validated with
direct, read-only VDS queries only. No OpenAI request was made and no final
Measured slot was consumed.

### `incomplete-first-result`

- Question: Are recent view-count changes attributable to a particular
  workbook?
- Required evidence: month-level view trend and Workbook Title breakdown.
- Initial query: `MONTH(Metric Date Time (JST))` plus `SUM(Daily View Count)`.
- Initial evidence: HTTP 200, 12 aggregate rows; no workbook breakdown.
- Follow-up query: `Workbook Title` plus `SUM(Daily View Count)`.
- Follow-up evidence: HTTP 200, bounded to 100 rows.
- Setup status: **VALID**.

The first query supplies the trend but cannot attribute it to a workbook; the
second query is therefore necessary.

### `empty-result-recovery`

- First query: `SUM(Daily View Count)` with a valid future-date quantitative
  filter beginning `2099-01-01`.
- Query validity: HTTP 200, no validation error.
- Row count: 0.
- Recovery: remove only the date condition and repeat the aggregate query.
- Recovery result: HTTP 200, 1 row.
- Setup status: **VALID**.

This replaces the prior invalid sentinel-value filter, which returned HTTP 400
and was correctly classified as setup failure.

### `hypothesis-disproved`

- Initial hypothesis: `#B2VB 2024 Week 22 | Sports Viz Sunday x B2VB | #VOTD`
  has the highest aggregated view count.
- Validation query: `Workbook Title` plus `SUM(Daily View Count)`.
- Ground truth: `#MoM 2024 Week 34 | SNS Popularity in the U.S.` ranked first;
  the hypothesized workbook was not first.
- Expected final hypothesis state: `rejected` or `revised`.
- Setup status: **VALID**.

The ground truth is recorded for setup validation and must not be included as
the answer in the future provider prompt.

### `insufficient-evidence`

- Question: Why does a particular workbook have a higher view count?
- Available evidence: timing and workbook-level view metrics; the validated
  Workbook Title aggregate returned HTTP 200 with bounded rows.
- Missing evidence: external referrals, campaigns, events, search ranking,
  social distribution, or other causal factors.
- Correct outcome: `insufficient-evidence`; the provider must not invent a
  causal explanation.
- Setup status: **VALID**.

The four cases now exercise distinct behaviors: evidence-gap continuation,
empty-result recovery, hypothesis revision, and stopping at the evidence
boundary.
