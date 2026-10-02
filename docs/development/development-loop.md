# Development loop

## Purpose

`tableau-ambient-analyst` is both a Tableau × AI Ambient Analysis PoC and an
architecture learning project. We are evaluating an Agentic LLM + Tableau MCP
system while learning to explain choices about MCP, Tableau Extension
boundaries, local-to-cloud evolution, model providers, data access, cost, and
security.

The goal is therefore not only a working demo. Each meaningful experiment
should make its question, evidence, trade-offs, human decision, and remaining
uncertainty understandable to the next contributor.

The concise execution rules are in [`AGENTS.md`](../../AGENTS.md). The
inheritance and adaptation decisions behind them are in
[`rule-inheritance.md`](rule-inheritance.md).

## Lifecycle

```text
Question
  -> Hypothesize
  -> Specify
  -> Spike / Build
  -> Measure / Verify
  -> Decide
  -> Document
```

### Question

Define what we need to learn or make possible. Examples include:

- Can an Agentic LLM continue Tableau exploration without an additional human
  instruction after receiving a tool result?
- What differences between OpenAI, Anthropic, and Bedrock matter for this
  workflow?
- Where should the boundary between the Dashboard Extension and backend be?

A question is narrower and more testable than a broad request to “build the
feature.”

### Hypothesize

State the current expectation, competing alternatives, and what evidence would
support or weaken it. A hypothesis is provisional. It must not silently become
a permanent product requirement or architecture decision merely because it is
written in an Issue.

### Specify

Define the experiment or implementation boundary before editing. The Issue
should make clear, as applicable:

- scope and out of scope;
- acceptance criteria;
- metrics or observations;
- safety and data-access boundaries; and
- technical and human validation.

For an Agentic MCP experiment, specify the approved tool/data boundary, query
and result limits, expected follow-up behavior, and how failure or early stop
will be recognized.

### Spike / Build

Distinguish a technical spike from normal implementation. A spike is the
smallest experiment that reduces an important uncertainty; it is not, by
itself, a commitment to a permanent architecture, provider, deployment model,
or integration.

Build only the scope needed to answer the question or satisfy the specified
acceptance criteria. Keep approved agentic MCP tool-result consumption and
bounded Tableau MCP query exploration distinct from unrestricted execution,
unauthorized data access, or persistent writes. Future ephemeral UI operations
such as filters or selections must likewise be governed separately from
persistent changes.

### Measure / Verify

Keep technical verification and experiment measurement distinct.

Technical verification asks whether the implementation is technically valid.
Depending on the runtime, it may include deterministic tests, typecheck,
build, lint, or other local checks. Runtime-specific commands are introduced
by later Issues; this documentation Issue does not invent them.

Experiment measurement asks what happened in the experiment. Relevant measures
may include tool-call behavior, evidence completion, latency, API cost, result
quality, context size, failure modes, and early-stop behavior. Each experiment
should define only the metrics useful for its question.

Default validation remains local and no-network. Hosted Tableau MCP and live
LLM API tests are opt-in and gated, and paid API calls are not part of ordinary
CI.

For UX or analysis hypotheses, automated verification is not enough. A human
should assess whether the interaction or explanation is understandable,
useful, and consistent with the intended hypothesis.

### Decide

Record an outcome such as `keep`, `revise`, `reject`, or `defer`, together with
the evidence, alternatives considered, and accepted trade-offs.

Material product direction, architecture, external-service selection,
security, authentication, authorization, permission, cost, or data-flow
decisions are human-owned. Agents may summarize evidence, compare
alternatives, organize trade-offs, and recommend a course of action, but must
not silently finalize those decisions. The same applies to accepting or
rejecting a product hypothesis when that outcome changes direction.

For a technical spike, the outcome and any next implementation direction must
be reviewed or confirmed by a human. The agent may propose `keep`, `revise`,
`reject`, or `defer` and suggest follow-up work, but it must not close the
spike's learning cycle on the human's behalf.

“It worked” is evidence about an experiment, not by itself a decision to adopt
the implementation or service permanently.

### Document

Record the question, result, limitations, and decision in the appropriate
durable place: the Issue, PR, an architecture decision record, or a follow-up
Issue. Preserve failed experiments, rejected alternatives, and useful negative
results rather than deleting their history. A later contributor should be able
to understand both what was selected and why plausible alternatives were not.

## Applying the loop by Issue type

Not every Issue needs every stage at the same depth. Use the smallest complete
path that fits the work.

### Normal implementation

```text
Specify -> Build -> Verify -> Document
```

Use this for a bounded implementation or fix whose product and architecture
decisions are already explicit.

### Technical spike

```text
Question -> Hypothesize -> Specify -> Spike -> Measure -> Decide -> Document
```

Use this when the main output is reduced uncertainty about an Agentic LLM,
MCP, provider, transport, Extension/backend boundary, or local-to-cloud
option. Keep the spike narrow and do not treat its result as an automatic
architecture commitment. The agent should organize the evidence, compare
alternatives, explain trade-offs, and recommend an outcome. A technical spike
is not considered complete as a learning cycle until a human has reviewed its
evidence and recorded or confirmed the decision or follow-up. This human
confirmation is specific to spikes, architecture/service-selection
experiments, and hypothesis-testing work; it does not add an approval gate to
every straightforward implementation or fix.

### UX or analysis hypothesis

```text
Question -> Hypothesize -> Build -> Verify -> Human Experience -> Decide -> Document
```

Use this when usefulness, clarity, or analysis behavior requires human
judgment in addition to automated checks.

## Relationship to ADRs

Material architecture or service decisions need a durable record, but this
Issue does not define an ADR template or numbering scheme. A technical spike
and the decision that follows it are separate: the spike produces evidence,
while the decision explains what to adopt, revise, reject, or defer and why.

Issue #3 will define the repository's issue, PR, and architecture-decision
documentation standards. Until then, use the Issue and PR to preserve enough
context for the decision without adding a new template by assumption.

## Source-of-truth hierarchy

The documents have different jobs:

```text
rule-inheritance.md
    | decisions
    v
AGENTS.md
    | executable rules
    v
development-loop.md
    | explanation and lifecycle
```

`rule-inheritance.md` records why inherited rules were accepted, adapted,
deferred, or omitted. `AGENTS.md` contains the short rules an agent must apply
at execution time. This document explains the lifecycle and its purpose for
humans. Later formal policies may refine these documents, but should update
them together so they do not drift.
