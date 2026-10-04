import { describe, expect, it } from 'vitest';

import {
  measuredCaseIds,
  measuredCaseSetups,
  validateMeasuredCaseSetup,
} from '../src/spike/measured-case-setup.js';

describe('measured case setup contract', () => {
  it('freezes exactly the four approved measured cases', () => {
    expect(measuredCaseIds).toEqual([
      'incomplete-first-result',
      'empty-result-recovery',
      'hypothesis-disproved',
      'insufficient-evidence',
    ]);
  });

  it('requires every case to leave evidence incomplete after query one', () => {
    for (const setup of measuredCaseSetups) {
      expect(validateMeasuredCaseSetup(setup)).toEqual([]);
      expect(setup.missingEvidenceAfterQueryOne.length).toBeGreaterThan(0);
      const queryOneEvidence = new Set(setup.queryOneExpectedEvidence);
      expect(setup.missingEvidenceAfterQueryOne.some((id) => queryOneEvidence.has(id))).toBe(false);
    }
  });

  it('rejects a setup that can conclude after the first query', () => {
    const setup = measuredCaseSetups[0];
    expect(setup).toBeDefined();
    expect(
      validateMeasuredCaseSetup({
        ...setup!,
        missingEvidenceAfterQueryOne: [],
      }),
    ).toContain('query one must leave required evidence incomplete');
  });
});
