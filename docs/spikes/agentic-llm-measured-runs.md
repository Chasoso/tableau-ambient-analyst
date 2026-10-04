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
