import { describe, expect, it } from 'vitest';
import type { AnalyzeOpportunity } from '../src/trigger/detector.js';
import { decideIntervention } from '../src/intervention/policy.js';

const decisionOpportunity: AnalyzeOpportunity = {
  claim: 'We should launch next week.',
  reason: 'assumption-based-decision',
  context: [
    { sequence: 0, speaker: 'A', text: 'Assuming demand will stay high.' },
    { sequence: 1, speaker: 'B', text: 'We should launch next week.' },
  ],
};

const verification = (
  completion: 'COMPLETE' | 'INSUFFICIENT',
  status: 'supported' | 'contradicted' | 'unresolved',
) => ({
  completion,
  questionStatus: [{ questionId: 'decision-assumption-support', status }],
  unresolvedRequiredEvidence: completion === 'COMPLETE' ? [] : ['decision-assumption-support'],
  reasons: completion === 'COMPLETE' ? [] : ['required evidence is unresolved'],
});

describe('intervention policy', () => {
  it('intervenes when verified evidence contradicts an active decision assumption', () => {
    expect(
      decideIntervention(decisionOpportunity, verification('COMPLETE', 'contradicted')),
    ).toEqual({
      decision: 'INTERVENE',
      reason: 'Verified evidence contradicts the assumption underlying an active decision.',
    });
  });

  it.each([
    ['incomplete evidence', verification('INSUFFICIENT', 'unresolved')],
    ['supported low-impact confirmation', verification('COMPLETE', 'supported')],
  ] as const)('holds for %s', (_description, state) => {
    expect(decideIntervention(decisionOpportunity, state).decision).toBe('HOLD');
  });

  it('holds when a non-decision opportunity has contradicted evidence', () => {
    const numericalOpportunity: AnalyzeOpportunity = {
      ...decisionOpportunity,
      claim: 'Revenue is falling.',
      reason: 'numerical-claim',
    };

    expect(
      decideIntervention(numericalOpportunity, verification('COMPLETE', 'contradicted')),
    ).toEqual({
      decision: 'HOLD',
      reason:
        'Evidence is complete without a decision-relevant contradiction requiring intervention.',
    });
  });

  it.each([
    ['malformed verification', { completion: 'COMPLETE', questionStatus: [{ questionId: 'bad' }] }],
    [
      'inconsistent complete verification',
      {
        ...verification('COMPLETE', 'contradicted'),
        unresolvedRequiredEvidence: ['decision-assumption-support'],
      },
    ],
    [
      'complete verification with an unresolved sibling',
      {
        ...verification('COMPLETE', 'contradicted'),
        questionStatus: [
          { questionId: 'decision-assumption-support', status: 'contradicted' },
          { questionId: 'other-required-question', status: 'unresolved' },
        ],
      },
    ],
    [
      'duplicate question status',
      {
        ...verification('COMPLETE', 'contradicted'),
        questionStatus: [
          { questionId: 'decision-assumption-support', status: 'contradicted' },
          { questionId: 'decision-assumption-support', status: 'supported' },
        ],
      },
    ],
    [
      'unsupported verification field',
      { ...verification('COMPLETE', 'contradicted'), extra: 'unexpected' },
    ],
    ['missing verification', undefined],
  ])('holds for %s', (_description, state) => {
    expect(decideIntervention(decisionOpportunity, state).decision).toBe('HOLD');
  });
});
