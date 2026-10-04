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
