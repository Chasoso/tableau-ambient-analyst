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

## OAuth token timing diagnosis

The next bounded diagnostic tested whether a newly issued token became
acceptable to Hosted Tableau MCP after a short propagation delay. No OpenAI
request or measured case was made.

### Same-token test

The same fresh token was reused for all three direct `initialize` attempts.
The recorded elapsed times include the preceding HTTP request latency, so the
observed ages were approximately 0.5, 3.0, and 6.4 seconds rather than exact
wall-clock targets.

| Attempt | Target | Observed token age | Initialize | Error |
| --- | ---: | ---: | --- | --- |
| T+0 | 0s | 0.5s | HTTP 401 | `invalid_token` |
| T+2 | 2s | 3.0s | HTTP 401 | `invalid_token` |
| T+5 | 5s | 6.4s | HTTP 401 | `invalid_token` |

### Fresh-token bounded retry

A second fresh OAuth exchange was then performed, as permitted by the human
decision. The same token was tested once after an intentional two-second wait
and once after an additional three-second wait. Both attempts returned HTTP
401 `invalid_token` (observed ages approximately 2.6 and 6.1 seconds).

The timing hypothesis is therefore **not supported by this bounded evidence**:
neither token became valid within approximately six seconds. This does not
identify the root cause of token rejection. OAuth issuance succeeded and
reported a 3,599-second lifetime, but Hosted MCP token acceptance remained
unreliable in these attempts. No additional OAuth exchange or retry is
authorized by this record.

### Sequencing assessment

The harness awaits the callback, completes the authorization-code exchange,
fully parses the token response, selects `access_token`, and only then starts
the direct MCP request. No stale-token, refresh-token, concurrent-state, or
token-response parsing race was found in the inspected code path. The token is
never written to logs or files.

Classification for this continuation:

- OAuth issuance: `SUPPORTED` for issuance only.
- Hosted MCP token acceptance: `FAILED / NOT REPRODUCIBLY WORKING`.
- Direct Hosted MCP reliability: previously successful, currently
  intermittent/inconclusive.
- OpenAI remote MCP relay: not evaluated in this continuation.
- Agentic behavior: not evaluated.

## OAuth context diagnosis

One additional fresh OAuth flow was completed from the human-confirmed
dedicated Viewer session. OpenAI was not called and no measured case was
started.

### Observed OAuth context

- Authorization endpoint:
  `https://sso.online.tableau.com/oauth2/authorize`
- Token endpoint: `https://sso.online.tableau.com/oauth2/token`
- Authorization server / issuer: `https://sso.online.tableau.com`
- Client ID and CIMD URL: the same ephemeral Quick Tunnel `/cimd.json` URL
- Redirect URI: loopback callback on `127.0.0.1`; exact port was ephemeral
- Response type: `code`
- PKCE: `S256`
- Requested resource: `https://mcp.tableau.com`
- Requested audience: not specified
- Protected-resource advertised resource: `https://mcp.tableau.com`
- Protected-resource authorization server: `https://sso.online.tableau.com`
- Authorization metadata: CIMD supported; `S256` supported; scopes-supported
  was not advertised in the retrieved metadata.

The CIMD endpoint was reachable with HTTP 200 immediately before the direct
Hosted MCP initialize. There is no evidence in this run that Hosted MCP
requires a CIMD refetch during initialize; the endpoint was nevertheless
still alive.

### Token metadata

- Token type: `Bearer`
- Format: JWT-like
- Length: 2,579 characters
- Lifetime: 3,599 seconds
- Refresh token: present (value not logged or persisted)
- Issued scopes: the approved broad Hosted MCP scope set; no additions
- `iss`: `https://sso.online.tableau.com`
- `aud`: the ephemeral CIMD URL
- `iat` / `nbf` / `exp`: internally consistent with the reported lifetime
- `scope`: matched the issued scope string

The token's observed audience is the CIMD client ID URL, while the requested
and advertised resource is `https://mcp.tableau.com`. This is an observed
resource/audience difference and a remaining diagnostic hypothesis, not a
confirmed cause: the correct audience behavior for this Hosted MCP OAuth flow
must be established from Tableau's current implementation or documentation
before changing the request.

### Direct initialize and site context

- Direct Hosted MCP `initialize`: HTTP 401
- Sanitized error body: no JSON-RPC error code or message observed
- `WWW-Authenticate`: not present
- MCP session ID: absent
- Token age: approximately 2 seconds
- Target datasource visibility: not tested in this run because initialize
  failed
- Wrong-site routing: no positive evidence; site context could not be
  independently verified at the MCP layer

The harness path was verified from code as: callback state validation → code
extraction → awaited token exchange and JSON parsing → `access_token` field
selection → `Bearer` authorization header → initialize. The refresh token is
not used as the access token, no truncation or whitespace manipulation is
performed, and no concurrent OAuth state is shared. These observations weaken
the stale-token and token-response sequencing hypotheses, but cannot explain
the server-side `invalid_token` response by themselves.

### Previous-run comparison

The repository evidence does not contain complete sanitized OAuth metadata for
the earlier successful direct MCP run. Therefore client ID, CIMD URL,
redirect URI, token type, audience, and site context for that run are
`UNKNOWN`; the endpoint and general resource value are known to have been the
same Hosted Tableau MCP path. The current run must not be treated as proof of
a permanent audience mismatch without comparable success-run token metadata.

### Current diagnosis

Observed:

- OAuth authorization and token issuance succeed.
- The token is a short-lived Bearer JWT-like token.
- CIMD remains reachable after token exchange.
- The token audience is the CIMD URL, not the Hosted MCP resource URL.
- Hosted MCP rejects the token at initialize with HTTP 401.

Not yet proven:

- Whether Hosted MCP requires `aud = https://mcp.tableau.com`.
- Whether the authorization server intentionally uses the CIMD client ID as
  audience for this flow.
- Whether the dedicated Viewer/site context contributes to this rejection.

The most likely failure layer remains Hosted MCP token acceptance or an OAuth
resource/audience compatibility issue. No OAuth request, scope, site role, or
security boundary was changed. The issue remains `HUMAN_DECISION_REQUIRED`.

## Token-request resource inspection

The OAuth implementation was inspected without starting a new live flow. The
authorization request and authorization-code token request both carry the
same resource value, `https://mcp.tableau.com`.

| Parameter | Authorization request | Token request |
| --- | --- | --- |
| `client_id` | present | present |
| `redirect_uri` | present | present |
| `resource` | `https://mcp.tableau.com` | `https://mcp.tableau.com` |
| `scope` | present | not separately sent; authorization-code grant uses the issued grant |
| `code_challenge` / `code_verifier` | `code_challenge` + `S256` | `code_verifier` |

The token request body is constructed with `grant_type`, `client_id`, `code`,
`redirect_uri`, `code_verifier`, and `resource`. The resource is encoded once
by `URLSearchParams`; no OAuth behavior was changed in this continuation.

