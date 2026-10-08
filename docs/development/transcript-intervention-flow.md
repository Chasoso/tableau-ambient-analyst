# Transcript replay to intervention flow

Issue #47 adds the first deterministic vertical slice across the existing
boundaries. `runTranscriptInterventionFlow` replays utterances in sequence,
stops at the first analytical opportunity, creates the existing Analysis
Contract, runs the injected Agentic Tableau boundary, performs the existing
post-analysis Evidence interpretation and verifier, and evaluates the minimal
Intervention Policy.

The result contains an auditable ordered event list. It exposes ignored and
detected triggers, contract creation, analysis start, collected evidence
sequences, verification state, intervention result, and fail-closed errors.
No event is emitted for a Tableau tool that was not actually run, and a
non-triggering replay never invokes the model or tools.

The interpretation callback is intentionally injected after Agentic Analysis:
it may assign question meaning only to the normalized records returned by that
analysis. Normal validation supplies mocks at the model, Tableau tool, and
interpretation boundaries; a live Tableau path remains explicit and opt-in.

The flow is:

```text
Transcript Replay
  ↓
TriggerDetector boundary
  ↓
Analysis Contract
  ↓
Agentic Tableau Analysis
  ↓
normalized Evidence records
  ↓
Evidence interpretation + Verifier
  ↓
Intervention Policy
  ↓
INTERVENE | HOLD
```

The flow depends on the existing `TriggerDetector` interface. When no detector
is supplied, the current heuristic `triggerDetector` is used. A later detector
implementation can be injected at this boundary without changing the replay,
contract, evidence, or intervention stages.

Malformed fixtures, unavailable or malformed Agentic output, and malformed
Evidence interpretation fail closed as `FAILED` with an auditable `HOLD`
result. This Issue does not add Extension UI, audio/STT, Live Control, new
providers, persistence, or a workflow engine.
