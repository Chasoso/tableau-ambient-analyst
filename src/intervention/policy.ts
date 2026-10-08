import type { AnalysisContract } from '../analysis/contract.js';
import { validateAnalysisContract } from '../analysis/contract.js';
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
  if (Object.keys(record).some((key) => key !== 'questionId' && key !== 'status')) return false;
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
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'completion' &&
        key !== 'questionStatus' &&
        key !== 'unresolvedRequiredEvidence' &&
        key !== 'reasons',
    )
  ) {
    return false;
  }
  if (
    (record.completion === 'COMPLETE' || record.completion === 'INSUFFICIENT') &&
    Array.isArray(record.questionStatus) &&
    record.questionStatus.every(isEvidenceQuestionStatus) &&
    Array.isArray(record.unresolvedRequiredEvidence) &&
    record.unresolvedRequiredEvidence.every((questionId) => typeof questionId === 'string') &&
    Array.isArray(record.reasons) &&
    record.reasons.every((reason) => typeof reason === 'string') &&
    new Set(record.questionStatus.map(({ questionId }) => questionId)).size ===
      record.questionStatus.length &&
    new Set(record.unresolvedRequiredEvidence).size === record.unresolvedRequiredEvidence.length
  ) {
    if (record.completion === 'COMPLETE') {
      return (
        record.unresolvedRequiredEvidence.length === 0 &&
        record.reasons.length === 0 &&
        record.questionStatus.every(({ status }) => status !== 'unresolved')
      );
    }
    return true;
  }
  return false;
}

function isDecisionOpportunity(reason: TriggerReason): boolean {
  return reason === 'assumption-based-decision';
}

function hasMatchingAnalysisChain(
  opportunity: AnalyzeOpportunity,
  contract: AnalysisContract,
  verification: EvidenceVerificationResult,
): boolean {
  try {
    validateAnalysisContract(contract);
  } catch {
    return false;
  }
  if (opportunity.claim !== contract.claim) return false;
  if (
    isDecisionOpportunity(opportunity.reason) &&
    !contract.requiredEvidence.some(({ id }) => id === assumptionSupportQuestionId)
  ) {
    return false;
  }

  const requiredIds = contract.requiredEvidence.map(({ id }) => id);
  const verifiedIds = verification.questionStatus.map(({ questionId }) => questionId);
  return (
    requiredIds.length === verifiedIds.length &&
    requiredIds.every((questionId) => verifiedIds.includes(questionId))
  );
}

/**
 * Applies the first conservative intervention policy. It consumes only the
 * detected opportunity and a verifier result; it never chooses tools or
 * performs another analysis.
 */
export function decideIntervention(
  opportunity: AnalyzeOpportunity,
  contract: AnalysisContract,
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

  if (!hasMatchingAnalysisChain(opportunity, contract, verification)) {
    return {
      decision: 'HOLD',
      reason: 'Evidence verification does not match the analysis contract.',
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
