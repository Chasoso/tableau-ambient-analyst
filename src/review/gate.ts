export const reviewResults = ['PASS', 'CHANGES_REQUIRED', 'HUMAN_DECISION_REQUIRED'] as const;
export const maxReviewCycles = 5;

export type ReviewResultName = (typeof reviewResults)[number];

export type ReviewGateResult = {
  result: ReviewResultName;
  blockingFindings: string[];
  nonBlockingFindings: string[];
  escalationRequired: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

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
    !isStringArray(blockingFindings) ||
    !isStringArray(nonBlockingFindings) ||
    typeof escalationRequired !== 'boolean' ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    return malformedResult('Reviewer output did not match the gate result contract.');
  }

  if (result === 'PASS' && (blockingFindings.length > 0 || escalationRequired)) {
    return malformedResult('PASS cannot include blocking findings or escalation.');
  }

  return { result, blockingFindings, nonBlockingFindings, escalationRequired };
}

export function reviewerInvocationFailure(message: string): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [`Reviewer invocation failed: ${message}`],
    nonBlockingFindings: [],
    escalationRequired: true,
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
    !review.escalationRequired
  );
}

function malformedResult(message: string): ReviewGateResult {
  return {
    result: 'HUMAN_DECISION_REQUIRED',
    blockingFindings: [message],
    nonBlockingFindings: [],
    escalationRequired: true,
  };
}
