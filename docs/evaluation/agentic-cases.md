# Domain-neutral agentic evaluation cases

This suite defines reusable, deterministic analytical challenges for the later
provider and Tableau MCP spikes. It evaluates exploration behavior rather than
only whether a model produces a correct answer.

The source of truth is the case contract and fixtures in
[`src/evaluation/`](../../src/evaluation/). The fixtures are synthetic and
provider-neutral; they do not model an MCP wire format, a provider response, or
a real Tableau datasource.

## Evaluation dataset is not the demo dataset

```text
evaluation dataset != demo dataset
```

These cases are intentionally designed to test behavior. A later demo may use
a different dataset, field vocabulary, and meeting scenario.

## Case classes

| Case                      | Challenge                                   | Expected behavior                               |
| ------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `one-call-sufficient`     | One result satisfies all required evidence  | Stop without redundant exploration              |
| `incomplete-first-result` | First result lacks a required comparison    | Continue and complete the evidence              |
| `empty-result-recovery`   | Initial condition returns no usable result  | Adjust the condition and retry within bounds    |
| `dimension-change`        | Aggregate hides a segment difference        | Change dimension and revise the interpretation  |
| `temporal-comparison`     | Current value lacks context                 | Retrieve a comparison period                    |
| `hypothesis-disproved`    | Evidence contradicts the initial hypothesis | Reject or revise rather than force confirmation |
| `insufficient-evidence`   | Required evidence remains unavailable       | Stop with insufficient evidence                 |
| `recoverable-tool-error`  | A transient error has a bounded retry path  | Recover and continue                            |
| `conflicting-evidence`    | Results appear inconsistent                 | Reconcile scope or remain inconclusive          |

The suite does not assign scores or rank providers. Later runs should record
observations such as evidence completion, premature stop, redundant calls,
recovery, hypothesis revision, and insufficient-evidence handling. Latency,
token usage, and cost belong to the provider run record rather than this case
contract.
