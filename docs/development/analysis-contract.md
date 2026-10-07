# Analysis Contract

Issue #43 adds the small completion boundary between a detected opportunity and
later evidence work. `analysisContractFromOpportunity` keeps the detected
claim and creates three deliberately separate question groups:

- `requiredEvidence`: the minimum questions that must be answered before the
  claim can be considered sufficiently supported;
- `optionalEvidence`: useful additional questions that are not required for
  completion; and
- `openQuestions`: questions that may be added as exploration reveals new
  uncertainty.

The contract is provider-neutral and domain-neutral. It is not a Tableau tool
sequence, query, filter plan, exploration script, planner, or evidence result.
The deterministic mapping currently selects a small set of required questions
from the Trigger Detector reason. Optional and open groups start empty and can
be extended by a later, explicitly scoped capability.

`validateAnalysisContract` rejects empty claims, missing required evidence,
unknown fields, malformed question IDs, empty questions, and duplicate question
IDs. It validates the completion boundary only; it does not verify evidence or
call an external service.
