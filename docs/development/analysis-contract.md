# Analysis Contract

Issue #43 adds the small completion boundary between a detected opportunity and
later evidence work. `analysisContractFromOpportunity` keeps the detected
claim and its bounded Trigger Detector context, then creates three deliberately
separate question groups:

- `context`: the original `sequence`, `speaker`, and `text` values retained by
  the Trigger Detector. This preserves assumptions, comparison claims, and
  other multi-utterance meaning without introducing a second semantic model;

- `requiredEvidence`: the minimum questions that must be answered before the
  claim can be considered sufficiently supported;
- `optionalEvidence`: useful additional questions that are not required for
  completion; and
- `openQuestions`: questions that may be added as exploration reveals new
  uncertainty.

The contract is provider-neutral and domain-neutral. It is not a Tableau tool
sequence, query, filter plan, exploration script, planner, or evidence result.
The deterministic mapping currently selects a small set of required questions
from the Trigger Detector reason. Causal alternative explanations are
optional, and the assumption-based decision check only requires evidence for
the assumption; the decision context itself remains available in `context`.
Open questions start empty and can be extended by a later, explicitly scoped
capability.

`validateAnalysisContract` rejects empty claims, missing required evidence,
unknown fields, malformed context, empty questions, and duplicate question IDs
across all three question groups. The JSON Schema mirrors the string, context,
and shape constraints; the cross-group ID uniqueness check is intentionally
kept in the small runtime validator because it is a relationship between three
arrays. It validates the completion boundary only; it does not verify evidence
or call an external service.