RFC 8707 defines `resource` as an absolute URI identifying the protected
resource, and specifically states that when it is used on an access-token
request it identifies the resource where the token will be used. It also notes
that the authorization server may map the resource value to another audience
identifier rather than copying it verbatim. See [RFC 8707, sections 2 and
2.2](https://datatracker.ietf.org/doc/html/rfc8707). The current Tableau
metadata and prior live evidence establish the protected resource as
`https://mcp.tableau.com`, but do not establish why the issued token's `aud`
was the CIMD URL.

Conclusion for the resource-propagation hypothesis: **NOT SUPPORTED**. The
resource is present in both requests, so no fresh OAuth or initialize retry was
performed. The remaining diagnosis is the OAuth server's audience semantics or
Hosted MCP token validation/CIMD interaction, not a missing token-request
resource parameter.

## Tableau OAuth and Hosted MCP source investigation

This investigation used current Tableau documentation and the public
`tableau/tableau-mcp` repository. No live OAuth or MCP request was made during
this investigation.

### Official Hosted MCP facts

Documented facts:

- Hosted Tableau MCP is available at `https://mcp.tableau.com` and uses OAuth
  2.1 with the signed-in user's Tableau Cloud permissions.
- The hosted architecture describes a routing layer that inspects the OAuth
  token and routes an authenticated request to the corresponding Tableau Cloud
  pod.
- The protected resource advertised by the live metadata is
  `https://mcp.tableau.com`.
- Tableau's public documentation describes a 401 as an authentication failure,
  but does not publish the Hosted MCP validator's exact audience-validation
  rule or the internal reason for this run's `invalid_token` response.

Sources: [Hosted Tableau MCP](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp),
[Hosted MCP architecture](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp/architecture),
and [auth-error diagnosis](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/multiple-servers).

### Public source findings

The current public source contains an explicit audience-validation path in
`src/server/oauth/accessTokenValidator.ts` and a canonical resource builder in
`src/server/oauth/resourceIdentifier.ts`:

- `aud` is checked against the MCP resource identifier (and configured global
  resource URIs), with issuer and expiry checked separately.
- `client_id` is treated as a distinct token claim; the source comment states
  that `aud` holds the resource URL and is not the client ID.
- The source returns `invalid_token` when access-token validation fails.
- The canonical resource for self-hosted deployments includes the MCP server
  path (`<resource URI>/tableau-mcp`), while the hosted deployment advertises
  its own global resource URL.

Source references: [accessTokenValidator.ts](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/accessTokenValidator.ts),
[resourceIdentifier.ts](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/resourceIdentifier.ts),
and [authMiddleware.ts](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/authMiddleware.ts).

Applicability:

- The validator/resource behavior is **explicitly implemented in the public
  self-hosted code**.
- It is **likely a shared design signal** for the Hosted service because the
  Hosted service is the same Tableau MCP product family and documents resource
  based routing.
- It is **not proof of the Hosted backend's deployment configuration or exact
  code version**. Hosted internal behavior remains unknown.

### OAuth standard findings

RFC 8707 permits `resource` on both authorization and token requests. It says
the authorization server should audience-restrict the token to the indicated
resource, but it may map the resource URI to another audience identifier. The
standard therefore does not require literal string equality in every deployment;
it does require the resource server and authorization server to agree on the
mapping. [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707)

This standard behavior does not explain why this token's `aud` was the CIMD
client URL. No Tableau documentation found in this investigation states that
the CIMD URL is the expected audience for Hosted MCP.

### CIMD and upstream issue evidence

The Hosted authorization metadata advertises CIMD support and does not advertise
RFC 7591 dynamic registration. Tableau's upstream [issue #772](https://github.com/tableau/tableau-mcp/issues/772)
records the same metadata chain and the absence of `registration_endpoint`, but
does not establish an audience rule or resolve Hosted token validation.

The merged [PR #832](https://github.com/tableau/tableau-mcp/pull/832) adds
loopback-host normalization for audience validation in the public source. It
confirms that audience validation is an active concern, but it addresses
`localhost` versus `127.0.0.1` for local deployments, not a remote Hosted MCP
token whose audience is a CIMD URL.

### Observed versus documented

| Property | Observed | Expected/documented | Assessment |
| --- | --- | --- | --- |
| Issuer | `https://sso.online.tableau.com` | Same authorization server from protected-resource metadata | Match |
| Audience | Ephemeral CIMD URL | Hosted resource is `https://mcp.tableau.com`; public validator uses a resource identifier | Difference; Hosted rule undocumented |
| Resource | Requested in both OAuth requests as `https://mcp.tableau.com` | Protected-resource metadata advertises the same value | Match |
| Token type | Bearer, JWT-like | Bearer authorization for MCP | Match |
| Lifetime | About 1 hour | Hosted lifetime not explicitly documented in retrieved pages | Not assessable |
| Scope | Approved broad Hosted MCP scope set | Scope challenge/entitlements apply separately from audience | Not the primary unexplained difference |

### Audience hypothesis

Classification: **AUDIENCE_MISMATCH_LIKELY**.

Supporting evidence:

- The observed `aud` is the CIMD URL, not the Hosted protected resource.
- The public Tableau MCP validator checks `aud` against a canonical resource
  identifier and treats `client_id` separately.
- The Hosted docs identify `https://mcp.tableau.com` as the canonical hosted
  resource/routing URL.
- Hosted MCP rejects the token at initialize with `401 invalid_token`.

Limitations:

- The public validator is self-hosted source and may not be the exact Hosted
  backend build.
- The successful historical run has no saved token audience metadata.
- No public Tableau statement explicitly says Hosted MCP rejects `aud = CIMD
  URL`.

Therefore this is the leading hypothesis, not a confirmed root cause.

### Alternative hypotheses

| Hypothesis | Assessment | Evidence |
| --- | --- | --- |
| Audience mismatch | Likely | Observed `aud` differs from Hosted resource; public validator is resource-based |
| Site routing / site binding | Plausible | Hosted docs describe site-scoped auth and routing; current MCP never reached site visibility |
| CIMD lifecycle | Weakened | CIMD was reachable immediately before initialize; no evidence initialize refetches it |
| Authorization-server regression | Plausible | Issuance succeeds but token is rejected by resource layer; public evidence cannot confirm |
| Hosted MCP validation regression | Plausible | Repeated 401 despite valid-looking issuance and prior success |
| Signature/key rotation issue | Unknown | Client cannot inspect Hosted validation keys or server logs |
| Short propagation delay | Weakened | Same and fresh tokens remained invalid through approximately six seconds |

### Client-side fix assessment

No safe client-side fix is identified. The token exchange already includes the
resource parameter, and a client cannot safely rewrite the signed token's
audience. Adding an audience parameter, changing `client_id`, or changing the
resource would be speculative and requires human approval. No code change was
made for this investigation.

### Tableau escalation draft

Public information is insufficient to identify the root cause. A minimal
sanitized support/upstream report should ask Tableau:

1. Is `aud=<CIMD client URL>` expected when authorization and token requests
   both use `resource=https://mcp.tableau.com`?
2. What audience does Hosted Tableau MCP validate for
   `https://mcp.tableau.com`?
3. Is the public self-hosted audience-validation behavior representative of the
   Hosted routing layer?
4. Are there known Hosted MCP/CIMD token-validation regressions?

Include only the Hosted endpoint, authorization server, CIMD usage, resource
value, sanitized issuer/audience pattern, scope summary, HTTP 401
`invalid_token`, approximate timestamp with timezone, and the fact that prior
direct MCP success exists. Do not include any token, code, header, cookie, or
secret.

The Issue #17 implication remains: integration feasibility is previously
demonstrated, authentication reproducibility is not established, relay
reliability is inconclusive, and agentic capability is unevaluated.

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

## Temporary privileged feasibility configuration

This section records the approved technical-spike exception that temporarily
used a Tableau Site Admin OAuth identity to separate agentic feasibility from
the unresolved least-privilege Hosted MCP authentication problem. This is not
a production recommendation and does not resolve the dedicated Viewer path.

Safety boundaries remained unchanged:

- OpenAI model: `gpt-5.6-luna`, with no fallback.
- Model-visible tools: `list-datasources`, `get-datasource-metadata`, and
  `query-datasource` only.
- Datasource: `14f3ac6d-1171-4065-baac-c63bdce1470f` only.
- Read-only, aggregation-first, maximum 100 rows, no write calls.
- Site-level MCP settings were not changed.

### Site Admin preflight

The fresh Site Admin OAuth flow issued a token with approximately 3599 seconds
of lifetime. Token value was not logged. The underlying VDS read-metadata check
returned HTTP 200. The following direct Hosted MCP checks also succeeded:

- `initialize`: HTTP 200; protocol `2025-06-18`.
- `tools/list`: HTTP 200; all three approved tools were present.
- `get-datasource-metadata`: successful through the approved OpenAI MCP check.
- Minimal aggregated `query-datasource`: successful, one result row.
- Target datasource remained fixed to the approved LUID.

The Hosted MCP returned a larger catalog to direct `tools/list`, but the OpenAI
requests used `allowed_tools` for only the approved three tools. No write-capable
tool was called. The token `iss`/`aud` metadata was not emitted by this run's
sanitized harness output, so it is recorded as unavailable rather than inferred.

### Viewer versus Site Admin interpretation

| Property | Dedicated Viewer path | Temporary Site Admin path | Assessment |
| --- | --- | --- | --- |
| Token issuance | Succeeds | Succeeds | Same observed issuance behavior |
| `aud` | CIMD URL | Not captured in this run | No causal comparison available |
| Hosted `initialize` | Repeated/intermittent 401 `invalid_token` | HTTP 200 | Privileged path improved feasibility, but does not prove role causation |
| `tools/list` | Previously successful in an earlier run; current Viewer reproducibility unresolved | HTTP 200 | Site Admin path is operational for this attempt |
| Least-privilege readiness | Blocked/unresolved | Not evaluated | Site Admin is only a temporary feasibility configuration |

### Measured batch result

The first measured case started only after the full preflight passed:

`incomplete-first-result` produced two MCP calls (metadata followed by one
aggregated query), but no final answer or structured outcome was captured. It
therefore did not demonstrate the required follow-up workbook exploration and
is recorded as **inconclusive / criterion not met**, not as a successful agentic
result.

Before the second case could start, the OpenAI remote MCP connector failed while
retrieving the Hosted MCP tool list:

```text
HTTP 424
type: external_connector_error
code: http_error
message: Error retrieving tool list from MCP server: 'tableau-hosted'
param: tools
```

The remaining three cases were not run. No retry was performed, so the final
four-case allowance is only partially consumed by this interrupted batch and
the unused cases are not valid evidence of agentic behavior.

Known cost for this attempt was approximately `$0.00634` for the three approved
preflight checks plus the first case request; the failed connector request did
not return usage in the harness output. This remains below the approximately
`$0.50` spike target, but the batch is not considered complete.

### Feasibility interpretation

- Agentic feasibility: **INCONCLUSIVE**. The Site Admin path reached the
  required preflight, but the measured run did not capture a final outcome and
  the connector failed before the remaining cases.
- Least-privilege readiness: **NOT READY / BLOCKED**. Site Admin success does
  not resolve the dedicated Viewer `invalid_token` reproducibility issue.
- Privileged identity changed the observed preflight outcome in this attempt:
  **YES, operationally**, but role causation is not proven because the Site
  Admin token audience was not captured and the Hosted connector can fail
  independently with HTTP 424.

No further measured run or retry is authorized by this record. Human review is
required before deciding whether to spend additional live budget or escalate
the Hosted MCP reliability issue.

## Responses API remote MCP request-construction audit

This audit was deterministic only; it made no OAuth, OpenAI, or Hosted MCP
request.

### Call-site inventory

| Call site | Purpose | Builder | Authorization source |
| --- | --- | --- | --- |
| `runOpenAiMcpRequest` | approved preflight checks and measured cases | shared `buildOpenAiMcpToolConfiguration` | current function argument from OAuth access token |
| `runRelayDiagnostic` | opt-in relay diagnostic | shared `buildOpenAiMcpToolConfiguration` | current function argument from OAuth access token |

There are no other `responses` API invocation sites and no `previous_response_id`
usage. Preflight checks and measured cases each create an independent request;
no MCP tool list or authorization state is cached in the application.

### MCP configuration contract

The shared builder now emits every request with:

```text
type: mcp
server_label: tableau-hosted
server_url: https://mcp.tableau.com
authorization: current OAuth access token (raw value, never logged)
allowed_tools: list-datasources, get-datasource-metadata, query-datasource
require_approval: never
```

The builder rejects missing, empty, or whitespace-only authorization before the
Responses API call. It does not add a `Bearer` prefix to the `authorization`
field; the field is the raw OAuth access token as specified by OpenAI. The
OpenAI API key remains a separate header credential and is obtained through the
existing Keychain boundary.

### Findings

- All current Responses API call sites use the same builder.
- Authorization is explicitly supplied on every independent request.
- Each request uses the current access-token argument; refresh-token values are
  not accepted by the builder as a separate path.
- `allowed_tools` is fixed to the approved three tools for every request.
- `server_label`, `server_url`, and `require_approval` are fixed consistently.
- No `previous_response_id` is used, so there is no implicit credential or MCP
  session inheritance assumption.
- The code does not cache `mcp_list_tools` output across requests.

Classification: **NO_REQUEST_CONSTRUCTION_BUG_FOUND**. The previous HTTP 424
remains more consistent with an external OpenAI remote-MCP connector / Hosted
MCP interaction failure than with omitted authorization in this repository.

### Deterministic regression coverage

`tests/openai-mcp-request.test.ts` verifies complete configurations for
preflight and four independent case-shaped requests, token replacement between
requests, and fail-closed behavior for empty/whitespace authorization. The
tests contain only synthetic token strings and no credential material.

The audit is aligned with the current [OpenAI remote MCP API reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal):
the application supplies the OAuth token in `authorization`, selects tools with
`allowed_tools`, supplies `server_url`, and explicitly sets the approval policy.

## Hardened relay preflight

One fresh Site Admin OAuth flow was completed using the hardened request
builder. No measured case was started.

Direct baseline:

- Hosted MCP `initialize`: HTTP 200.
- Hosted MCP `tools/list`: HTTP 200.
- Approved tools were present.
- Underlying VDS metadata and bounded setup queries succeeded.

OpenAI relay preflight:

- HTTP status: 200.
- `mcp_list_tools`: present.
- Approved tools: visible through the restricted request configuration.
- MCP interaction: `mcp_call` present.
- Response request ID: `req_b119c2dc8e924753ba62faf29b772d04`.
- Token age at relay: approximately 11 seconds.
- Usage: 6,536 input tokens, 64 output tokens, 6,600 total.
- Approximate cost: `$0.001384`.
- Measured cases: 0.

Classification: **HARDENED_RELAY_PREFLIGHT = PASS**. This confirms that one
fresh Site Admin token and the normalized request builder can complete the
OpenAI remote MCP relay. It does not prove that the previous HTTP 424 was caused
by the builder change; transient or service-side causes remain possible.

### Diagnostic logging correction

The preflight also exposed a pre-existing defect: the relay diagnostic logger
serialized the live MCP configuration including its `authorization` value.
The value was not committed, but it appeared in the process output. The logger
was corrected immediately to use a redacted configuration object, and a
deterministic test now asserts that a synthetic authorization value cannot
appear in logged configuration. No token value is retained in repository
artifacts.

Because the token was emitted to the session output, human review should decide
whether the temporary Site Admin token must be revoked or otherwise invalidated
before any further use. No additional live retry was performed.

## Final measured batch after token abandonment

The previously exposed Site Admin token was not reused. It was no longer
available to the process and is recorded as compromised/abandoned. A fresh
Site Admin OAuth flow was completed after the redaction test passed.

Preflight succeeded with the fresh token:

- Direct Hosted MCP `initialize`: HTTP 200.
- Direct Hosted MCP `tools/list`: HTTP 200.
- Approved tools, metadata, and minimal aggregated query checks: successful.
- OpenAI MCP checks: all three successful.

The final four-case batch then ran once per case. No automatic retry occurred.

| Case | Execution | MCP calls | Final answer | Structured outcome | Result |
| --- | --- | ---: | --- | --- | --- |
| `incomplete-first-result` | reached | 2 | empty | unavailable | inconclusive |
| `empty-result-recovery` | reached | 1 | empty | unavailable | inconclusive |
| `hypothesis-disproved` | reached | 1 | empty | unavailable | inconclusive |
| `insufficient-evidence` | reached | 2 | empty | unavailable | inconclusive |

There was no HTTP connector failure during this batch. However, the provider did
not return a final answer or structured outcome in any case. The tool traces did
not establish the required behaviors: no confirmed workbook follow-up, no
confirmed empty-result recovery, no hypothesis state, and no
insufficient-evidence classification. The cases therefore remain evidence of
an instrumentation/provider-output limitation, not successful agentic
behavior. The agentic feasibility classification is **INCONCLUSIVE**.

Known OpenAI usage for this continuation:

- Three preflight checks: approximately `$0.00833454`.
- Four measured cases: approximately `$0.00521552`.
- Total known continuation cost: approximately `$0.01355006`.
- No model fallback was used; all calls used `gpt-5.6-luna`.

Security status:

- Old exposed token: not reused; abandoned.
- Fresh token: used for this continuation only.
- Logger redaction test: passed before live calls.
- Raw token exposure during this continuation: none observed.
- Model-visible tools: the approved three read-only tools only.
- Write calls, site-setting changes, permission changes, and datasource
  expansion: none.

The dedicated Viewer least-privilege path remains unresolved and is not changed
by the temporary Site Admin feasibility run.

## Final-output diagnosis

No new live request was made for this diagnosis. The four historical Measured
logs retained tool summaries and usage, but did not retain the response envelope
fields needed to determine `response.status`, `incomplete_details`, output item
statuses, or message presence. Therefore the historical status cannot be
recovered without another live request.

### Historical evidence

All four Measured cases used `max_output_tokens: 256` and reported exactly
`output_tokens: 256`, while `finalAnswer` and structured `outcome` were empty.
The logs did not retain reasoning-token detail. This makes output-budget
exhaustion the leading explanation, but does not prove that the responses were
`status: incomplete` or that `incomplete_details.reason` was
`max_output_tokens`.

| Case | Historical status | Incomplete reason | Output tokens | Final message | Assessment |
| --- | --- | --- | ---: | --- | --- |
| `incomplete-first-result` | unavailable | unavailable | 256 | unavailable | budget exhaustion likely |
| `empty-result-recovery` | unavailable | unavailable | 256 | unavailable | budget exhaustion likely |
| `hypothesis-disproved` | unavailable | unavailable | 256 | unavailable | budget exhaustion likely |
| `insufficient-evidence` | unavailable | unavailable | 256 | unavailable | budget exhaustion likely |

### Configuration audit

- `max_output_tokens`: 256 for measured requests, identical across cases.
- `tool_choice`: omitted, therefore not forced; no `required` or forced MCP
  tool setting was found.
- `max_tool_calls`: omitted; no application-side tool-call ceiling was found
  in the Responses request.
- `reasoning`: omitted explicitly.
- `text.format`: omitted. The structured outcome was requested in the prompt,
  but no Responses structured-output JSON schema was configured.
- `previous_response_id`: not used.
- Parser: handles top-level `output_text`, `message` items, nested
  `content[].type=output_text`, and multiple output items. No parser defect was
  demonstrated by the available evidence.

The absence of a structured-output schema is an independent reliability issue:
the requested JSON contract was prompt-dependent and not API-enforced. It can
explain missing structured outcomes, but it does not by itself explain an empty
final answer.

### Classification

`OUTPUT_BUDGET_EXHAUSTION_LIKELY` — **MEDIUM confidence**, with a secondary
`STRUCTURED_OUTPUT_CONFIG_BUG` concern. A completed response containing a
message would be needed to classify a parser bug; a stored `incomplete_details`
value would be needed to raise budget exhaustion to high confidence.

### Instrumentation improvement

The harness now records secret-free response-envelope telemetry for future
opt-in runs: status, incomplete reason, response error presence, output limit,
output item types/statuses, message/output-text presence, and reasoning-token
count. Deterministic fixtures cover completed message output, incomplete
max-token output, MCP-only output, nested text extraction, and missing final
messages. These additions do not re-run or reinterpret the historical cases.

The current OpenAI Responses API documents `status`, `incomplete_details`,
`max_output_tokens` as including reasoning and visible output, output item
statuses, `output_text` as an SDK convenience property, and reasoning-token
accounting. It also documents `tool_choice` default behavior and
`max_tool_calls` separately. See the [Responses API reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal).

## 1024-token structured-output rerun preflight

The approved configuration change was implemented and validated before live
execution:

- Previous `max_output_tokens`: 256.
- New `max_output_tokens`: 1024.
- Structured output: strict JSON Schema matching the Issue #16 outcome
  contract.
- Completion telemetry: enabled.
- Fresh Site Admin OAuth: used; previous token was not reused.

Direct Hosted MCP preflight succeeded, including initialize, tools/list, target
metadata, and bounded query/setup checks. The OpenAI preflight then behaved as
follows:

1. The `list-datasources` request completed successfully:
   - response status: `completed`
   - incomplete reason: none
   - output types: `mcp_list_tools`, `reasoning`, `mcp_call`, `message`
   - message/output text: present
   - output tokens: 203 of 1024
   - reasoning tokens: 99
   - approximate cost: `$0.00725660`
2. The next metadata preflight request failed with HTTP 424
   `external_connector_error` / `http_error` while retrieving the Hosted MCP
   tool list.

Classification: **OPENAI_RELAY_PREFLIGHT_FAILED**. The final 4-case batch was
not started and no measured rerun slot was consumed.

This single completed preflight response is evidence that the 1024-token limit
can produce a final message and structured-response-compatible completion in at
least one request. It does not establish that the previous 256-token ceiling
was the sole cause of the historical four-case failures, because the new
measured batch could not begin. No retry was performed.

## Escalation preparation: Hosted MCP authentication

This section is a sanitized reproduction package. It contains no real CIMD
URL, token, authorization code, site, user, datasource, request ID, or secret.
No new OAuth, MCP, or OpenAI request was made while preparing it.

### Minimal reproduction

1. Publish a non-secret CIMD document at an HTTPS URL and use that URL as
   `client_id`.
2. Use an authorization-code flow with PKCE S256 and a loopback redirect URI.
3. Send `resource=https://mcp.tableau.com` in the authorization request.
4. Complete Tableau Cloud authorization as a user allowed to access the
   target site.
5. Exchange the code at `https://sso.online.tableau.com/oauth2/token`, sending
   the same resource value and the PKCE verifier.
6. Observe successful Bearer/JWT-like token issuance and record only sanitized
   metadata.
7. Send the Bearer token to the Hosted MCP `initialize` endpoint.
8. Observe HTTP 401 `invalid_token`.

### Sanitized CIMD example

```json
{
  "client_id": "https://example.invalid/cimd.json",
  "redirect_uris": ["http://127.0.0.1:PORT/oauth/callback"],
  "client_name": "Hosted Tableau MCP OAuth reproduction",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

The placeholder document follows the fields used by the spike harness; the
actual ephemeral URL and port must be supplied only by the person reproducing
the issue.

### Sanitized authorization request

```text
GET https://sso.online.tableau.com/oauth2/authorize

client_id=<CIMD URL>
redirect_uri=http://127.0.0.1:<PORT>/oauth/callback
response_type=code
code_challenge=<redacted>
code_challenge_method=S256
resource=https://mcp.tableau.com
scope=<Hosted MCP scope summary>
state=<redacted>
```

### Sanitized token request

```text
POST https://sso.online.tableau.com/oauth2/token

grant_type=authorization_code
client_id=<CIMD URL>
redirect_uri=http://127.0.0.1:<PORT>/oauth/callback
code=<redacted>
code_verifier=<redacted>
resource=https://mcp.tableau.com
```

### Sanitized token metadata and MCP response

```json
{
  "token_type": "Bearer",
  "expires_in": 3599,
  "iss": "https://sso.online.tableau.com",
  "aud": "<CIMD URL>",
  "scope": "<sanitized Hosted MCP scope summary>"
}
```

The observed token's `iat`/`nbf`/`exp` relationship appeared valid. The token
itself was never retained in this package.

```text
POST https://mcp.tableau.com
Authorization: Bearer <redacted>
Content-Type: application/json

<JSON-RPC initialize body with protocolVersion and clientInfo; no secret>
```

Observed response:

```text
HTTP 401
error: invalid_token
WWW-Authenticate: not observed
MCP session: not established
```

### Previous successful behavior

An earlier run with the same broad architecture reached Hosted MCP initialize
with HTTP 200 and completed `tools/list`. The successful token's audience was
not retained, so `previous successful token audience: UNKNOWN`. This is not
evidence of permanent incompatibility; it shows that authentication behavior
has not been reproducible.

### Checks already completed

- Token issuance succeeded.
- `resource=https://mcp.tableau.com` was sent in both authorization and token
  requests.
- The same fresh token remained invalid after several seconds.
- Access and refresh tokens were not confused.
- Token truncation and Bearer formatting were checked.
- The CIMD endpoint remained reachable.
- The dedicated Viewer was explicitly logged into the target Tableau site.
- Requested scopes were unchanged.

### Upstream overlap check

| Reference | Relevance | New issue still needed |
| --- | --- | --- |
| [tableau-mcp#772](https://github.com/tableau/tableau-mcp/issues/772) | Hosted metadata, CIMD support, and no DCR endpoint; does not resolve audience validation | Yes, unless maintainers direct this report there |
| [tableau-mcp#718](https://github.com/tableau/tableau-mcp/issues/718) | Hosted service failure after successful OAuth; different HTTP 502 symptom | Yes |
| [tableau-mcp#225](https://github.com/tableau/tableau-mcp/issues/225) | Site-scoped OAuth/session behavior; not this invalid-token symptom | Yes |

The repository's public issue list also indicates that Hosted MCP OAuth and
site/session behavior are active topics, but no matching resolved issue was
found for `aud=<CIMD URL>` followed by Hosted MCP 401 `invalid_token`.

### Recommended escalation channel

**Tableau/Salesforce support** is recommended first. The failure is in a
managed Hosted service and may require private tenant/site routing or request
correlation data that should not be published. A sanitized upstream GitHub
issue can be considered if Tableau directs the report there or confirms that
the public repository is the correct channel.

### Public GitHub issue draft

**Title:** Hosted Tableau MCP rejects a CIMD OAuth token with `invalid_token`
when the requested resource is `https://mcp.tableau.com`

```markdown
## Environment

- Hosted Tableau MCP: https://mcp.tableau.com
- Authorization server: https://sso.online.tableau.com
- OAuth client: HTTPS CIMD document used as client_id
- Client flow: authorization code + PKCE S256

## Summary

The authorization and token requests both include
`resource=https://mcp.tableau.com`. Token issuance succeeds, but Hosted MCP
rejects the resulting Bearer token during `initialize` with HTTP 401
`invalid_token`.

## Expected behavior

The access token issued for the Hosted MCP resource should be accepted by
`https://mcp.tableau.com`.

## Actual behavior

Token issuance succeeds. Sanitized metadata shows issuer
`https://sso.online.tableau.com` and audience `<CIMD URL>`. Hosted MCP
`initialize` returns HTTP 401 `invalid_token`. No `WWW-Authenticate` value was
observed.

## OAuth configuration

- Authorization request resource: `https://mcp.tableau.com`
- Token request resource: `https://mcp.tableau.com`
- Client authentication: `none`, via CIMD
- Redirect: loopback URI
- PKCE: S256

## Reproduction steps

1. Publish a non-secret CIMD document over HTTPS.
2. Use its URL as `client_id`.
3. Complete authorization-code + PKCE authorization.
4. Send the resource indicator in both authorization and token requests.
5. Confirm successful token issuance.
6. Send the Bearer token to Hosted MCP `initialize`.
7. Observe HTTP 401 `invalid_token`.

## What we already checked

- Same fresh token remained invalid after several seconds.
- Access/refresh token selection, truncation, and Bearer formatting were checked.
- CIMD remained reachable.
- A dedicated Viewer was logged into the intended Tableau site.

## Previous successful behavior

An earlier run reached initialize HTTP 200 and completed `tools/list`, but the
previous token audience was not retained.

## Questions

1. Is `aud=<CIMD client URL>` expected when both requests use
   `resource=https://mcp.tableau.com`?
2. What audience value or mapping does Hosted MCP validate?
3. Does Hosted MCP use the public self-hosted resource-based audience
   validation semantics?
4. Are there known Hosted MCP/CIMD token-validation issues?
5. Is additional site-binding/resource information required for CIMD clients?
```

### Tableau/Salesforce support draft

```markdown
## Managed Hosted Tableau MCP OAuth validation failure

Environment:
- Hosted endpoint: https://mcp.tableau.com
- Authorization server: https://sso.online.tableau.com
- Tenant/site: <redacted; provide privately to support>
- User/identity: <dedicated test identity; provide privately>
- Timestamp UTC: <insert>
- Request/correlation ID: <insert if available>

Observed:
- CIMD URL used as client_id.
- `resource=https://mcp.tableau.com` sent in authorization and token requests.
- Token issuance succeeded, approximately one-hour lifetime.
- Sanitized issuer: `https://sso.online.tableau.com`.
- Sanitized audience: `<CIMD URL>`.
- Hosted MCP initialize returned HTTP 401 `invalid_token`.
- `WWW-Authenticate`: not observed.

Questions:
1. Is the observed audience expected for this resource/client combination?
2. Which audience mapping does the Hosted MCP validator require?
3. Are there known Hosted MCP/CIMD validation regressions or routing issues?
4. Is any additional private site-binding information required?

No token, authorization code, cookie, Authorization header, or secret is
included. Private tenant and correlation details can be supplied through the
support channel only.
```

### Issue #17 status recommendation

`BLOCKED_EXTERNAL` is recommended for the Hosted MCP portion of the spike:
the managed authentication path is not reproducible and public information is
insufficient to explain the 401. The agentic evaluation remains unevaluated;
Issue #17 must remain open and must not use `Closes #17` until that dependency
and the four measured cases are resolved.

## Hosted MCP reliability investigation closure

This section records the bounded reliability investigation requested after the
Site Admin feasibility path became available. It is a closure of the Hosted
transport investigation, not a claim that the intermittent 424 root cause was
fixed and not an agentic-behavior evaluation.

### Official documentation findings

- The Hosted Tableau MCP documentation describes `https://mcp.tableau.com` as
  the managed endpoint and documents OAuth, permissions, and tool entitlements,
  but no public Hosted-specific rate, concurrency, initialize, `tools/list`,
  or session-churn limit was found. This is **not** evidence that no internal
  limit exists. See [Hosted Tableau MCP](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp).
- Tableau documents VizQL Data Service capacity as 100 API calls per Creator
  license per hour per tenant for the applicable Cloud license models, with
  capacity managed dynamically and requests potentially rejected when capacity
  is exceeded. See [Tableau Cloud capacity](https://help.tableau.com/current/online/en-us/to_site_capacity.htm)
  and [VDS limitations](https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_limitations.html).
- Tableau Cloud Manager can expose capacity consumption, concurrency, and
  rate-limit usage, but that private tenant view was not available through the
  existing harness. See [Cloud Manager capacity](https://help.tableau.com/current/online/en-gb/cloud_manager_capacity.htm).
- No public document was found that maps the observed Hosted MCP 424 from the
  OpenAI connector to a specific Tableau-side HTTP status. The underlying
  Tableau status therefore remains unknown.

### Cloudflare assessment

The Quick Tunnel exposed the ephemeral CIMD document only. MCP traffic used
`https://mcp.tableau.com` directly; it did not traverse the tunnel. OAuth
issuance succeeded and direct Hosted MCP succeeded with the same fresh token.
Accordingly, `CLOUDFLARE_PRIMARY_CAUSE_LIKELIHOOD=LOW`. A tunnel outage is not
supported by the observed path, although this experiment does not prove that
the authorization server never refetched CIMD metadata.

### Controlled timing experiment

One fresh temporary Site Admin OAuth token was used. No agentic case was run.
Each direct pair created two independent MCP sessions. Each remote pair used
two independent Responses API requests with the same hardened configuration;
424s were recorded without per-request retry. Requested and observed gaps:

| Trial | Requested gap | Actual gap | Direct A | Direct B | Remote A | Remote B |
| --- | ---: | ---: | --- | --- | --- | --- |
| D0/R0 | 0s | D: 2.04s; R: 8.75s | initialize/tools 200 | initialize/tools 200 | completed; list+call+message | completed; list+call+message |
| D5/R5 | 5s | D: 6.80s; R: 12.03s | initialize/tools 200 | initialize/tools 200 | completed; list+call+message | completed; list+call+message |
| D15/R15 | 15s | D: 16.70s; R: 21.63s | initialize/tools 200 | initialize/tools 200 | completed; list+call+message | completed; list+call+message |

Direct telemetry had no transport or tool-list error. All six remote requests
were completed, contained `mcp_list_tools`, a successful approved-tool
`mcp_call`, and a final `message`. No 424 occurred in this bounded matrix.
Remote approximate costs were `$0.00615570`, `$0.00611538`, `$0.00613098`,
`$0.00606098`, `$0.00611718`, and `$0.00605038`, for a timing-experiment
total of approximately **$0.03663060**. No fallback model or extra retry was
used.

### Assessment

- `SHORT_INTERVAL_SENSITIVITY_NOT_SUPPORTED` in this sample: both requests
  succeeded at every tested gap. Because each gap has only one pair, this does
  not establish a rate-limit threshold or prove that the historical 424 cannot
  correlate with a different load or session state.
- `SLEEP_MITIGATION=INCONCLUSIVE`: no delay was needed in this matrix, so a
  fixed sleep is not justified as a mitigation. No retry or backoff was added.
- `TABLEAU_CAPACITY_HYPOTHESIS=UNLIKELY` for the tested run: the bounded
  experiment used only 12 remote requests plus 12 direct initialize/tools
  sessions, far below the documented hourly VDS baseline if a Creator license
  was available. Exact tenant utilization and license count were not observed,
  so private capacity pressure and short-term throttling are not fully ruled
  out.
- `PUBLIC_HOSTED_MCP_LIMITS=PARTIALLY_DOCUMENTED`: VDS hourly capacity is
  public, while Hosted MCP session/concurrency limits were not found publicly.
- `OPENAI_REMOTE_MCP_RELIABILITY=SUPPORTED_WITH_CAVEATS`: the current matrix
  was fully successful, but historical 424s remain valid evidence and prevent
  an unconditional reliability claim.
- `HOSTED_PATH=VIABLE_WITH_CAVEATS`: direct Hosted MCP was stable in this
  sample and Remote MCP completed all six requests, but the intermittent 424,
  unresolved Viewer authentication, and undocumented Hosted limits remain
  material caveats.

### Direct versus Remote interpretation

The direct and remote paths were both stable at 0/5/15-second requested gaps.
This bounded result weakens a simple short-interval/session-churn explanation
and does not support attributing the earlier 424 to Cloudflare or documented VDS
hourly exhaustion. It does not identify the earlier connector failure's cause;
the OpenAI-side 424 did not expose the underlying Tableau status.

### Remaining unresolved topics

- Viewer least-privilege Hosted MCP authentication remains blocked/unresolved;
  Site Admin success does not resolve it.
- Hosted MCP-specific session/concurrency limits are not publicly documented.
- Historical intermittent OpenAI Remote MCP 424 failures remain unexplained.
- Production authentication and any retry/readiness policy require a separate
  decision. A bounded readiness retry is a possible follow-up, not an accepted
  implementation.

The next architecture comparison may consider local stdio Tableau MCP with an
application-managed tool loop if Hosted reliability is not acceptable, but no
stdio implementation was started here. No GitHub issue was created. Suggested
follow-ups are: investigate least-privilege Hosted MCP/CIMD authentication,
escalate the sanitized 424 reproduction to Tableau/Salesforce support, and
review OpenAI Remote MCP connector reliability with request IDs.

### Closure decision

The Hosted investigation is **complete enough for this bounded spike**: the
public-limit, capacity, Cloudflare, direct-vs-remote, and timing questions were
checked without an agentic rerun. It is not a root-cause resolution. Agentic
capability remains **INCONCLUSIVE** because no final four-case batch was run in
this investigation; the existing historical cases remain unchanged.

## Final batch gate correction

The finalization attempt used one fresh Site Admin OAuth flow. Direct Hosted
MCP preflight succeeded (VDS metadata/setup validation 200, initialize 200,
`tools/list` 200, and the approved tools were visible). The single OpenAI
minimal preflight also returned a completed response with `mcp_list_tools`,
successful metadata/query MCP calls, and a final message.

The batch was not started because the newly added local gate incorrectly
required all three approved tool names to appear in that one minimal request.
The request contract only requires tool-list retrieval plus a successful minimal
MCP interaction; the model selected metadata and query directly, which met the
live preflight evidence. The gate was corrected to require a successful MCP
call, tool-list output, and a completed final message. Validation passed after
the correction. The fresh token was not reused after the process ended, and no
additional OAuth or paid retry was performed. A human decision is required
before starting another fresh OAuth flow for the four-case batch.

## Finalization preflight after gate correction

A fresh Site Admin OAuth flow was authorized after the local gate correction.
Direct checks and fixed setup validation passed:

- VDS metadata: HTTP 200
- fixed four-case setup: valid
- Hosted MCP initialize: HTTP 200
- Hosted MCP `tools/list`: HTTP 200; approved tools visible

The corrected OpenAI minimal-preflight gate was then exercised. The request
was not rejected by the local gate; the OpenAI Remote MCP connector returned:

```text
HTTP 424
error.type = external_connector_error
error.code = http_error
error.param = tools
message = Error retrieving tool list from MCP server: 'tableau-hosted'
```

No measured case was started and no retry was performed. The final four-case
slots remain unconsumed. This is a real preflight/connector failure, distinct
from the corrected local gate bug. The Hosted conclusion remains
`VIABLE_WITH_CAVEATS`; final agentic evaluation remains `INCONCLUSIVE` and
requires a separate human decision before another live attempt.

## Local stdio path investigation

The Hosted Remote MCP path is not being reopened. A separate local-stdio path
was inspected to isolate Remote MCP connector reliability from agentic
behavior.

### Official implementation and startup

The official Tableau MCP implementation documents the following stdio command:

```text
npx -y @tableau/mcp-server@latest
```

For Tableau Cloud, the documented configuration requires the Tableau pod URL
(`SERVER`), the site content URL (`SITE_NAME`), and an authentication method.
The documented prototype path is PAT authentication using `AUTH=pat`,
`PAT_NAME`, and `PAT_VALUE`; the official docs warn that PATs are not suitable
for concurrent clients. Local OAuth configuration is documented for the MCP
server, but the current official configuration rejects OAuth-enabled stdio and
requires HTTP for that mode. Sources: [Tableau MCP getting started](https://tableau.github.io/tableau-mcp/docs/getting-started),
[environment variables](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/env-vars),
and [OAuth configuration](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/authentication/oauth).

### Smoke status

The local package was resolved from the official npm package and invoked once
without credentials. It stopped before connecting because `SERVER` was not
configured. No Tableau API call, OpenAI call, OAuth flow, or credential
substitution was performed.

```text
STDIO_MCP_SMOKE = FAIL
failure class = AUTH / PROCESS_START
reason = required local Tableau MCP configuration and credential are absent
```

The repository has no safe, preconfigured stdio PAT or local OAuth credential
available for this spike. The Hosted Site Admin OAuth token is not silently
reused as a local stdio credential. The stdio tool loop and four-case run were
therefore not started; no hidden application-side orchestration was added.

### Human action required

To continue the stdio branch, a human must provide a dedicated, read-only
technical-spike credential and site configuration through a secure local
mechanism, not committed files or logs:

```text
SERVER=https://<target-tableau-cloud-pod>
SITE_NAME=<target-site-content-url>
AUTH=pat
PAT_NAME=<dedicated-read-only-spike-pat-name>
PAT_VALUE=<secret supplied outside the repository>
TRANSPORT=stdio
```

The human should confirm that the credential is limited to the approved site
and datasource and has no write use. After that setup is confirmed, a bounded
stdio smoke test (initialize, tools/list, metadata, one aggregate query, and a
single OpenAI function-call bridge) can be authorized. Without it, an agentic
classification would measure missing authentication rather than LLM behavior.

### Current stdio decision

`AUTH_BLOCKED` / `HUMAN_ACTION_REQUIRED`. The four stdio cases are unconsumed.
Hosted findings remain historical evidence: `HOSTED_REMOTE_PATH =
VIABLE_WITH_CAVEATS`, with unresolved intermittent 424s and Viewer
least-privilege authentication as follow-up topics.

## Application-managed stdio bridge smoke

Phase B added a thin application-managed bridge using the official
`@modelcontextprotocol/sdk` stdio client. The bridge exposes only three OpenAI
function tools, maps them explicitly to the approved Tableau MCP tools,
rejects unknown tools and non-target datasource LUIDs, enforces a 1--100 row
limit and aggregation-first query shape, and returns bounded MCP results as
`function_call_output`. It does not choose follow-up queries or interpret
evidence.

Deterministic tests cover tool mapping, disallowed tools, datasource rejection,
aggregation and row limits, function-output conversion, the four-call loop
guard, and synthetic secret redaction. `npm run validate` passed with 73 tests.

The one authorized live smoke was **not completed**:

1. OpenAI returned a completed `function_call` for `list_datasources`; the
   stdio MCP call succeeded with 15 rows.
2. OpenAI returned a completed `function_call` for
   `get_datasource_metadata`; the stdio MCP call succeeded for the approved
   datasource.
3. OpenAI returned a query tool call whose `query` object did not contain an
   aggregation field. The bridge rejected it fail-closed before MCP execution
   with `Query must declare at least one aggregation field.`

No final OpenAI message was produced, no `query-datasource` call was made, and
no retry was performed. Classification:

```text
APP_MANAGED_STDIO_SMOKE = FAIL
failure category = DATASOURCE_POLICY_FAILED / TOOL_SCHEMA_CONTRACT_MISMATCH
READY_FOR_AGENTIC_4_CASE_BATCH = no
```

This result demonstrates that the transport bridge, Keychain isolation, MCP
process, initialization, tool discovery, and two approved tool calls work,
but the OpenAI function schema/prompt and the local aggregation validator do
not yet agree on the query argument shape. It is not evidence of agentic case
failure. The four cases remain unconsumed and require a human-approved fix and
one new smoke run before any agentic batch.

### Query contract diagnosis and fix

The official `tools/list` response from `@tableau/mcp-server@latest` was
inspected before changing the live path. The relevant `query-datasource`
contract is:

```text
datasourceLuid: string (required)
query: object (required)
  fields: non-empty array (required)
    fieldCaption: string (required)
    optional function: Tableau field-function enum
    or calculation: string
    or binSize: positive number
  optional filters and parameters
optional limit: integer >= 1
```

Aggregation is represented by a field object such as
`{"fieldCaption":"Daily View Count","function":"SUM"}`; it is not a
top-level `aggregation` property. The previous OpenAI schema exposed `query`
as an unconstrained object, while the validator expected an aggregation field
without publishing the actual `fields` union to the model. The previous raw
arguments were not retained; the safe observed shape was a query without a
recognized aggregation field. This was classified as a local
`TOOL_SCHEMA_CONTRACT_MISMATCH`, not as an MCP transport or authentication
failure.

The contract fix publishes the relevant MCP field union to OpenAI, validates
that same field shape, preserves the explicit snake_case-to-kebab-case mapping,
and forwards valid payloads unchanged. The bridge still requires an explicit
`limit` from the model and bounds it to 100 as an application safety policy,
although the MCP schema itself makes `limit` optional. It does not rewrite
fields, filters, grouping, or semantic intent. Query telemetry records only
argument shape (keys, field kinds, aggregation presence, and limit), never raw
field values or credentials.

Deterministic coverage now includes a valid MCP aggregate field, a
dimension-plus-aggregate query, the prior missing-aggregation shape, malformed
fields, an out-of-range limit, fixed-datasource rejection, tool allowlisting,
and non-secret argument-shape telemetry. Validation passed with 73 tests and
the secret scan reported no leaks.

The authorized contract-corrected Phase B smoke then passed once:

1. OpenAI returned `list_datasources`; the stdio call returned 15 rows.
2. OpenAI returned `get_datasource_metadata` for the fixed datasource; the
   stdio call succeeded.
3. OpenAI returned `query_datasource` with a valid MCP-shaped field,
   `function: "SUM"`, and `limit: 1`; the Tableau MCP call returned one
   non-empty aggregate row.
4. The continuation returned `status: completed` with a final message.

Telemetry for the four Responses calls was 31,590 input tokens (20,032 cached),
244 output tokens, and 0 reasoning tokens in the final response; the recorded
approximate cost was `$0.00300504`. No raw arguments, field values, PAT, or API
key were logged. Classification:

```text
APP_MANAGED_STDIO_SMOKE = PASS
READY_FOR_AGENTIC_4_CASE_BATCH = yes
```

This smoke validates the end-to-end bridge and contract alignment only. The
four agentic cases remain unconsumed and require a separate human decision.

## Phase C: final stdio agentic cases

The approved Phase C batch used the local PAT-authenticated stdio path, the
existing three-tool allowlist, `gpt-5.6-luna`, `max_output_tokens: 1024`, strict
structured output, and the existing four-tool-call guard. Each case was run
once in an isolated MCP process. No Hosted Remote MCP fallback, fixed sleep, or
case retry was used.

| Case | OpenAI calls | MCP calls | Observed behavior | Structured outcome | Result |
| --- | ---: | ---: | --- | --- | --- |
| `incomplete-first-result` | 5 | 4 | Obtained aggregate evidence, then a workbook-level follow-up; guard was reached before final response | absent | INCONCLUSIVE |
| `empty-result-recovery` | 5 | 4 | Model issued future-date/filter queries, but the Tableau tool returned errors rather than the contract's expected 0-row result; guard was reached | absent | INCONCLUSIVE / setup-tool failure |
| `hypothesis-disproved` | 5 | 4 | Obtained a workbook ranking after one failed query; final state was `rejected` | present | PARTIAL: hypothesis revised, reported top workbook did not match the validated ground truth |
| `insufficient-evidence` | 5 | 4 | Gathered metadata and metric queries, including tool errors; guard was reached before final response | absent | INCONCLUSIVE |

All recorded Responses completed at the API level; no OpenAI transport or PAT
authentication failure occurred. The incomplete final outcomes were caused by
the existing four-tool guard and/or Tableau tool errors, not by a missing
stdio connection. The empty-result case did not satisfy its setup contract
because the first query produced an MCP tool error instead of a successful
zero-row result. The hypothesis case correctly rejected the initial workbook
hypothesis, but its reported top-ranked workbook differed from the previously
validated ground truth, so it is not a full correctness pass.

The batch recorded approximately `$0.02229722` in OpenAI usage across the four
cases. Raw credentials and raw tool results were not logged. The final
classification is **AGENTIC_FEASIBILITY = INCONCLUSIVE**: follow-up tool
selection was observable, but the fixed batch did not provide four completed
case outcomes suitable for a definitive capability claim. The local
stdio/application-managed path remains technically usable with caveats; this
batch does not justify marking the agentic architecture principle as fully
supported.

Remaining follow-ups are bounded and separate from the historical Hosted
investigation: validate the Tableau filter argument contract for the empty
result setup, decide whether the four-call guard is sufficient for the fixed
case contracts, and obtain human direction before any further live case run.

## Phase C second-batch setup review

The first Phase C batch showed that four tool calls were too small for the
normal discovery/metadata/initial-query/follow-up path. The guard was therefore
changed from 4 to 6. This remains only a runaway-protection limit; it does not
select queries, recover empty results, or force an outcome. Deterministic tests
cover the six-call boundary and the N+1 rejection without an off-by-one error.

The empty-result fixture was corrected against the actual Tableau MCP filter
shape:

```text
filters: [
  {
    field: { fieldCaption: "Metric Date Time (JST)" },
    filterType: "QUANTITATIVE_DATE",
    quantitativeFilterType: "MIN",
    minDate: "2099-01-01"
  }
]
```

The direct setup check confirmed `EMPTY_CASE_SETUP = VALID`: the MCP call
succeeded and returned zero rows. No application-side recovery was added.

The ranking contract was also made explicit: group by `Workbook Title`,
aggregate `SUM(Daily View Count)`, sort the aggregate descending with a unique
`sortPriority`, and use a bounded limit. The direct setup check then returned
`What's Hokuriku? | #VOTD` as rank 1. This differs from the historical recorded
ground truth `#MoM 2024 Week 34 | SNS Popularity in the U.S.`. It is therefore
classified as **GROUND_TRUTH_CHANGED**, not as a model result and not as a
permission to rewrite the expectation. The second Phase C measured batch was
not started, and human direction is required before changing the case contract.

## Hypothesis fixture stabilization

The historical `hypothesis-disproved` result was not accepted as a stable
ground truth. Repository history contains the historical rank-1 workbook and a
general `Workbook Title` plus `SUM(Daily View Count)` ranking description, but
does not contain the original date scope, filter set, visibility/status filter,
null-handling rule, or timezone cutoff used to produce that value. The prior
Phase C comparison was therefore **INVALIDATED_BY_GROUND_TRUTH_DRIFT**, rather
than being treated as a confirmed model evidence-interpretation failure.

The current datasource coverage was checked with a bounded aggregate query:

```text
MIN(Metric Date Time (JST)) = 2025-03-30T23:05:23
MAX(Metric Date Time (JST)) = 2026-10-05T00:00:23.7941
```

The recommended fixed fixture is the closed historical window
`2025-04-01 <= Metric Date Time (JST) < 2026-10-01`. It is past relative to
the current run, aligned with the datasource's observed coverage and the
existing spike timing, and cannot change when later daily rows are appended.
The deterministic ranking contract is:

```text
measure: SUM(Daily View Count)
grouping: Workbook Title
ordering: SUM(Daily View Count) DESC
sortPriority: unique, aggregate field priority 1
limit: 100
additional filters: the fixed date range only
timezone: Metric Date Time (JST)
```

The direct MCP query returned:

```text
rank 1: #MoM 2024 Week 34 | SNS Popularity in the U.S.
metric: 17716
```

The initial hypothesis workbook is not rank 1 in this window, so it remains a
plausible false hypothesis for the case. The current all-data rank 1,
`What's Hokuriku? | #VOTD`, is recorded separately and is not used as the
fixture truth.

Classification:

```text
HISTORICAL_GROUND_TRUTH = UNREPRODUCIBLE  # exact original conditions absent
HYPOTHESIS_FIXTURE = VALID                 # new fixed window verified
```

The fixture is encoded in `src/spike/measured-case-setup.ts`, the measured
prompt names only the fixed window and contract (not the expected rank 1), and
the direct setup checker validates the empty-result fixture plus this ranking
fixture before any measured run. The second Phase C batch remains unexecuted
until a human confirms this fixture.

## Second Phase C / corrected evaluation batch

The human-approved corrected batch used the local PAT-authenticated stdio path
only. The Hosted Remote MCP path was not retried. Before the batch, the two
setup checks passed:

```text
tool-call guard: 6
EMPTY_CASE_SETUP: VALID
HYPOTHESIS_FIXTURE: VALID
```

The guard was increased from 4 to 6 because the first Phase C run consumed the
initial metadata/discovery calls before it could complete a meaningful
follow-up exploration. The guard is a bounded runaway-protection limit, not an
application workflow and does not force a conclusion.

Each case ran once with `gpt-5.6-luna`, `max_output_tokens=1024`, strict
structured output, and the existing non-orchestrating application bridge.
Transport, completion, tool, token, latency, and cost telemetry were
captured. The four responses completed and produced structured outcomes; no
case was retried.

| Case | Tool calls | Useful | Redundant/error | Guard reached | Structured outcome | Result | Cost (USD) |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: |
| `incomplete-first-result` | 6 | 3 | 3 | yes/at boundary | `insufficient-evidence` | FAIL | 0.01179320 |
| `empty-result-recovery` | 4 | 3 | 1 | no | `supported` | PASS | 0.00612764 |
| `hypothesis-disproved` | 6 | 3 | 3 | yes/at boundary | `rejected` | PASS | 0.01361012 |
| `insufficient-evidence` | 5 | 3 | 1 | no | `insufficient-evidence` | PASS | 0.01108614 |

The batch used 25 OpenAI responses calls and 21 Tableau MCP tool calls. The
recorded batch estimate is **$0.04261710**. The historical total for Issue
#17 is not reconstructed beyond the costs recorded in the spike evidence;
this amount is therefore a known addition, not an invented historical total.

### `incomplete-first-result`

The model obtained a monthly aggregate, then selected a workbook-level
follow-up that was relevant to the missing contribution question. It did not
stop immediately or fabricate a workbook answer. However, it issued further
queries after the first breakdown (including an MCP error and repeated bounded
queries), reached the six-call guard boundary, and returned
`insufficient-evidence` because the capped workbook result did not reconcile
the trend. The follow-up-selection behavior was observable, but the case did
not meet the required supported-conclusion/evidence-completion contract.
This is agentic negative evidence, not a transport failure.

### `empty-result-recovery`

The deterministic fixture is valid: the future-date query is accepted and
returns zero rows. The model's first generated filter attempt produced an MCP
argument error, then it corrected the query, observed a valid empty result,
removed the date constraint, and obtained usable evidence. It completed with
`outcome=supported` and stopped with `sufficient-evidence`. This is a PASS
with a tool-schema/efficiency caveat; the application did not choose or apply
the recovery.

### `hypothesis-disproved`

The fixed window and ranking contract were used without revealing the fixture
answer in the prompt. After three failed ranking-filter attempts, the model
issued a successful ranking query and reported:

```text
rank 1: #MoM 2024 Week 34 | SNS Popularity in the U.S. (17,716)
hypothesized workbook: rank 12 (1,712)
hypothesis_state: rejected
```

The rank-1 interpretation matched the verified fixture, so this case is a
PASS. The repeated failed attempts are a material efficiency and schema-use
caveat. The first Phase C result is not comparable as a model correctness
result: it is retained as `INVALIDATED_BY_GROUND_TRUTH_DRIFT`.

### `insufficient-evidence`

The model inspected available Tableau metrics, identified that referrals,
promotion, campaign attribution, audience, and other external causal evidence
were absent, and returned `outcome=insufficient-evidence` without inventing a
cause. It completed before the guard and is a PASS. One malformed/extra query
was observed, but the model stopped at the correct evidence boundary.

### Batch comparison

| Case | First Phase C | Second Phase C | Interpretation |
| --- | --- | --- | --- |
| `incomplete-first-result` | INCONCLUSIVE at guard 4 | FAIL; relevant follow-up but guard-boundary looping and incomplete evidence | Guard 6 enabled more exploration, but not a supported conclusion |
| `empty-result-recovery` | SETUP_FAILURE / INCONCLUSIVE | PASS with one malformed first attempt, then valid empty recovery | Valid fixture made the behavior measurable |
| `hypothesis-disproved` | Invalidated by ground-truth drift | PASS against fixed fixture; inefficient ranking setup | Fixed historical window made correctness testable |
| `insufficient-evidence` | INCONCLUSIVE at guard 4 | PASS; missing external evidence identified and stop reached | Guard 6 allowed completion |

The corrected batch therefore provides meaningful evidence but does not show
uniform success. The resulting classification is:

```text
AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED
STDIO_APP_MANAGED_PATH = SUPPORTED_WITH_CAVEATS
```

Dimension-level assessment:

| Dimension | Assessment | Evidence |
| --- | --- | --- |
| Follow-up exploration | PARTIAL | Relevant follow-up selected, but repeated calls prevented a supported final conclusion |
| Empty-result recovery | SUPPORTED | Valid zero-row result was recognized and safely followed by a broader query |
| Hypothesis revision | SUPPORTED | Initial hypothesis rejected and fixed-fixture rank 1 reported correctly |
| Evidence interpretation | PARTIAL | Correct ranking and missing-cause boundaries were demonstrated, but query errors/redundancy remained |
| Insufficient-evidence handling | SUPPORTED | External causal evidence was explicitly identified as missing |
| Stop decision | SUPPORTED_WITH_CAVEATS | Two cases stopped appropriately; one consumed the guard after repeated exploration |
| Tool efficiency | PARTIAL | Useful exploration occurred, but 5 error/redundant calls were observed across cases |
| Final correctness | PARTIAL | Three cases met their outcome contracts; incomplete-first-result did not |

The evidence supports the architecture principle with caveats:

```text
探索のオーケストレーションはLLMへ寄せ、
完了条件と最小限のガードレールだけをアプリ側に残す。

ARCHITECTURE_PRINCIPLE = SUPPORTED_WITH_CAVEATS
```

The LLM should own next-tool selection, follow-up exploration, empty-result
interpretation, hypothesis testing/revision, evidence interpretation, and
the decision to stop. The application should own credential isolation, the
three-tool allowlist, datasource and read-only boundaries, result/row limits,
argument validation, the six-call runaway guard, completion/cost telemetry,
and a simple evidence verifier. The verifier may check that required evidence
arrived, that it is Tableau-backed, and that a reported ranking is internally
consistent; it must not choose the next query or implement case-specific
recovery.

The `Required Evidence / Optional Evidence / Open Questions` analysis
contract should be passed to the LLM as the analytical context. The
application verifier should only check evidence presence, provenance,
contract completeness, and obvious consistency. It should not become a
workflow engine.

### Issue #17 acceptance review

| Criterion | Result | Evidence |
| --- | --- | --- |
| Selected provider exercised against evaluation cases | PARTIAL | OpenAI was exercised through the client-managed stdio function/tool loop; provider-managed Hosted Remote MCP orchestration was not established as a reliable evaluation path |
| Continuation after incomplete evidence | PARTIAL | Relevant follow-up occurred; one case ended incomplete at guard boundary |
| Empty-result recovery | PASS | Valid zero-row fixture and model-selected recovery query |
| Hypothesis disproof | PASS | Fixed-window rank and rejected hypothesis matched fixture truth |
| Insufficient-evidence behavior | PASS | Missing external causal evidence identified without fabrication |
| Tool-call evidence recorded | PASS | Per-call tool mapping, intent, rows, errors, and latency recorded |
| Evidence completion recorded | PASS | Structured outcomes and evidence-complete fields captured |
| Latency recorded | PASS | Response and MCP timing telemetry captured |
| Tokens/cost recorded | PASS | Per-case usage and cost estimate captured |
| Failure modes recorded | PASS | Transport, MCP argument, guard, and agentic outcomes separated |
| Provider/application responsibility assessed | PASS | Thin bridge and LLM/application boundary documented |
| External-service safety maintained | PASS | PAT isolation, read-only tools, datasource boundary, and no writes |
| Proposed architecture recommendation documented | PASS | Local stdio path and Hosted caveats consolidated |
| Anthropic/Bedrock provider comparison | NOT_EXECUTED | Official capability pages were reviewed, but no live alternative-provider configuration was run; this remains outside the selected bounded batch |

The experimental findings are complete for the selected OpenAI plus local
stdio scope, but merge readiness is not implied by
the findings alone:

```text
SPIKE_FINDINGS = COMPLETE
MERGE_READINESS = PENDING_REVIEW
```

The measured conclusion remains `AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED`.
The original provider-managed MCP hypothesis is only partially evaluated:
the successful Phase C path is a client-managed application bridge, while the
Hosted provider-managed path remains experimental and caveated. The provider
comparison criterion is explicitly not executed for Anthropic or Bedrock.
Independent Review and explicit human confirmation are required before
`MERGE_READINESS` can become `READY`.

### Final architecture and follow-ups

Hosted Remote MCP remains:

```text
HOSTED_REMOTE_PATH = VIABLE_WITH_CAVEATS
```

It was technically demonstrated, but the historical intermittent HTTP 424
tool-list failures remain unexplained and Viewer least-privilege authentication
remains unresolved. The local stdio/application-managed path is the more
observable evaluation path for this spike, while production transport and
authentication selection remains a follow-up decision.

The architecture recommendation remains **Proposed**, not Accepted:
keep exploration orchestration in the LLM, enforce only narrow application
guardrails and evidence verification, and retain transport/authentication as
replaceable boundaries. Follow-up candidates are production least-privilege
authentication, Hosted 424 investigation if it recurs, production transport
selection, and refinement of the simple evidence verifier. No follow-up Issue
was created by this spike.

## Issue #17 close-out hardening

No additional live evaluation was performed during close-out. The final
experimental evidence is fixed as follows:

| Case | Final result | Interpretation |
| --- | --- | --- |
| `incomplete-first-result` | FAIL | Relevant follow-up was attempted, but redundant queries reached the six-call guard and a supported conclusion was not completed |
| `empty-result-recovery` | PASS | The valid zero-row fixture was recognized and a model-selected recovery query obtained evidence |
| `hypothesis-disproved` | PASS | The fixed historical fixture was ranked correctly and the initial hypothesis was rejected |
| `insufficient-evidence` | PASS | Missing external causal evidence was identified without fabrication |

The close-out state is:

```text
SPIKE_FINDINGS = COMPLETE
AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED
ARCHITECTURE_PRINCIPLE = SUPPORTED_WITH_CAVEATS
MERGE_READINESS = PENDING_REVIEW
```

### Independent Review disposition

The previous Independent Review returned `CHANGES_REQUIRED` with escalation.
The findings are classified without reopening live evaluation:

| Finding | Disposition | Rationale / action |
| --- | --- | --- |
| Hosted OAuth scope is broader than the read-only boundary | Follow-up | Hosted is experimental-only and not the selected evaluation path. Production least-privilege OAuth is separate follow-up work. |
| Hosted `require_approval=never` approval mismatch | Follow-up | It was bounded to the three approved read-only tools for feasibility only; it is not a production recommendation. |
| Hosted timeout/retry/result-size enforcement | Follow-up | Hosted is not selected for final evaluation; no Hosted retry or productionization is added. |
| Selected stdio datasource/query runtime boundaries | Must fix | The stdio bridge fails closed on the fixed datasource, approved tools, actual query shape, filters/parameters, row limit, result size, and aggregation-first policy. |
| Structured outcome could be treated as PASS without sufficient validation | Must fix | A deterministic evidence verifier rejects missing or internally inconsistent outcomes and checks empty recovery, hypothesis state, and insufficient-evidence contracts. |
| Documentation marked READY before human confirmation | Must fix | Documentation now separates `SPIKE_FINDINGS=COMPLETE` from `MERGE_READINESS=PENDING_REVIEW`. |

Hosted-specific code remains an explicit diagnostic spike path only. It is not
used by the normal stdio runner and is not a production runtime. Its historical
scope, approval, Viewer authentication, and intermittent 424 caveats are
preserved for reproducibility and listed as follow-up work. The selected
execution path is local stdio plus the thin application-managed bridge.

### Evidence verifier boundary

The verifier checks structured outcome enums, required fields, and internal
consistency; successful zero-row evidence followed by non-empty recovery;
hypothesis revision/rejection and, when supplied by the harness, agreement
with the fixed fixture rank; explicit missing evidence; and the fixed
datasource through the stdio bridge.

It does not select the next tool, rewrite a query, retry an empty result,
revise a hypothesis, or decide exploration strategy. The
`incomplete-first-result` FAIL remains negative evidence and is not transformed
into a PASS by the verifier.

### Final transport comparison

| Dimension | Hosted + Remote MCP | stdio + app-managed |
| --- | --- | --- |
| Connectivity | Demonstrated | Demonstrated |
| Reliability | Intermittent 424 caveat | Stable enough for evaluation |
| Authentication | OAuth complexity; Viewer unresolved | Dedicated PAT worked for spike; production least privilege unresolved |
| Observability | Lower; connector boundary obscures failures | Higher; bridge sees tool arguments, results, latency, and errors |
| Application complexity | Lower | Higher due to local process and tool loop |
| Agentic evaluation suitability | Secondary/experimental | Preferred path for this spike |
| Production readiness | Unresolved | Unresolved |
| Recommendation | Experimental only | Proposed evaluation architecture, not Accepted production architecture |

### Proposed architecture

```text
Conversation / Trigger
        ↓
Lightweight Analysis Contract
        ↓
Agentic LLM
        ↓
Thin application-managed tool bridge
        ↓
Tableau MCP
        ↓
Structured Evidence
        ↓
Simple Evidence Verifier
        ↓
Intervention Decision
```

The Analysis Contract retains `Required Evidence`, `Optional Evidence`, and
`Open Questions`. The LLM uses these as analytical context. The application
verifies completion, provenance, safety, bounds, and obvious consistency
without becoming a workflow engine.

Follow-up candidates, not part of this close-out implementation, are:

1. Hosted Tableau MCP least-privilege authentication;
2. Hosted intermittent 424/vendor escalation if it recurs;
3. production transport selection (Hosted, self-hosted HTTP, or stdio);
4. production PAT/OAuth credential model;
5. evidence-verifier refinement; and
6. additional provider comparison if still required.
