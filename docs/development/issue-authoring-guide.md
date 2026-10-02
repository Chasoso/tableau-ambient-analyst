# Issue authoring guide

This guide defines what an Issue should record so that implementation work and
architecture learning remain explainable. It complements the lifecycle in
[`development-loop.md`](development-loop.md) and the executable rules in
[`../../AGENTS.md`](../../AGENTS.md). It is a documentation standard, not a
GitHub Issue template; Issue #5 owns template files.

Choose the lightest Issue type that makes the work reviewable. Do not turn a
decided implementation into a Technical Spike merely to fill in more
sections.

## Normal Implementation Issue

Use this type when the product and architecture direction are already decided
and the work is a bounded implementation, fix, or documentation change.

Recommended sections:

```markdown
## Purpose

## Context

## Scope

## Out of scope

## Acceptance criteria

## Validation

## Human review / experience checks

## Follow-up
```

The sections have these jobs:

- `Purpose` states the intended outcome.
- `Context` gives the existing behavior, constraint, or decision that makes
  the work necessary.
- `Scope` names the files, behaviors, or boundaries that may change.
- `Out of scope` protects the Issue from adjacent improvements and unapproved
  architecture, service, auth, or data-access expansion.
- `Acceptance criteria` describes observable completion.
- `Validation` names the checks appropriate to the current runtime. Do not
  invent runtime-specific commands before the validation policy exists.
- `Human review / experience checks` describes any judgment that automation
  cannot make, and may state that it is not applicable.
- `Follow-up` records deliberately deferred work without expanding this Issue.

Normal Implementation Issues do not ordinarily require a Question,
Hypothesis, Alternatives, or Experiment section. Add one of those only when
the work genuinely contains unresolved uncertainty.

## Technical Spike Issue

Use this type when the primary goal is to reduce uncertainty rather than to
deliver a decided implementation. A spike is a bounded experiment, not an
automatic architecture commitment.

Recommended sections:

```markdown
## Question

## Hypothesis

## Alternatives

## Experiment

## Metrics / observations

## Scope

## Out of scope

## Acceptance criteria

## Validation

## Decision / follow-up
```

### Question

State what the spike must find out. Examples:

- Can an Agentic LLM continue Tableau exploration without an additional
  sequential human instruction?
- What differences between OpenAI, Anthropic, and Bedrock matter for the tool
  loop?
- How much application-side orchestration can be reduced safely?

Keep the question narrower than “which architecture should we use?” when a
smaller uncertainty can be tested first.

### Hypothesis

State the current expectation and what evidence would support or weaken it.
Label it as provisional. A hypothesis is not a stable product constraint or a
permanent requirement.

### Alternatives

Name the options being compared and the relevant comparison dimensions. If an
alternative is not investigated, record why it was out of scope, unavailable,
or not useful for this question. Do not present an unexamined option as
rejected evidence.

### Experiment

Describe what will be run, including inputs, environment assumptions,
approved tool/data boundaries, and important limits. Make the experiment
reproducible enough for another contributor to understand what produced the
result. Keep raw transport artifacts, secrets, unauthorized access, and
unbounded query or cost expansion outside the experiment.

### Metrics / observations

Select only measures that answer the Question. Possible observations include:

- evidence completion;
- tool-call count and correct tool selection;
- early stop and retry behavior;
- latency;
- API or token cost;
- result quality;
- failure mode; and
- context size.

Do not require every spike to collect every metric. State qualitative
observations when they are more informative than a number.

### Decision / follow-up

The agent may organize evidence, compare alternatives, explain trade-offs,
recommend a course of action, and propose `keep`, `revise`, `reject`, or
`defer` candidates. The Technical Spike learning cycle is not complete until a
human reviews the evidence and records or confirms the decision or follow-up.
The Issue should make the confirmation state visible, including when the
decision is pending.

## UX / analysis hypothesis supplement

For work whose success depends on usefulness, clarity, or analysis behavior,
add a human experience check. Describe the path a person should try, the
question they should answer, and what confusion, unsupported claim, or
unhelpful behavior to look for. Automated verification does not replace this
check.

## Separate three kinds of information

Keep these statements distinct in every Issue where they apply:

### Stable constraints

Rules that remain true until deliberately changed, such as default no-network
validation, no direct push to `main`, or human authorization for persistent
writes.

### Current hypotheses

Beliefs being tested, such as whether a provider's hosted tool loop reduces
application orchestration or whether transcript replay is the best first
experiment. Hypotheses may be kept, revised, rejected, or deferred; do not
write them as permanent requirements.

### Implementation details

Current means of implementing the experiment, such as a file layout, helper,
adapter, or temporary fixture. These may change without changing the
hypothesis or architecture decision.

## Relationship to lifecycle and decisions

Issue structure should support the lifecycle:

```text
Question -> Hypothesize -> Specify -> Spike / Build -> Measure / Verify -> Decide -> Document
```

Normal implementation may use the lighter
`Specify -> Build -> Verify -> Document` path. For a Technical Spike,
`evidence` is not the same as `decision`: human confirmation of the outcome or
follow-up closes the learning cycle.

Material architecture, service, security, authorization, cost, or data-flow
decisions should be preserved in an ADR after the human decision. This guide
does not define the ADR template or numbering rules; see
[`../adr/README.md`](../adr/README.md).

## Pull Request documentation standard

The PR should explain what changed and what evidence supports review. Use the
lightest applicable set of sections:

```markdown
## Summary

## Related Issue

## What changed

## Validation

## Manual review points

## Decision / learning

## External network / integration

## Follow-up
```

At minimum, record the Summary, Related Issue, What changed, Validation, and
Manual review points. The other sections are useful when the change includes a
Technical Spike, a human decision, an external integration, or deliberate
follow-up work.

Validation evidence should identify, where applicable:

- the exact command or check;
- its result;
- skipped checks and why they were skipped;
- whether external network or a live integration was used; and
- a short summary of any retry.

Do not invent runtime-specific commands in this standard. The commands and
required checks are defined by later runtime/validation work.

### Technical Spike PRs

A Technical Spike PR should make the `Question`, `Result / observations`,
`Recommendation`, and `Human-confirmed decision / follow-up` state visible.
For example, a technically reviewable PR may state:

> Evidence collected; decision pending human confirmation.

An agent may prepare the evidence, alternatives, trade-offs, recommendation,
and candidate `keep`, `revise`, `reject`, or `defer` outcome. The PR must not
present a material spike outcome as human-confirmed until that confirmation or
follow-up has been recorded.
