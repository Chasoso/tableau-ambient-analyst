import { describe, expect, it } from 'vitest';

import { evaluationCases, requiredEvaluationCaseIds } from '../src/evaluation/cases.js';

const validOutcomeTypes = new Set(['supported', 'revised', 'rejected', 'insufficient-evidence']);

describe('domain-neutral evaluation cases', () => {
  it('includes every required case class', () => {
    const ids = new Set(evaluationCases.map((evaluationCase) => evaluationCase.id));

    for (const requiredId of requiredEvaluationCaseIds) {
      expect(ids.has(requiredId)).toBe(true);
    }
  });

  it('has a small suite with unique, stable IDs', () => {
    const ids = evaluationCases.map((evaluationCase) => evaluationCase.id);

    expect(evaluationCases.length).toBeGreaterThanOrEqual(7);
    expect(evaluationCases.length).toBeLessThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it('defines deterministic completion and evidence expectations', () => {
    for (const evaluationCase of evaluationCases) {
      expect(evaluationCase.title.length).toBeGreaterThan(0);
      expect(evaluationCase.analysisGoal.length).toBeGreaterThan(0);
      expect(evaluationCase.expectedChallenge.length).toBeGreaterThan(0);
      expect(evaluationCase.completionCondition.length).toBeGreaterThan(0);
      expect(validOutcomeTypes.has(evaluationCase.expectedOutcomeType)).toBe(true);
      expect(evaluationCase.fixture.responses.length).toBeGreaterThan(0);
      expect(evaluationCase.expectations.must.length).toBeGreaterThan(0);

      for (const evidence of evaluationCase.requiredEvidence) {
        expect(evidence.id.length).toBeGreaterThan(0);
        expect(evidence.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('represents all expected outcome types without provider-specific contracts', () => {
    const outcomes = new Set(
      evaluationCases.map((evaluationCase) => evaluationCase.expectedOutcomeType),
    );
    const serializedCases = JSON.stringify(evaluationCases).toLowerCase();

    expect(outcomes).toEqual(
      new Set(['supported', 'revised', 'rejected', 'insufficient-evidence']),
    );
    expect(serializedCases).not.toMatch(/openai|anthropic|bedrock|tableau|mcp/);
  });

  it('makes insufficient evidence and hypothesis disproof explicit', () => {
    const insufficient = evaluationCases.find(
      (evaluationCase) => evaluationCase.id === 'insufficient-evidence',
    );
    const disproved = evaluationCases.find(
      (evaluationCase) => evaluationCase.id === 'hypothesis-disproved',
    );

    expect(insufficient?.expectedOutcomeType).toBe('insufficient-evidence');
    expect(insufficient?.expectations.mustNot.some(({ kind }) => kind === 'best-guess')).toBe(true);
    expect(disproved?.expectedOutcomeType).toBe('rejected');
    expect(
      disproved?.expectations.must.some(({ kind }) => kind === 'reject-or-revise-hypothesis'),
    ).toBe(true);
  });
});
