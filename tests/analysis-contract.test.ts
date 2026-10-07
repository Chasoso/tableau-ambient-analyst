import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
  it('declares the same non-whitespace string boundary as the runtime validator', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../src/analysis/contract.schema.json', import.meta.url), 'utf8'),
    ) as {
      properties: { claim: { pattern: string } };
      $defs: {
        questions: { items: { properties: { question: { pattern: string } } } };
        context: { items: { required: string[]; additionalProperties: boolean } };
      };
      $comment: string;
    };

    expect(schema.properties.claim.pattern).toBe('.*\\S.*');
    expect(schema.$defs.questions.items.properties.question.pattern).toBe('.*\\S.*');
    expect(schema.$defs.context.items.required).toEqual(['sequence', 'speaker', 'text']);
    expect(schema.$defs.context.items.additionalProperties).toBe(false);
    expect(schema.$comment).toContain('question IDs to be unique across');
  });

  it.each([
    ['numerical-claim', 'claim-value', 0],
    ['causal-hypothesis', 'cause-outcome-relationship', 1],
    ['assumption-based-decision', 'decision-assumption-support', 0],
    ['factual-disagreement', 'disputed-fact', 0],
  ] as const)(
    'creates evidence questions for a %s opportunity',
    (reason, firstQuestionId, optionalCount) => {
      const contract = analysisContractFromOpportunity(opportunity(reason));

      expect(contract.claim).toBe('The conversion rate is 20% higher.');
      expect(contract.context).toEqual(opportunity(reason).context);
      expect(contract.requiredEvidence[0]?.id).toBe(firstQuestionId);
      expect(contract.requiredEvidence.length).toBeGreaterThan(0);
      expect(contract.optionalEvidence).toHaveLength(optionalCount);
      expect(contract.openQuestions).toEqual([]);
      expect(validateAnalysisContract(contract)).toEqual(contract);
    },
  );

  it('preserves the assumption and decision utterances in context', () => {
    const source: AnalyzeOpportunity = {
      claim: 'We should launch next week.',
      reason: 'assumption-based-decision',
      context: [
        { sequence: 0, speaker: 'A', text: 'Assuming demand will stay high.' },
        { sequence: 1, speaker: 'B', text: 'We should launch next week.' },
      ],
    };

    const contract = analysisContractFromOpportunity(source);

    expect(contract.context).toEqual(source.context);
    expect(contract.context.map(({ text }) => text)).toEqual([
      'Assuming demand will stay high.',
      'We should launch next week.',
    ]);
    expect(contract.requiredEvidence.map(({ id }) => id)).toEqual(['decision-assumption-support']);
  });

  it('preserves both sides of a factual disagreement in context', () => {
    const source: AnalyzeOpportunity = {
      claim: 'The report says 120.',
      reason: 'factual-disagreement',
      context: [
        { sequence: 0, speaker: 'A', text: 'The data says 80.' },
        { sequence: 1, speaker: 'B', text: 'The report says 120.' },
      ],
    };

    const contract = analysisContractFromOpportunity(source);

    expect(contract.context).toEqual(source.context);
    expect(contract.context.map(({ text }) => text)).toEqual([
      'The data says 80.',
      'The report says 120.',
    ]);
  });

  it('keeps optional evidence and open questions distinct and extensible', () => {
    const contract = validateAnalysisContract({
      claim: 'The conversion rate is 20% higher.',
      context: [{ sequence: 0, speaker: 'A', text: 'The conversion rate is 20% higher.' }],
      requiredEvidence: [{ id: 'current-value', question: 'What is the current value?' }],
      optionalEvidence: [{ id: 'baseline-value', question: 'What is the baseline value?' }],
      openQuestions: [{ id: 'segment-question', question: 'Which segment differs?' }],
    });

    expect(contract.requiredEvidence).toHaveLength(1);
    expect(contract.optionalEvidence).toHaveLength(1);
    expect(contract.openQuestions).toHaveLength(1);
  });

  it.each([
    [
      'empty claim',
      { claim: ' ', context: [], requiredEvidence: [], optionalEvidence: [], openQuestions: [] },
    ],
    [
      'missing required evidence',
      {
        claim: 'A claim',
        context: [{ sequence: 0, speaker: 'A', text: 'A claim' }],
        requiredEvidence: [],
        optionalEvidence: [],
        openQuestions: [],
      },
    ],
    [
      'unknown question field',
      {
        claim: 'A claim',
        context: [{ sequence: 0, speaker: 'A', text: 'A claim' }],
        requiredEvidence: [{ id: 'value', question: 'What is it?', extra: true }],
        optionalEvidence: [],
        openQuestions: [],
      },
    ],
    [
      'duplicate question IDs',
      {
        claim: 'A claim',
        context: [{ sequence: 0, speaker: 'A', text: 'A claim' }],
        requiredEvidence: [{ id: 'value', question: 'What is it?' }],
        optionalEvidence: [{ id: 'value', question: 'What else is it?' }],
        openQuestions: [],
      },
    ],
  ])('rejects %s', (_description, value) => {
    expect(() => validateAnalysisContract(value)).toThrow(AnalysisContractError);
  });

  it('rejects malformed context fields', () => {
    expect(() =>
      validateAnalysisContract({
        claim: 'A claim',
        context: [{ sequence: 0, speaker: 'A', text: 'A claim', timestamp: 'unexpected' }],
        requiredEvidence: [{ id: 'value', question: 'What is it?' }],
        optionalEvidence: [],
        openQuestions: [],
      }),
    ).toThrow(AnalysisContractError);
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
