# Agentic Analysis Path

Issue #44 adds the smallest application-layer path from an
[`AnalysisContract`](analysis-contract.md) to structured analysis output. The
path reuses the proven Issue #17 boundaries:

- the existing OpenAI Responses tool loop lets the model choose the next
  approved read-only Tableau tool;
- `TableauStdioBridge` validates the fixed datasource, tool arguments, result
  shape, and bounded result size;
- `StdioRunBudget` enforces wall-clock, token, and spend limits; and
- the existing telemetry parser validates the structured outcome.

`runAgenticTableauAnalysis` is the application boundary. It validates the
contract, verifies that all approved tools are available, forwards only
normalized tool evidence to the model, enforces the tool-call bound, and
returns the contract, normalized Tableau-backed evidence, model-reported
structured outcome, the authoritative `evidenceVerification`, bounded final
answer, call summaries, and budget snapshot. The caller may provide explicit,
bounded sequence-to-question interpretations; the application maps those
interpretations only after the referenced records are produced by this run and
then invokes the deterministic verifier. With no interpretations, verification
uses an empty Evidence collection and therefore returns `INSUFFICIENT`.
The model must report `missing_evidence` using the stable Required Evidence
question IDs; the application validates that report's structure and returns
`modelReportedMissingEvidenceQuestionIds`. This is not verified evidence
completion: a model saying that evidence is complete is not proof that
Tableau-backed evidence satisfies a question. The model chooses exploration
order; application code does not recreate it as a Tableau-specific if/else
planner.

Issue #44 stops at collecting safe, normalized Tableau-backed evidence and
validating the model output shape. Issue #45 is responsible for interpreting
that evidence, mapping it to required questions, deciding supported,
contradicted, or unresolved, and determining true completion. Accordingly,
Semantic Evidence interpretation remains explicit and occurs only after its
normalized observations exist. The model-reported `evidence_complete` field is
never authoritative; callers must use `evidenceVerification.completion` and
`unresolvedRequiredEvidence`. The deterministic completion boundary is
documented in
[`evidence-verifier.md`](evidence-verifier.md).

`runOpenAiStdioAnalysis` is the explicit one-provider entry point. It requires
an API key and the existing local Tableau bridge, so it is opt-in and is not
called by ordinary validation. Tests inject model and tool boundaries and do
not use a network, credential, Tableau MCP, or live datasource.

The contract/context, model output, and Tableau result are data rather than
authorization. They cannot expand the approved tools, datasource, credential,
write, or budget policy. Malformed provider output, malformed normalized tool
evidence, unknown evidence question IDs, inconsistent completion status,
timeout, unavailable approved tools, and budget exhaustion fail closed.
