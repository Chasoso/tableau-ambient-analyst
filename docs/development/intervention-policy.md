# Intervention policy

Issue #46 adds the first conservative intervention boundary after evidence
verification. `decideIntervention` consumes the detected analytical
opportunity and the deterministic `EvidenceVerificationResult`; it does not
choose Tableau tools, start another analysis, score opportunities, or send a
message.

The policy is deliberately small:

- incomplete, unavailable, malformed, or otherwise insufficient verification
  always returns `HOLD`;
- an active `assumption-based-decision` returns `INTERVENE` only when the
  verified `decision-assumption-support` evidence is contradicted; and
- complete evidence without that decision-relevant contradiction remains
  `HOLD`, including low-impact confirmation and contradictions on a
  non-decision opportunity.

The returned reason is concise and auditable. `INTERVENE` is only a policy
decision; this Issue does not implement Extension messaging, audio, Live
Control, persistence, user profiling, or domain-specific ranking.

The lifecycle is:

```text
Trigger opportunity
        ↓
Agentic Tableau analysis
        ↓
normalized evidence
        ↓
deterministic Evidence verifier
        ↓
minimal intervention policy
        ↓
INTERVENE | HOLD
```
