# ADR-0002: Proposed agentic Tableau analysis boundary

## Status

Proposed

## Context

Issue #17 evaluated whether an LLM can perform semantic exploration of a
bounded Tableau datasource while an application retains deterministic safety
and verification controls. The canonical measured result was
`AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED`: empty-result recovery,
hypothesis disproof, and insufficient-evidence handling passed, while one
follow-up exploration case failed to complete before its fixed tool-call
guard.

The stdio plus application-managed bridge was suitable for this evaluation,
but production transport, production authentication and least privilege, and
cross-provider comparison remain unresolved or explicitly deferred.

## Decision

Retain the architecture recommendation as **Proposed** after Issue #17.
Issue #17 may close as an architecture-feasibility spike without promoting
the recommendation to Accepted.

The proposed boundary is:

- the LLM owns semantic exploration: next-tool selection, follow-up
  exploration, evidence interpretation, hypothesis revision, and semantic stop
  decisions;
- the application owns deterministic safety and verification: credentials,
  tool and datasource allowlists, read-only and result bounds, schema
  validation, budgets, telemetry, and thin evidence-completion checks.

This is a candidate direction, not an approved production transport or
authentication decision.

## Alternatives considered

- Promote the recommendation to Accepted with Issue #17 closure. Rejected:
  the measured feasibility is partial and production transport and
  authentication decisions have not been made.
- Reject LLM-centered semantic exploration. Not supported by the measured
  cases, which demonstrated several required behaviors despite a follow-up
  efficiency limitation.
- Keep exploration workflow-specific in the application. Not proposed: it
  would duplicate semantic decisions that the spike showed the LLM can make,
  while offering no replacement for deterministic guardrails.

## Rationale

The fixed four-case evaluation supports keeping semantic exploration with the
LLM subject to deterministic application boundaries. The local stdio path
provided the observability needed for the spike. Hosted Remote MCP research is
retained as a future migration candidate, but its executable broad-scope OAuth
harness is not part of the merge target and production readiness remains
unresolved.

## Trade-offs / consequences

- The proposal preserves LLM flexibility for investigative work, but requires
  bounded tools and evidence verification to prevent unsupported completion.
- The selected stdio path is suitable for evaluation, not a production
  transport decision.
- Full #16 benchmark coverage and Anthropic and Bedrock evaluations were not
  executed; they are explicitly deferred follow-up work.

## Revisit when

Revisit acceptance after later production architecture decisions,
transport/authentication design, demo validation, and/or broader provider
evaluation. Also revisit if production safety, latency, cost, or Tableau MCP
capabilities materially change.

## Evidence / references

- Issue #17 technical-spike record:
  [`agentic-llm-measured-runs.md`](../spikes/agentic-llm-measured-runs.md)
- Final state: `AGENTIC_FEASIBILITY = PARTIALLY_SUPPORTED` and
  `ARCHITECTURE_PRINCIPLE = SUPPORTED_WITH_CAVEATS`
- Full #16 benchmark, Anthropic, and Bedrock evaluations:
  `DEFERRED_BY_HUMAN_DECISION`
