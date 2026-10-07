# Transcript replay format

Issue #41 introduces a small, provider-neutral input contract for deterministic
meeting replay. It is intentionally text-only: audio capture, speech-to-text,
provider adapters, persistence, and external services are out of scope.

## JSONL

Use one JSON object per line. Blank lines are ignored. Each utterance must have
an integer `sequence`, a non-empty `speaker`, and non-empty `text`. `timestamp`
is optional metadata and, when present, must be a parseable date-time string.
Unknown fields are rejected so fixture changes remain easy to review.

```jsonl
{"sequence":0,"speaker":"Aki","text":"We should compare this month's result with the baseline."}
{"sequence":1,"speaker":"Morgan","text":"The current value is higher for the overall group."}
```

JSON array fixtures use the same objects and contract:

```json
[
  {"sequence":0,"speaker":"Aki","text":"Hello"},
  {"sequence":1,"speaker":"Morgan","text":"Hi"}
]
```

## Deterministic playback

`parseTranscriptFixture` accepts JSON or JSONL text and returns utterances
sorted by ascending `sequence`. Duplicate or invalid sequence values, missing
required fields, malformed JSON, invalid timestamps, and unknown fields fail
closed with `TranscriptFixtureError`. The parser does not perform network or
external operations, and replay does not mutate the input.

The domain-neutral example is
[`fixtures/replay/domain-neutral.jsonl`](../../fixtures/replay/domain-neutral.jsonl).
