export const reviewResults = ['PASS', 'CHANGES_REQUIRED', 'HUMAN_DECISION_REQUIRED'] as const;
export const findingClassifications = ['AUTO_FIX', 'HUMAN_DECISION_REQUIRED', 'BLOCKED'] as const;
export const maxReviewInvocations = 16;
export const maxAutoFixCycles = 8;
export const repeatedRuleThreshold = 3;
export const maintainabilityResults = [
  'NO_DRIFT',
  'LOCAL_CLEANUP',
  'FOLLOW_UP_MAINTENANCE',
] as const;
/** @deprecated Use maxReviewInvocations. */
export const maxReviewCycles = maxReviewInvocations;

export type ReviewResultName = (typeof reviewResults)[number];
export type FindingClassification = (typeof findingClassifications)[number];
export type MaintainabilityResult = (typeof maintainabilityResults)[number];

export type ReviewFinding = {
  severity: 'blocking' | 'non-blocking';
  classification: FindingClassification;
  finding: string;
  generalized_rule: string;
  affected_locations: string[];
  recommended_fix: string;
};

export type ReviewFindingValue = string | ReviewFinding;

export const terminationReasons = [
  'MAX_AUTO_FIX_CYCLES',
  'MAX_REVIEW_INVOCATIONS',
  'NON_CONVERGING_REVIEW',
  'NO_PROGRESS',
  'HUMAN_DECISION_REQUIRED',
  'BLOCKED',
  'REVIEWER_FAILURE',
] as const;
export type TerminationReason = (typeof terminationReasons)[number];

export const reviewRecoveryReasons = [
  'AUTO_FIX_IMPLEMENTER_SELF_REVIEW_BLOCKED',
  'LEGACY_AUTO_FIX_SELF_REVIEW_BLOCKED',
] as const;
export type ReviewRecoveryReason = (typeof reviewRecoveryReasons)[number];

export type ReviewTerminationEvidence = {
  recoveryReason: ReviewRecoveryReason;
  recoveryEvidence: string;
};

export const reviewRecoveryHumanDecisions = ['resume'] as const;
export type ReviewRecoveryHumanDecision = (typeof reviewRecoveryHumanDecisions)[number];
export type ReviewTerminationRecovery = ReviewTerminationEvidence & {
  humanDecision: ReviewRecoveryHumanDecision;
};

export type ReviewCycleRecord = {
  reviewInvocation: number;
  result: ReviewResultName;
  maintainability: MaintainabilityResult;
  classifications: FindingClassification[];
  generalizedRules: string[];
  findingIdentities?: string[];
  repositoryChanged: boolean | null;
};

export type ReviewEpochHistory = {
  reviewEpoch: number;
  accountingEpochStart: string;
  legacyReviewInvocations: number;
  legacyAutoFixCycles: number;
  reviewInvocationCount: number;
  autoFixCycleCount: number;
  generalizedRuleHistory: string[];
  consecutiveRepeatCount: number;
  lastFixChangedRepository: boolean | null;
  cycleResults: ReviewCycleRecord[];
  terminationHistory: TerminationReason[];
  terminationReason: TerminationReason;
  resumedAt: string;
  authorizedByHuman: true;
  authorizationSource: 'human-explicit';
  approvalId: string;
  approvedAt: string;
  resumeAfterPolicyChange?: string | undefined;
  migrationCompatibility?: string | undefined;
  terminationEvidence?: ReviewTerminationEvidence | undefined;
  recoveryReason?: ReviewRecoveryReason | undefined;
  recoveryEvidence?: string | undefined;
};

export type ReviewResumeApproval = {
  id: string;
  approvalType: 'review-limit-resume' | 'review-termination-recovery';
  targetRepository: 'Chasoso/tableau-ambient-analyst';
  branch: string;
  base: string;
  reviewEpoch: number;
  exhaustedReviewInvocationCount: number;
  approvedAt: string;
  authorizationSource: 'human-explicit';
  consumed: boolean;
  headSha: string;
  consumedAt?: string | undefined;
  originalTerminationReason?: 'BLOCKED' | 'NO_PROGRESS' | undefined;
  recoveryReason?: ReviewRecoveryReason | undefined;
  recoveryEvidence?: string | undefined;
  humanDecision?: ReviewRecoveryHumanDecision | undefined;
};

export type ReviewAccounting = {
  legacyReviewInvocations: number;
  legacyAutoFixCycles: number;
  accountingEpochStart: string;
  reviewInvocationCount: number;
  autoFixCycleCount: number;
  generalizedRuleHistory: string[];
  consecutiveRepeatCount: number;
  lastFixChangedRepository: boolean | null;
  cycleResults: ReviewCycleRecord[];
  terminationHistory?: TerminationReason[];
  resumeAfterPolicyChange?: string | undefined;
  migrationCompatibility?: string | undefined;
  terminationReason?: TerminationReason | undefined;
  reviewEpoch?: number | undefined;
  reviewHistory?: ReviewEpochHistory[] | undefined;
  resumeAuthorizedAt?: string | undefined;
  resumeAuthorizationSource?: 'human-explicit' | undefined;
  resumedFromEpoch?: number | undefined;
  terminationEvidence?: ReviewTerminationEvidence | undefined;
};

