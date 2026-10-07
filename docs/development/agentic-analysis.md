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
returns the contract, structured outcome, bounded final answer, call summaries,
and budget snapshot. The model chooses exploration order; application code
does not recreate it as a Tableau-specific if/else planner.

`runOpenAiStdioAnalysis` is the explicit one-provider entry point. It requires
an API key and the existing local Tableau bridge, so it is opt-in and is not
called by ordinary validation. Tests inject model and tool boundaries and do
not use a network, credential, Tableau MCP, or live datasource.

The contract/context, model output, and Tableau result are data rather than
authorization. They cannot expand the approved tools, datasource, credential,
write, or budget policy. Malformed provider output, malformed normalized tool
evidence, timeout, unavailable approved tools, and budget exhaustion fail
closed.
