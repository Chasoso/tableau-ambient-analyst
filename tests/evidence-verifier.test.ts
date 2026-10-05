import { describe, expect, it } from 'vitest';

import {
  verifyEmptyRecovery,
  verifyHypothesisOutcome,
  verifyIncompleteExploration,
  verifyInsufficientEvidence,
  verifyStructuredOutcome,
} from '../src/spike/evidence-verifier.js';
import { stdioOperationTimeoutMs } from '../src/spike/operation-timeout.js';
import { stdioDatasourceLuid } from '../src/spike/stdio-bridge-policy.js';

const supported = {
  outcome: 'supported' as const,
  summary: 'Evidence supports the result.',
  evidence_complete: true,
  missing_evidence: [],
  hypothesis_state: 'not-applicable' as const,
  stop_reason: 'sufficient-evidence' as const,
};

const queryEvidence = (rowCount: number) => ({
  mcpTool: 'query-datasource' as const,
  datasourceLuid: stdioDatasourceLuid,
  rowCount,
  error: null,
});

describe('evidence verifier', () => {
  it('keeps the live operation timeout bounded', () => {
    expect(stdioOperationTimeoutMs).toBe(10 * 60 * 1000);
  });
  it('rejects internally inconsistent structured outcomes', () => {
    expect(verifyStructuredOutcome({ ...supported, evidence_complete: false })).toMatchObject({
      ok: false,
    });
    expect(
      verifyStructuredOutcome({
        ...supported,
        outcome: 'insufficient-evidence',
        evidence_complete: true,
        missing_evidence: [],
        stop_reason: 'sufficient-evidence',
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifyStructuredOutcome({
        ...supported,
        stop_reason: 'tool-error',
      }),
    ).toMatchObject({ ok: false });
  });

  it('verifies empty-result recovery from observed tool summaries', () => {
    expect(verifyEmptyRecovery([queryEvidence(0), queryEvidence(1)], supported).ok).toBe(true);
    expect(verifyEmptyRecovery([queryEvidence(0)], supported).ok).toBe(false);
  });

  it('requires hypothesis revision and can check a reported fixture rank', () => {
    expect(
      verifyHypothesisOutcome(
        {
          ...supported,
          outcome: 'rejected',
          hypothesis_state: 'rejected',
        },
        'rank-1',
        undefined,
        [
          {
            ...queryEvidence(1),
            fixedHypothesisScope: true,
            topWorkbook: 'rank-1',
          },
        ],
      ).ok,
    ).toBe(true);
    expect(
      verifyHypothesisOutcome(
        {
          ...supported,
          outcome: 'rejected',
          hypothesis_state: 'rejected',
        },
        'rank-1',
        'other',
        [
          {
            ...queryEvidence(1),
            fixedHypothesisScope: true,
            topWorkbook: 'rank-1',
          },
        ],
      ).ok,
    ).toBe(false);
    expect(
      verifyHypothesisOutcome(
        {
          ...supported,
          outcome: 'rejected',
          hypothesis_state: 'rejected',
        },
        'rank-1',
        undefined,
        [
          {
            ...queryEvidence(1),
            fixedHypothesisScope: true,
            topWorkbook: 'other',
          },
        ],
      ).ok,
    ).toBe(false);
  });

  it('requires explicit missing evidence for insufficient-evidence', () => {
    expect(
      verifyInsufficientEvidence([queryEvidence(1)], {
        outcome: 'insufficient-evidence',
        summary: 'External evidence is missing.',
        evidence_complete: false,
        missing_evidence: ['external-cause'],
        hypothesis_state: 'not-applicable',
        stop_reason: 'insufficient-evidence',
      }).ok,
    ).toBe(true);
    expect(verifyInsufficientEvidence([], supported).ok).toBe(false);
  });

  it('requires observed follow-up evidence for incomplete exploration', () => {
    expect(
      verifyIncompleteExploration([queryEvidence(2), queryEvidence(3)], {
        ...supported,
        outcome: 'supported',
      }).ok,
    ).toBe(true);
  });

  it('rejects evidence that does not come from the allowed datasource', () => {
    expect(
      verifyInsufficientEvidence(
        [{ ...queryEvidence(1), datasourceLuid: 'outside-approved-boundary' }],
        {
          outcome: 'insufficient-evidence',
          summary: 'External evidence is missing.',
          evidence_complete: false,
          missing_evidence: ['external-cause'],
          hypothesis_state: 'not-applicable',
          stop_reason: 'insufficient-evidence',
        },
      ).ok,
    ).toBe(false);
  });
});
