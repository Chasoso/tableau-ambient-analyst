export const reviewResults = ['PASS', 'CHANGES_REQUIRED', 'HUMAN_DECISION_REQUIRED'] as const;
export const findingClassifications = ['AUTO_FIX', 'HUMAN_DECISION_REQUIRED', 'BLOCKED'] as const;
export const maxReviewCycles = 6;

export type ReviewResultName = (typeof reviewResults)[number];
export type FindingClassification = (typeof findingClassifications)[number];

export type ReviewFinding = {
  severity: 'blocking' | 'non-blocking';
  classification: FindingClassification;
  finding: string;
  generalized_rule: string;
  affected_locations: string[];
  recommended_fix: string;
};

export type ReviewFindingValue = string | ReviewFinding;

export type ReviewGateResult = {
  result: ReviewResultName;
  blockingFindings: ReviewFindingValue[];
  nonBlockingFindings: ReviewFindingValue[];
  escalationRequired: boolean;
  executionStatus?: 'COMPLETED' | 'FAILED';
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

  const { result, blockingFindings, nonBlockingFindings, escalationRequired } = value;
  const allowedKeys = new Set([
    'result',
    'blockingFindings',
    'nonBlockingFindings',
    'escalationRequired',
  ]);

  if (
    !isReviewResultName(result) ||
    !isFindingArray(blockingFindings) ||
    !isFindingArray(nonBlockingFindings) ||
    typeof escalationRequired !== 'boolean' ||
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
  };
}

export function reviewerInvocationFailure(message: string): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [`Reviewer invocation failed: ${message}`],
    nonBlockingFindings: [],
    escalationRequired: true,
    executionStatus: 'FAILED',
  };
}

export function validationFailure(message: string): ReviewGateResult {
  return {
    result: 'CHANGES_REQUIRED',
    blockingFindings: [`Deterministic validation failed: ${message}`],
    nonBlockingFindings: [],
    escalationRequired: false,
  };
}

export function reviewCycleLimitExceeded(cycle: number): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [`Review cycle ${cycle} exceeds the maximum of ${maxReviewCycles}.`],
    nonBlockingFindings: [],
    escalationRequired: true,
  };
}

export function canOpenPullRequest(validationPassed: boolean, review: ReviewGateResult): boolean {
  return (
    validationPassed &&
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
    blockingFindings: [message],
    nonBlockingFindings: [],
    escalationRequired: true,
    executionStatus: 'FAILED',
  };
}