export type ReviewGateResult = {
  result: ReviewResultName;
  blockingFindings: ReviewFindingValue[];
  nonBlockingFindings: ReviewFindingValue[];
  escalationRequired: boolean;
  executionStatus?: 'COMPLETED' | 'FAILED';
  executionPhase?: 'PRE_REVIEW' | 'VALIDATION' | 'REVIEW';
  accounting?: ReviewAccounting;
  terminationReason?: TerminationReason;
  maintainability?: MaintainabilityResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFindingClassification = (value: unknown): value is FindingClassification =>
  typeof value === 'string' && findingClassifications.includes(value as FindingClassification);

const isReviewFinding = (value: unknown): value is ReviewFinding => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const finding = value as Record<string, unknown>;
  return (
    (finding.severity === 'blocking' || finding.severity === 'non-blocking') &&
    isFindingClassification(finding.classification) &&
    typeof finding.finding === 'string' &&
    typeof finding.generalized_rule === 'string' &&
    Array.isArray(finding.affected_locations) &&
    finding.affected_locations.every((location) => typeof location === 'string') &&
    typeof finding.recommended_fix === 'string'
  );
};

const isFindingArray = (value: unknown): value is ReviewFindingValue[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' || isReviewFinding(item));

const isReviewResultName = (value: unknown): value is ReviewResultName =>
  typeof value === 'string' && reviewResults.includes(value as ReviewResultName);

export function parseReviewResult(raw: string): ReviewGateResult {
  let value: unknown;

  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return malformedResult('Reviewer output was not valid JSON.');
  }

  if (!isRecord(value)) {
    return malformedResult('Reviewer output was not a JSON object.');
  }

  const { result, blockingFindings, nonBlockingFindings, escalationRequired, maintainability } =
    value;
  const allowedKeys = new Set([
    'result',
    'blockingFindings',
    'nonBlockingFindings',
    'escalationRequired',
    'maintainability',
  ]);

  if (
    !isReviewResultName(result) ||
    !isFindingArray(blockingFindings) ||
    !isFindingArray(nonBlockingFindings) ||
    typeof escalationRequired !== 'boolean' ||
    typeof maintainability !== 'string' ||
    !maintainabilityResults.includes(maintainability as MaintainabilityResult) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    return malformedResult('Reviewer output did not match the gate result contract.');
  }

  if (result === 'PASS' && (blockingFindings.length > 0 || escalationRequired)) {
    return malformedResult('PASS cannot include blocking findings or escalation.');
  }

  if (
    blockingFindings.some(
      (finding) => typeof finding !== 'string' && finding.severity !== 'blocking',
    ) ||
    nonBlockingFindings.some(
      (finding) => typeof finding !== 'string' && finding.severity !== 'non-blocking',
    )
  ) {
    return malformedResult('Finding severity must match its result array.');
  }

  const allFindings = [...blockingFindings, ...nonBlockingFindings];
  const hasHumanFinding = allFindings.some(
    (finding) =>
      typeof finding !== 'string' &&
      (finding.classification === 'HUMAN_DECISION_REQUIRED' ||
        finding.classification === 'BLOCKED'),
  );

  if (result === 'HUMAN_DECISION_REQUIRED' && !escalationRequired) {
    return malformedResult('HUMAN_DECISION_REQUIRED must require escalation.');
  }

  if (hasHumanFinding && !escalationRequired) {
    return malformedResult('Human decision and blocked findings must require escalation.');
  }

  return {
    result,
    blockingFindings,
    nonBlockingFindings,
    escalationRequired,
    executionStatus: 'COMPLETED',
    executionPhase: 'REVIEW',
    maintainability: maintainability as MaintainabilityResult,
  };
}

export function reviewerInvocationFailure(
  message: string,
  executionPhase: 'PRE_REVIEW' | 'REVIEW' = 'PRE_REVIEW',
): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [
      structuredFinding(
        'blocking',
        'BLOCKED',
        message,
        'reviewer execution or prerequisite failure',
        [],
        'Provide the missing reviewer prerequisite or recover the reviewer process.',
      ),
    ],
    nonBlockingFindings: [],
    escalationRequired: true,
    executionStatus: 'FAILED',
    executionPhase,
  };
}

export function validationFailure(message: string): ReviewGateResult {
  return {
    result: 'CHANGES_REQUIRED',
    blockingFindings: [
      structuredFinding(
        'blocking',
        'AUTO_FIX',
        message,
        'deterministic validation must pass before review',
        [],
        'Fix the validation failure and rerun deterministic validation.',
      ),
    ],
    nonBlockingFindings: [],
    escalationRequired: false,
    executionPhase: 'VALIDATION',
  };
}

