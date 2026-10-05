import type { StdioCallSummary } from './tableau-stdio-bridge.js';
import type { StructuredOutcome } from './response-telemetry.js';
import { stdioDatasourceLuid } from './stdio-bridge-policy.js';
import { hypothesisFixture } from './measured-case-setup.js';

export type EvidenceVerification = {
  ok: boolean;
  reasons: string[];
};

function verifyOutcomeShape(outcome: StructuredOutcome): string[] {
  const reasons: string[] = [];
  if (typeof outcome.summary !== 'string' || outcome.summary.trim().length === 0) {
    reasons.push('structured outcome summary is required');
  }
  if (!Array.isArray(outcome.missing_evidence)) {
    reasons.push('structured outcome missing_evidence must be an array');
    return reasons;
  }
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
  if (
    (outcome.outcome === 'supported' ||
      outcome.outcome === 'revised' ||
      outcome.outcome === 'rejected') &&
    outcome.stop_reason !== 'sufficient-evidence'
  ) {
    reasons.push('conclusive outcomes must use the sufficient-evidence stop reason');
  }
  if (outcome.evidence_complete && outcome.missing_evidence.length > 0) {
    reasons.push('evidence-complete outcomes cannot list missing evidence');
  }
  return reasons;
}

type EvidenceCall = Pick<StdioCallSummary, 'mcpTool' | 'rowCount' | 'error' | 'datasourceLuid'>;

type QueryEvidenceCall = EvidenceCall &
  Pick<
    StdioCallSummary,
    | 'hasWorkbookLevelEvidence'
    | 'observedFieldNames'
    | 'fixedHypothesisScope'
    | 'hasFixtureRankingContract'
    | 'topWorkbook'
    | 'queryContract'
  >;

function isApprovedSuccessfulQuery(call: EvidenceCall): boolean {
  return (
    call.mcpTool === 'query-datasource' &&
    call.datasourceLuid === stdioDatasourceLuid &&
    call.rowCount !== null &&
    call.error === null
  );
}

function hasSumDailyViewCount(call: QueryEvidenceCall): boolean {
  return (
    call.queryContract?.fields.some(
      (field) => field.fieldCaption === 'Daily View Count' && field.function === 'SUM',
    ) ?? false
  );
}

function hasWorkbookBreakdown(call: QueryEvidenceCall): boolean {
  return (
    (call.queryContract?.fields.some((field) => field.fieldCaption === 'Workbook Title') ??
      false) &&
    call.hasWorkbookLevelEvidence &&
    call.observedFieldNames.some((field) => field === 'Workbook Title' || field === 'workbookTitle')
  );
}

function hasMonthLevelTrend(call: QueryEvidenceCall): boolean {
  return (
    call.queryContract?.fields.some(
      (field) =>
        field.fieldCaption === 'Month' ||
        /month/i.test(field.fieldCaption) ||
        field.function === 'MONTH' ||
        field.function === 'TRUNC_MONTH',
    ) ?? false
  );
}

function hasFutureDateFixture(call: QueryEvidenceCall): boolean {
  return (
    call.queryContract?.filters.some(
      (filter) =>
        filter.fieldCaption === 'Metric Date Time (JST)' && filter.minDate === '2099-01-01',
    ) ?? false
  );
}

function hasHypothesisFixtureRanking(call: QueryEvidenceCall): boolean {
  const fields = call.queryContract?.fields ?? [];
  const filters = call.queryContract?.filters ?? [];
  return (
    fields.some((field) => field.fieldCaption === hypothesisFixture.grouping) &&
    fields.some(
      (field) =>
        field.fieldCaption === hypothesisFixture.measure &&
        field.function === 'SUM' &&
        field.sortDirection === hypothesisFixture.sortDirection &&
        field.sortPriority === hypothesisFixture.sortPriority,
    ) &&
    filters.some(
      (filter) =>
        filter.fieldCaption === hypothesisFixture.dateField &&
        filter.minDate === hypothesisFixture.lowerBound &&
        filter.maxDate === hypothesisFixture.upperBoundExclusive,
    )
  );
}

function hasRelevantPerformanceEvidence(call: QueryEvidenceCall): boolean {
  return (
    hasSumDailyViewCount(call) &&
    (call.queryContract?.fields.some(
      (field) =>
        field.fieldCaption === 'Workbook Title' || field.fieldCaption === 'Metric Date Time (JST)',
    ) ??
      false)
  );
}

export function verifyStructuredOutcome(outcome: StructuredOutcome | null): EvidenceVerification {
  if (outcome === null) return { ok: false, reasons: ['structured outcome is missing or invalid'] };
  const reasons = verifyOutcomeShape(outcome);
  return { ok: reasons.length === 0, reasons };
}

