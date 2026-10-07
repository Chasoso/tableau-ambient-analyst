import type { AnalyzeOpportunity, TriggerReason } from '../trigger/detector.js';
import type {
  EvidenceQuestionStatus,
  EvidenceVerificationResult,
} from '../analysis/evidence-verifier.js';

export type InterventionDecision = 'INTERVENE' | 'HOLD';

export type InterventionResult = {
  decision: InterventionDecision;
  reason: string;
};

const assumptionSupportQuestionId = 'decision-assumption-support';

function isEvidenceQuestionStatus(value: unknown): value is EvidenceQuestionStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.questionId === 'string' &&
    (record.status === 'supported' ||
      record.status === 'contradicted' ||
      record.status === 'unresolved')
  );
}

function hasUsableVerificationState(value: unknown): value is EvidenceVerificationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.completion === 'COMPLETE' || record.completion === 'INSUFFICIENT') &&
    Array.isArray(record.questionStatus) &&
    record.questionStatus.every(isEvidenceQuestionStatus) &&
    Array.isArray(record.unresolvedRequiredEvidence) &&
    record.unresolvedRequiredEvidence.every((questionId) => typeof questionId === 'string') &&
    Array.isArray(record.reasons) &&
    record.reasons.every((reason) => typeof reason === 'string') &&
    (record.completion !== 'COMPLETE' ||
      (record.unresolvedRequiredEvidence.length === 0 && record.reasons.length === 0))
  );
}

function isDecisionOpportunity(reason: TriggerReason): boolean {
  return reason === 'assumption-based-decision';
}

/**
 * Applies the first conservative intervention policy. It consumes only the
 * detected opportunity and a verifier result; it never chooses tools or
 * performs another analysis.
 */
export function decideIntervention(
  opportunity: AnalyzeOpportunity,
  verification: unknown,
): InterventionResult {
  if (!hasUsableVerificationState(verification)) {
    return {
      decision: 'HOLD',
      reason: 'Evidence verification state is malformed or unavailable.',
    };
  }

  if (verification.completion !== 'COMPLETE') {
    return {
      decision: 'HOLD',
      reason: 'Required evidence is incomplete or invalid.',
    };
  }

  const assumptionStatus = verification.questionStatus.find(
    ({ questionId }) => questionId === assumptionSupportQuestionId,
  );
  if (isDecisionOpportunity(opportunity.reason) && assumptionStatus?.status === 'contradicted') {
    return {
      decision: 'INTERVENE',
      reason: 'Verified evidence contradicts the assumption underlying an active decision.',
    };
  }

  return {
    decision: 'HOLD',
    reason:
      'Evidence is complete without a decision-relevant contradiction requiring intervention.',
  };
}
