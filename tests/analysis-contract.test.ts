import { describe, expect, it } from 'vitest';
import {
  analysisContractFromOpportunity,
  AnalysisContractError,
  validateAnalysisContract,
} from '../src/analysis/contract.js';
import type { AnalyzeOpportunity } from '../src/trigger/detector.js';

const opportunity = (reason: AnalyzeOpportunity['reason']): AnalyzeOpportunity => ({
  claim: 'The conversion rate is 20% higher.',
  reason,
  context: [{ sequence: 0, speaker: 'A', text: 'The conversion rate is 20% higher.' }],
});

describe('analysis contract', () => {
  it.each([
    ['numerical-claim', 'claim-value'],
    ['causal-hypothesis', 'cause-outcome-relationship'],
    ['assumption-based-decision', 'decision-assumption'],
    ['factual-disagreement', 'disputed-fact'],
  ] as const)('creates required evidence for a %s opportunity', (reason, firstQuestionId) => {
    const contract = analysisContractFromOpportunity(opportunity(reason));

    expect(contract.claim).toBe('The conversion rate is 20% higher.');
    expect(contract.requiredEvidence[0]?.id).toBe(firstQuestionId);
    expect(contract.requiredEvidence.length).toBeGreaterThan(0);
    expect(contract.optionalEvidence).toEqual([]);
    expect(contract.openQuestions).toEqual([]);
    expect(validateAnalysisContract(contract)).toEqual(contract);
  });

  it('keeps optional evidence and open questions distinct and extensible', () => {
    const contract = validateAnalysisContract({
      claim: 'The conversion rate is 20% higher.',
      requiredEvidence: [{ id: 'current-value', question: 'What is the current value?' }],
      optionalEvidence: [{ id: 'baseline-value', question: 'What is the baseline value?' }],
      openQuestions: [{ id: 'segment-question', question: 'Which segment differs?' }],
    });

    expect(contract.requiredEvidence).toHaveLength(1);
    expect(contract.optionalEvidence).toHaveLength(1);
    expect(contract.openQuestions).toHaveLength(1);
  });

  it.each([
    ['empty claim', { claim: ' ', requiredEvidence: [], optionalEvidence: [], openQuestions: [] }],
    [
      'missing required evidence',
      { claim: 'A claim', requiredEvidence: [], optionalEvidence: [], openQuestions: [] },
    ],
    [
      'unknown question field',
      {
        claim: 'A claim',
        requiredEvidence: [{ id: 'value', question: 'What is it?', extra: true }],
        optionalEvidence: [],
        openQuestions: [],
      },
    ],
    [
      'duplicate question IDs',
      {
        claim: 'A claim',
        requiredEvidence: [{ id: 'value', question: 'What is it?' }],
        optionalEvidence: [{ id: 'value', question: 'What else is it?' }],
        openQuestions: [],
      },
    ],
  ])('rejects %s', (_description, value) => {
    expect(() => validateAnalysisContract(value)).toThrow(AnalysisContractError);
  });

  it('rejects an insufficiently specific opportunity before creating a contract', () => {
    expect(() =>
      analysisContractFromOpportunity({
        claim: ' ',
        reason: 'numerical-claim',
        context: [],
      }),
    ).toThrow(AnalysisContractError);
  });

  it('does not encode a provider, tool sequence, or execution plan', () => {
    const serialized = JSON.stringify(
      analysisContractFromOpportunity(opportunity('causal-hypothesis')),
    );

    expect(serialized).not.toMatch(/tableau|mcp|query|filter|provider|tool/i);
  });
});
