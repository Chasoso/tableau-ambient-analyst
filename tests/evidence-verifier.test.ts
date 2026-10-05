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
  hasAggregateEvidence: true,
  hasWorkbookLevelEvidence: false,
  fixedHypothesisScope: false,
  hasFixtureRankingContract: false,
  topWorkbook: null,
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
    expect(verifyEmptyRecovery([queryEvidence(1)], supported).ok).toBe(false);
    expect(
      verifyEmptyRecovery(
        [queryEvidence(0), { ...queryEvidence(1), error: 'MCP tool returned an error.' }],
        supported,
      ).ok,
    ).toBe(false);
  });

  it('requires hypothesis revision and can check a reported fixture rank', () => {
    expect(
      verifyHypothesisOutcome(
        {
          ...supported,
          outcome: 'rejected',
          hypothesis_state: 'rejected',
          reported_rank_1: 'rank-1',
        },
        'rank-1',
        undefined,
        [
          {
            ...queryEvidence(1),
            fixedHypothesisScope: true,
            hasFixtureRankingContract: true,
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
            hasFixtureRankingContract: true,
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
          reported_rank_1: 'rank-1',
        },
        'rank-1',
        undefined,
        [{ ...queryEvidence(1), hasFixtureRankingContract: true, topWorkbook: 'rank-1' }],
      ).ok,
    ).toBe(false);
    expect(
      verifyHypothesisOutcome(
        {
          ...supported,
          outcome: 'rejected',
          hypothesis_state: 'rejected',
          reported_rank_1: 'rank-1',
        },
        'rank-1',
        undefined,
        [],
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
            hasFixtureRankingContract: true,
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
    expect(
      verifyInsufficientEvidence([queryEvidence(1)], {
        outcome: 'insufficient-evidence',
        summary: 'External evidence is missing.',
        evidence_complete: true,
        missing_evidence: ['external-cause'],
        hypothesis_state: 'not-applicable',
        stop_reason: 'sufficient-evidence',
      }).ok,
    ).toBe(false);
  });

  it('requires observed follow-up evidence for incomplete exploration', () => {
    expect(
      verifyIncompleteExploration(
        [queryEvidence(2), { ...queryEvidence(3), hasWorkbookLevelEvidence: true }],
        {
          ...supported,
          outcome: 'supported',
        },
      ).ok,
    ).toBe(true);
    expect(verifyIncompleteExploration([queryEvidence(2)], supported).ok).toBe(false);
    expect(
      verifyIncompleteExploration(
        [
          { ...queryEvidence(2), hasWorkbookLevelEvidence: true },
          { ...queryEvidence(3), hasWorkbookLevelEvidence: true },
        ],
        supported,
      ).ok,
    ).toBe(false);
    expect(
      verifyIncompleteExploration(
        [queryEvidence(2), { ...queryEvidence(3), hasWorkbookLevelEvidence: false }],
        supported,
      ).ok,
    ).toBe(false);
    expect(
      verifyIncompleteExploration(
        [
          { ...queryEvidence(2), hasWorkbookLevelEvidence: true },
          queryEvidence(3),
          { ...queryEvidence(4), hasWorkbookLevelEvidence: true },
        ],
        supported,
      ).ok,
    ).toBe(false);
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

  it('rejects unapproved-tool evidence and insufficient outcomes without an external gap', () => {
    const insufficient = {
      outcome: 'insufficient-evidence' as const,
      summary: 'Causal evidence is unavailable.',
      evidence_complete: false,
      missing_evidence: ['unknown source'],
      hypothesis_state: 'not-applicable' as const,
      stop_reason: 'insufficient-evidence' as const,
    };
    expect(
      verifyInsufficientEvidence(
        [{ ...queryEvidence(1), mcpTool: 'unapproved-tool' }],
        insufficient,
      ).ok,
    ).toBe(false);
    expect(verifyInsufficientEvidence([queryEvidence(1)], insufficient).ok).toBe(false);
  });
});
