import { describe, expect, it } from 'vitest';

import {
  verifyEmptyRecovery,
  verifyHypothesisOutcome,
  verifyIncompleteExploration,
  verifyInsufficientEvidence,
  verifyStructuredOutcome,
} from '../src/spike/evidence-verifier.js';
import { stdioOperationTimeoutMs } from '../src/spike/operation-timeout.js';

const supported = {
  outcome: 'supported' as const,
  summary: 'Evidence supports the result.',
  evidence_complete: true,
  missing_evidence: [],
  hypothesis_state: 'not-applicable' as const,
  stop_reason: 'sufficient-evidence' as const,
};

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
  });

  it('verifies empty-result recovery from observed tool summaries', () => {
    expect(
      verifyEmptyRecovery(
        [
          { mcpTool: 'query-datasource', rowCount: 0, error: null },
          { mcpTool: 'query-datasource', rowCount: 1, error: null },
        ],
        supported,
      ).ok,
    ).toBe(true);
    expect(
      verifyEmptyRecovery([{ mcpTool: 'query-datasource', rowCount: 0, error: null }], supported)
        .ok,
    ).toBe(false);
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
        [{ mcpTool: 'query-datasource', rowCount: 1, error: null }],
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
        [{ mcpTool: 'query-datasource', rowCount: 1, error: null }],
      ).ok,
    ).toBe(false);
  });

  it('requires explicit missing evidence for insufficient-evidence', () => {
    expect(
      verifyInsufficientEvidence([{ mcpTool: 'query-datasource', rowCount: 1, error: null }], {
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
      verifyIncompleteExploration(
        [
          { mcpTool: 'query-datasource', rowCount: 2, error: null },
          { mcpTool: 'query-datasource', rowCount: 3, error: null },
        ],
        { ...supported, outcome: 'supported' },
      ).ok,
    ).toBe(true);
  });
});
