# Architecture Decision Records

Architecture Decision Records (ADRs) are durable records of material
technical decisions: what was decided, why it was decided, which alternatives
were considered, what trade-offs were accepted, and when the decision should
be revisited.

An ADR is not a research log or a Technical Spike transcript:

```text
Technical Spike: uncertainty -> experiment -> evidence
ADR:              evidence -> human decision -> durable rationale
```

An Issue may define the Question and Scope, a Technical Spike may produce
Evidence, and a PR may record implementation and Validation. After a material
human decision, an ADR may preserve the durable rationale. These artifacts are
related, but the sequence is not a mandatory workflow for every change. In
particular, a Spike result is not automatically an Architecture Decision.

## When an ADR is useful

Recommend an ADR for a durable or material decision such as:

- LLM provider strategy;
- external service or API selection;
- MCP architecture or trust/data boundary;
- application-side versus server-side orchestration;
- persistence technology;
- authentication or authorization approach;
- deployment architecture;
- local versus cloud execution boundary;
- a major module or service boundary;
- persistent write policy; or
- a major data-access or security boundary.

The list is a guide, not a requirement to create an ADR for every technical
choice. Create one when a future contributor would otherwise need to repeat a
material comparison or reconstruct why the system has this shape.

## When an ADR is usually unnecessary

Do not normally require an ADR for formatting changes, renames, small
refactors, routine dependency bumps, bug fixes, test additions, or an
implementation detail that is fully local to its Issue and carries no durable
architecture consequence.

Avoid “ADR for everything.” The Issue, PR, or code review can be the sufficient
record for a small, reversible decision.

## Status and human ownership

Use a lightweight status such as:

- `Proposed` — a draft for review;
- `Accepted` — a human has confirmed the decision;
- `Superseded` — a later ADR replaces it; or
- `Deprecated` — it should no longer guide new work.

An agent may prepare a `Proposed` ADR from spike evidence, update a draft, and
suggest a status change. A `Proposed` ADR may therefore describe a candidate
direction while human review is pending. Transitions to `Accepted`,
`Superseded`, or `Deprecated` require human confirmation because they change
which architecture decision should guide the project. The final decision,
including whether to adopt, revise, reject, or defer an option, is human-owned.

## Naming and numbering

Use a four-digit number and a short kebab-case title:

```text
docs/adr/0001-use-modular-monolith.md
docs/adr/0002-llm-provider-abstraction.md
```

Numbers should be unique and assigned in sequence when an ADR is created. This
is a lightweight naming convention, not a reason to create placeholder ADRs.
This Issue creates the mechanism only; it does not make an architecture
decision.

Do not create speculative ADRs for Modular Monolith, OpenAI Responses API,
provider abstraction, Tableau MCP, WebSocket, SQLite, or AWS adoption/rejection
in this Issue. Those choices require their own evidence and human decision.

## Revisit condition

Every material ADR should state what would make its decision worth revisiting.
Examples include a change in Hosted Tableau MCP capabilities, a provider API
adding or removing server-side tool loops, a new cloud deployment requirement,
changed security requirements, a real-time audio requirement, or exceeding a
cost or latency threshold.

Use [`template.md`](template.md) for the minimum record. Issue #3 does not add
GitHub templates or an automated ADR workflow; those concerns belong to later
Issues if needed.