export function reviewCycleLimitExceeded(cycle: number): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [
      structuredFinding(
        'blocking',
        'BLOCKED',
        `Review invocation ${cycle} exceeds the maximum of ${maxReviewInvocations}.`,
        'bounded review execution must stop at its configured invocation limit',
        [],
        'Report the accounting and obtain an authorized continuation or scope decision.',
      ),
    ],
    nonBlockingFindings: [],
    escalationRequired: true,
    executionPhase: 'PRE_REVIEW',
    terminationReason: 'MAX_REVIEW_INVOCATIONS',
  };
}

export function terminationResult(
  reason: TerminationReason,
  accounting: ReviewAccounting,
  unresolvedFindings: ReviewFindingValue[] = [],
  message?: string,
): ReviewGateResult {
  const detail = message ?? terminationMessage(reason, accounting);
  const classification: FindingClassification =
    reason === 'HUMAN_DECISION_REQUIRED' ? 'HUMAN_DECISION_REQUIRED' : 'BLOCKED';
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [
      ...unresolvedFindings.map((finding) =>
        typeof finding === 'string'
          ? structuredFinding(
              'blocking',
              classification,
              finding,
              `termination/${reason}`,
              [],
              detail,
            )
          : finding,
      ),
      structuredFinding('blocking', classification, detail, `termination/${reason}`, [], detail),
    ],
    nonBlockingFindings: [],
    escalationRequired: true,
    accounting,
    terminationReason: reason,
  };
}

export function canOpenPullRequest(validationPassed: boolean, review: ReviewGateResult): boolean {
  return (
    validationPassed &&
    review.executionStatus === 'COMPLETED' &&
    review.result === 'PASS' &&
    review.blockingFindings.length === 0 &&
    !requiresHumanDecision(review)
  );
}

/** Continue automatically only when every blocking finding is explicitly deterministic. */
export function canContinueAutoFix(review: ReviewGateResult): boolean {
  return (
    review.result === 'CHANGES_REQUIRED' &&
    review.blockingFindings.length > 0 &&
    !review.escalationRequired &&
    review.blockingFindings.every(
      (finding) => typeof finding !== 'string' && finding.classification === 'AUTO_FIX',
    )
  );
}

export function normalizedFindingCategory(finding: ReviewFindingValue): string {
  const value = typeof finding === 'string' ? finding : finding.generalized_rule;
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findingClassificationsFor(findings: ReviewFindingValue[]): FindingClassification[] {
  return findings.flatMap((finding) =>
    typeof finding === 'string' ? [] : [finding.classification],
  );
}

function terminationMessage(reason: TerminationReason, accounting: ReviewAccounting): string {
  switch (reason) {
    case 'MAX_AUTO_FIX_CYCLES':
      return `AUTO_FIX cycle limit of ${maxAutoFixCycles} reached.`;
    case 'MAX_REVIEW_INVOCATIONS':
      return `Review invocation limit of ${maxReviewInvocations} reached.`;
    case 'NON_CONVERGING_REVIEW':
      return `The same generalized finding rule repeated ${accounting.consecutiveRepeatCount} times.`;
    case 'NO_PROGRESS':
      return 'AUTO_FIX reported success without a material repository change.';
    case 'BLOCKED':
      return 'A required execution prerequisite is unavailable.';
    case 'REVIEWER_FAILURE':
      return 'Independent reviewer execution failed.';
    case 'HUMAN_DECISION_REQUIRED':
      return 'A finding requires a human-owned decision.';
    default:
      return 'Review accounting state is invalid; human recovery is required.';
  }
}

function structuredFinding(
  severity: ReviewFinding['severity'],
  classification: FindingClassification,
  finding: string,
  generalized_rule: string,
  affected_locations: string[],
  recommended_fix: string,
): ReviewFinding {
  return {
    severity,
    classification,
    finding,
    generalized_rule,
    affected_locations,
    recommended_fix,
  };
}

export function requiresHumanDecision(review: ReviewGateResult): boolean {
  const findings = [...review.blockingFindings, ...review.nonBlockingFindings];
  return (
    review.escalationRequired ||
    findings.some(
      (finding) =>
        typeof finding !== 'string' &&
        (finding.classification === 'HUMAN_DECISION_REQUIRED' ||
          finding.classification === 'BLOCKED'),
    )
  );
}

function malformedResult(message: string): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [
      structuredFinding(
        'blocking',
        'BLOCKED',
        message,
        'review result must match the structured gate contract',
        [],
        'Fix the reviewer output or schema contract and rerun the independent review.',
      ),
    ],
    nonBlockingFindings: [],
    escalationRequired: true,
    executionStatus: 'FAILED',
  };
}