export function verifyEmptyRecovery(
  calls: readonly QueryEvidenceCall[],
  outcome: StructuredOutcome | null,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  const queryCalls = calls.filter(isApprovedSuccessfulQuery);
  const emptyIndex = queryCalls.findIndex(
    (call) => call.rowCount === 0 && hasFutureDateFixture(call) && hasSumDailyViewCount(call),
  );
  if (emptyIndex < 0) reasons.push('no successful future-date fixture zero-row query was observed');
  if (
    emptyIndex >= 0 &&
    !queryCalls
      .slice(emptyIndex + 1)
      .some(
        (call) =>
          (call.rowCount ?? 0) > 0 && hasSumDailyViewCount(call) && !hasFutureDateFixture(call),
      )
  ) {
    reasons.push('no relevant non-empty recovery evidence was observed after the empty query');
  }
  if (outcome?.outcome !== 'supported')
    reasons.push('empty recovery must produce a supported outcome');
  return { ok: reasons.length === 0, reasons };
}

export function verifyIncompleteExploration(
  calls: readonly QueryEvidenceCall[],
  outcome: StructuredOutcome | null,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  const queryCalls = calls.filter(isApprovedSuccessfulQuery);
  const initialCall = queryCalls[0];
  if (
    initialCall === undefined ||
    initialCall.rowCount === null ||
    initialCall.rowCount < 1 ||
    !hasMonthLevelTrend(initialCall) ||
    !hasSumDailyViewCount(initialCall)
  ) {
    reasons.push('no successful non-empty initial aggregate evidence was observed');
  }
  if (initialCall?.hasWorkbookLevelEvidence) {
    reasons.push('initial aggregate evidence already contained workbook-level evidence');
  }
  if (
    initialCall !== undefined &&
    !queryCalls
      .slice(1)
      .some(
        (call) =>
          (call.rowCount ?? 0) > 0 && hasSumDailyViewCount(call) && hasWorkbookBreakdown(call),
      )
  ) {
    reasons.push('no successful non-empty returned workbook-level follow-up evidence was observed');
  }
  if (outcome?.evidence_complete !== true)
    reasons.push('required follow-up evidence is incomplete');
  if (outcome?.outcome === 'insufficient-evidence')
    reasons.push('case did not reach a supported conclusion');
  return { ok: reasons.length === 0, reasons };
}

export function verifyHypothesisOutcome(
  outcome: StructuredOutcome | null,
  expectedRank1: string,
  reportedRank1?: string,
  calls: readonly Pick<
    StdioCallSummary,
    | 'mcpTool'
    | 'rowCount'
    | 'error'
    | 'datasourceLuid'
    | 'fixedHypothesisScope'
    | 'hasFixtureRankingContract'
    | 'topWorkbook'
    | 'queryContract'
    | 'hasWorkbookLevelEvidence'
    | 'observedFieldNames'
  >[] = [],
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  if (!calls.some((call) => isApprovedSuccessfulQuery(call))) {
    reasons.push('no successful ranking query evidence was observed');
  }
  if (
    !calls.some(
      (call) =>
        isApprovedSuccessfulQuery(call) &&
        call.fixedHypothesisScope &&
        call.hasFixtureRankingContract &&
        hasHypothesisFixtureRanking(call) &&
        call.topWorkbook !== null,
    )
  ) {
    reasons.push('no successful fixed-scope ranking result was observed');
  } else {
    const rankingCall = calls.find(
      (call) =>
        isApprovedSuccessfulQuery(call) &&
        call.fixedHypothesisScope &&
        call.hasFixtureRankingContract &&
        hasHypothesisFixtureRanking(call) &&
        call.topWorkbook !== null,
    );
    if (rankingCall?.topWorkbook !== expectedRank1) {
      reasons.push('observed fixed-scope rank 1 does not match the verified fixture');
    }
  }
  if (outcome?.hypothesis_state !== 'revised' && outcome?.hypothesis_state !== 'rejected') {
    reasons.push('hypothesis outcome must be revised or rejected');
  }
  const observedReportedRank1 = outcome?.reported_rank_1 ?? reportedRank1;
  if (observedReportedRank1 !== expectedRank1) {
    reasons.push('reported rank 1 does not match the verified fixture');
  }
  return { ok: reasons.length === 0, reasons };
}

export function verifyInsufficientEvidence(
  calls: readonly QueryEvidenceCall[],
  outcome: StructuredOutcome | null,
): EvidenceVerification {
  const reasons = verifyStructuredOutcome(outcome).reasons;
  if (
    !calls.some(
      (call) =>
        isApprovedSuccessfulQuery(call) &&
        (call.rowCount ?? 0) > 0 &&
        hasRelevantPerformanceEvidence(call),
    )
  ) {
    reasons.push('no successful relevant Tableau performance evidence was observed');
  }
  if (outcome?.outcome !== 'insufficient-evidence') {
    reasons.push('outcome must be insufficient-evidence');
  }
  if (
    !outcome?.missing_evidence.some((item) =>
      /external|referral|social|campaign|search|attribution|event/i.test(item),
    )
  ) {
    reasons.push('insufficient-evidence must identify a missing external causal evidence source');
  }
  return { ok: reasons.length === 0, reasons };
}
