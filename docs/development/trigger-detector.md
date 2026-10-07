# Trigger Detector

Issue #42 adds the smallest deterministic boundary between replayed
conversation and later analysis. `detectTrigger` consumes ordered
`TranscriptUtterance` values and returns the first analytical opportunity in
sequence order, not a classification of only the latest utterance. It returns
either:

- `ANALYZE`, with a concise claim, a reason, and up to the triggering utterance
  plus its two immediate predecessors as audit context; or
- `IGNORE`, with a stable reason and the same bounded context shape.

The initial detector recognizes only four opportunity types:

- numerical claims with analytical terms;
- causal hypotheses;
- decisions explicitly based on an assumption;
- factual or data disagreements.

These are intentionally transparent heuristics, not a general classifier. A
bounded preceding context is used so an assumption followed by a decision, or
conflicting facts across speakers, can be recognized without summarizing the
whole conversation. Ordinary quantitative claims such as a customer count are
also recognized, while clearly temporal statements remain borderline and are
covered by fixtures. The same bounded rules are available for representative
Japanese phrases; no translation model or external service is used.

For sequential replay such as Issue #47, retain the sequence of the consumed
opportunity and pass it back as a cursor:

```ts
const first = detectTrigger(replayed, {});
if (first.decision === 'ANALYZE') {
  const consumed = first.opportunity.context.at(-1)?.sequence;
  const next = detectTrigger(replayed, { afterSequence: consumed });
}
```

`afterSequence` skips already consumed utterances while retaining their
bounded context for the next opportunity, so the same trigger is not returned
again. The detector is provider-neutral, synchronous, deterministic, and does
not call Tableau, an LLM, a network service, or a persistence layer. The
fixture cases are in
[`fixtures/triggers/cases.json`](../../fixtures/triggers/cases.json), including
casual and borderline statements that should be ignored.
