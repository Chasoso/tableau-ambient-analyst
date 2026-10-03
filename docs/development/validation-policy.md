# Validation policy

## Purpose

This document defines how the project gathers technical validation evidence
without making AWS, live APIs, Hosted Tableau MCP, or paid services a default
development dependency. It complements the record format in
[`issue-authoring-guide.md`](issue-authoring-guide.md) and the execution rules
in [`../../AGENTS.md`](../../AGENTS.md).

The default path is:

```text
local -> deterministic -> no-network -> repeatable -> low-cost
```

The initial TypeScript/Node.js runtime maps the Layer 1 categories to local
commands documented in this repository. This document still defines the
categories and decision boundaries; it does not make external integrations or
CI part of the default path.

## Validation layers

### Layer 1 — Static / deterministic local validation

These checks should be local, repeatable, and independent of external
availability. The eventual runtime may map them to commands such as:

- formatter check;
- lint;
- typecheck;
- deterministic unit tests;
- deterministic local build;
- schema and fixture validation;
- local secret scan; and
- `git diff --check`.

No coverage threshold or CI job is selected here. The runtime bootstrap maps the
currently available checks as follows:

| Category | Local command |
| --- | --- |
| formatter check | `npm run format:check` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| deterministic unit tests | `npm test` |
| deterministic local build | `npm run build` |
| complete Layer 1 validation | `npm run validate` |

`git diff --check` remains a repository review check. Secret scanning is not
mapped here because its intended primary scanner is deferred to Issue #13.

For a clean local setup, use `npm ci` from the repository root, followed by
`npm run validate`. Package installation may access the package registry; the
validation commands themselves do not call external LLM, MCP, Tableau, cloud,
database, or paid services.

### Layer 2 — Local integration validation

This layer validates interactions without external network access. Suitable
examples include:

- fixture replay;
- mock MCP responses;
- recorded transcript replay;
- deterministic provider stubs;
- local Extension/backend interaction; and
- test datasource fixtures.

Layer 2 is part of the default no-network posture. It should preserve the
same contracts and safety boundaries that a live integration would use, while
remaining reproducible and low-cost.

### Layer 3 — External / live integration validation

This layer includes live LLM API calls, Hosted Tableau MCP, Tableau Cloud,
live authentication, tunnels, and other external services. It is not part of
default validation.

An Issue that requires Layer 3 must make the following explicit:

- which external service is needed and why;
- what data and approved tool/datasource boundary are used;
- which credentials are required and how they are supplied;
- whether paid usage, rate limits, or other cost applies;
- what bounded result and call scope is expected;
- what logging and evidence policy applies; and
- how failure, skip, and cleanup are handled.

Live validation remains opt-in, observable, and bounded. It does not silently
turn an ordinary PR into an external integration test.

## Default validation policy

Ordinary Issues and PRs should use Layer 1 and, when useful, Layer 2. The
default validation path is local, deterministic, no-network, repeatable, and
low-cost. Future CI should center on this same path so that local evidence and
CI evidence have the same meaning.

The current baseline maps Layer 1 local validation to `npm run validate`. The
baseline CI runs `npm ci` followed by the same `npm run validate`, and runs
Gitleaks as the repository's primary secret-scan gate. Neither path performs
live LLM, MCP, Tableau, cloud, database, tunnel, or paid integration calls.

## Main branch enforcement

Changes to `main` are required to go through a pull request. The repository's
active Ruleset requires the existing `validation` and `secret-scan` checks;
live or paid integration checks are not merge requirements. The Ruleset is the
source of truth for enforcement details. It does not require an approving
review count, so the human merge decision remains explicit without making a
single-maintainer workflow unusable. The repository owner retains an
always-available Ruleset bypass capability. Repository policy reserves that
bypass for CI or repository-configuration recovery rather than normal merges.

External LLM, Hosted Tableau MCP, Tableau Cloud, live auth, tunnel, and paid
API tests must not be normal CI requirements. A live test may be an explicit
manual check or an opt-in job when a later Issue defines its credentials,
scope, cost, and failure semantics. External outage must not be confused with
a code defect, and a flaky external dependency must not silently become a
merge gate.

For lightweight reporting, classify checks as:

- `local-required` — expected for the change and safe to run without network;
- `external-optional` — available only when explicitly enabled; or
- `external-manual` — requires deliberate human execution and review.

These labels are descriptive, not a new workflow or test matrix.

### Issue-required external evidence

Layer 3 is optional for an ordinary implementation or PR and is not a default
merge gate. An Issue or Technical Spike may nevertheless make a live result
explicit Acceptance Evidence for its Question. Examples include requiring a
Hosted Tableau MCP run to determine whether a multi-tool loop works, or a live
provider call to compare a provider-specific behavior.

When Layer 3 is explicitly required, an unavailable service, skipped run,
provider outage, missing auth prerequisite, or equivalent failure is not a
pass and does not make the Issue fully validated. Record the outcome as
`inconclusive` or `pending external validation`, classify the cause without
calling an outage an application defect, and leave the necessary evidence
visible in the Issue/PR. Recheck whether `Closes #<issue>` and any human
decision or follow-up are appropriate. Do not silently downgrade required
evidence to optional merely because it is external.

## Validation evidence in Issues and PRs

Use the documentation standard from Issue #3. Record, as applicable:

- the check or command category;
- pass or fail result;
- skipped checks;
- the reason for each skip;
- whether network access was used;
- whether live external integration was used;
- whether credentials were required;
- a retry summary; and
- the failure classification.

For example:

```text
Validation:
- local deterministic checks: passed
- external LLM test: skipped — not required by this Issue
- Hosted Tableau MCP: not used
```

Do not claim that a runtime check ran when the runtime or command does not yet
exist. For a Technical Spike, also record the observations and whether the
human decision or follow-up is still pending.

## Failure policy

### Local deterministic failure

If a Layer 1 or Layer 2 failure is in scope, fix it before opening the PR and
rerun the relevant validation. Do not suppress a failure, weaken a test,
disable a rule, or change the evidence requirement solely to obtain a passing
result. If the failure is unrelated, unclear, or requires a human-owned
decision, report it with the current scope and branch state.

### External integration failure

Classify a live failure before deciding what to do. At minimum distinguish:

- application defect;
- authentication or permission error;
- provider or service outage;
- rate limit;
- provider error;
- data availability issue; and
- environment or configuration issue.

External failures should not be presented as ordinary deterministic test
failures. Record the service, scope, evidence, and whether the check is safe to
retry or should be skipped and reported.

### Retry

Retry only transient or environment-related failures, and only within a
bounded policy. Do not automatically retry authentication or permission
failures, secret findings, destructive operations, or a repeated paid API
call. Repeated retries must not create uncontrolled cost, token use, rate
pressure, or duplicate external effects. Concrete retry counts belong to a
later runtime policy.

## Validation and human review

Automated validation asks:

```text
Is the implementation technically correct and reproducible?
```

Human review asks:

```text
Is it useful, understandable, acceptable, and supported by the evidence?
```

For Technical Spikes, architecture or service-selection experiments, and UX
or analysis hypotheses, human review cannot be replaced by a passing automated
check. A Technical Spike is not a completed learning cycle until a human has
reviewed the evidence and recorded or confirmed the decision or follow-up.

## Relationship to external integration safety

This document defines when validation may run. The data, credential, logging,
MCP, query, write, and cost boundaries for an external run are defined in
[`external-integration-safety.md`](external-integration-safety.md). Both
documents must be applied together: an opt-in test is not permission to bypass
the safety boundary.
