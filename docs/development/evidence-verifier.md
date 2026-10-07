# Evidence and completion verification

Issue #45 adds a small deterministic boundary after Agentic Analysis.

`Evidence` is a bounded interpretation of one observation. It carries the
Analysis Contract question ID, a status (`supported`, `contradicted`, or
`unresolved`), a short observation, and provenance. Tableau provenance keeps
the approved datasource, tool name, and sequence reference; raw MCP results,
credentials, and unrestricted rows are not copied into this model.

`verifyEvidence(contract, evidence)` only interprets the supplied Evidence. It
does not choose a Tableau tool, build a query, plan follow-up exploration, or
infer a new hypothesis. Required questions are complete when each has
Tableau-backed supported or contradicted evidence. Missing, unresolved,
non-Tableau, malformed, unavailable, unknown, or conflicting evidence fails
closed as `INSUFFICIENT` and is reported in `unresolvedRequiredEvidence` or
`reasons`.

Agentic tool records do not receive question meaning implicitly. The small
`interpretAgenticEvidence` post-analysis boundary requires an explicit
sequence-to-question interpretation after the referenced normalized record
exists. Until that step runs, the Agentic Analysis result contains observations
only; a model report of `evidence_complete: true` is not authoritative.

The boundary is therefore:

```text
Analysis Contract
+ normalized Tableau-backed agentic evidence
        ↓
Evidence model
        ↓
deterministic verifier
        ↓
COMPLETE | INSUFFICIENT
```

This verifier is not an analysis orchestrator, intervention decision, or
provider-specific implementation.
