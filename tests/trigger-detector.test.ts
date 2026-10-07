import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTranscriptFixture, type TranscriptUtterance } from '../src/replay/transcript.js';
import { detectTrigger, triggerDetector } from '../src/trigger/detector.js';

type TriggerCase = {
  id: string;
  utterances: TranscriptUtterance[];
  expected: { decision: 'ANALYZE' | 'IGNORE'; reason?: string };
};

const cases = JSON.parse(
  readFileSync(new URL('../fixtures/triggers/cases.json', import.meta.url), 'utf8'),
) as TriggerCase[];

describe('trigger detector', () => {
  it.each(cases)('$id produces the documented deterministic decision', (fixture) => {
    const utterances = parseTranscriptFixture(JSON.stringify(fixture.utterances));
    const result = detectTrigger(utterances);

    expect(result.decision).toBe(fixture.expected.decision);
    if (fixture.expected.reason !== undefined && result.decision === 'ANALYZE') {
      expect(result.opportunity.reason).toBe(fixture.expected.reason);
      expect(result.opportunity.claim).toBe(fixture.utterances[0]?.text);
    }
  });

  it('keeps the first analytical opportunity and a bounded audit context', () => {
    const utterances = parseTranscriptFixture(
      JSON.stringify([
        { sequence: 0, speaker: 'A', text: 'We are discussing the roadmap.' },
        { sequence: 1, speaker: 'B', text: 'The revenue is 20% higher.' },
        { sequence: 2, speaker: 'A', text: 'The data says otherwise.' },
      ]),
    );

    const result = detectTrigger(utterances);

    expect(result).toMatchObject({
      decision: 'ANALYZE',
      opportunity: {
        claim: 'The revenue is 20% higher.',
        reason: 'numerical-claim',
        context: [
          { sequence: 0, speaker: 'A' },
          { sequence: 1, speaker: 'B' },
        ],
      },
    });
  });

  it('returns auditable context for IGNORE and repeats deterministically', () => {
    const utterances = parseTranscriptFixture(
      JSON.stringify([
        { sequence: 0, speaker: 'A', text: 'Hello.' },
        { sequence: 1, speaker: 'B', text: 'Let us continue.' },
      ]),
    );

    const first = triggerDetector.detect(utterances);
    const second = detectTrigger(utterances);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      decision: 'IGNORE',
      reason: 'no-analytical-opportunity',
      context: [{ sequence: 0 }, { sequence: 1 }],
    });
  });

  it('does not mutate replayed input', () => {
    const utterances: TranscriptUtterance[] = [
      { sequence: 0, speaker: 'A', text: 'The metric is 10.' },
    ];
    const before = [...utterances];

    detectTrigger(utterances);

    expect(utterances).toEqual(before);
  });
});
