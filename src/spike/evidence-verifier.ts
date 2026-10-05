import type { StdioCallSummary } from './tableau-stdio-bridge.js';
import type { StructuredOutcome } from './response-telemetry.js';

export type EvidenceVerification = {
  ok: boolean;
  reasons: string[];
};

function verifyOutcomeShape(outcome: StructuredOutcome): string[] {
  const reasons: string[] = [];
  if (outcome.outcome === 'insufficient-evidence') {
    if (outcome.evidence_complete)
      reasons.push('insufficient-evidence must not be evidence-complete');
    if (outcome.missing_evidence.length === 0) {
      reasons.push('insufficient-evidence must identify missing evidence');
    }
    if (outcome.stop_reason !== 'insufficient-evidence') {
      reasons.push('insufficient-evidence must use the insufficient-evidence stop reason');
    }
  }
  if (
    (outcome.outcome === 'supported' ||
      outcome.outcome === 'revised' ||
      outcome.outcome === 'rejected') &&
    !outcome.evidence_complete
  ) {
    reasons.push('conclusive outcomes must be evidence-complete');
  }
  if (outcome.evidence_complete && outcome.missing_evidence.length > 0) {
    reasons.push('evidence-complete outcomes cannot list missing evidence');
  }
  return reasons;
}

export function verifyStructuredOutcome(outcome: StructuredOutcome | null): EvidenceVerification {
  if (outcome === null) return { ok: false, reasons: ['structured outcome is missing or invalid'] };
  const reasons = verifyOutcomeShape(outcome);
  return { ok: reasons.length === 0, reasons };
}

export function verifyEmptyRecovery(
  calls: readonly Pick<StdioCallSummary, 'mcpTool' | 'rowCount' | 'error'>[],
  outcome: StructuredOutcome | null,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  const queryCalls = calls.filter((call) => call.mcpTool === 'query-datasource');
  const emptyIndex = queryCalls.findIndex((call) => call.rowCount === 0 && call.error === null);
  if (emptyIndex < 0) reasons.push('no successful zero-row query was observed');
  if (
    emptyIndex >= 0 &&
    !queryCalls.slice(emptyIndex + 1).some((call) => (call.rowCount ?? 0) > 0)
  ) {
    reasons.push('no non-empty follow-up evidence was observed after the empty query');
  }
  if (outcome?.outcome !== 'supported')
    reasons.push('empty recovery must produce a supported outcome');
  return { ok: reasons.length === 0, reasons };
}

export function verifyHypothesisOutcome(
  outcome: StructuredOutcome | null,
  expectedRank1: string,
  reportedRank1?: string,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  if (outcome?.hypothesis_state !== 'revised' && outcome?.hypothesis_state !== 'rejected') {
    reasons.push('hypothesis outcome must be revised or rejected');
  }
  if (reportedRank1 !== undefined && reportedRank1 !== expectedRank1) {
    reasons.push('reported rank 1 does not match the verified fixture');
  }
  return { ok: reasons.length === 0, reasons };
}

export function verifyInsufficientEvidence(
  outcome: StructuredOutcome | null,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  if (outcome?.outcome !== 'insufficient-evidence') {
    reasons.push('outcome must be insufficient-evidence');
  }
  return { ok: reasons.length === 0, reasons };
}
