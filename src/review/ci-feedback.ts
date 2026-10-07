export const maxCiRepairCycles = 3;
export const maxTransientCiReruns = 2;
export const maxCiPendingPolls = 60;

export type CiCheck = {
  name: string;
  state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'CANCELLED' | 'SKIPPED' | 'UNKNOWN';
  link?: string;
};

export type CiFailureClassification = 'AUTO_FIX' | 'BLOCKED' | 'HUMAN_DECISION_REQUIRED';
export type CiCompletionStatus =
  | 'READY_FOR_HUMAN_REVIEW'
  | 'CI_FAILED'
  | 'CI_BLOCKED'
  | 'CI_HUMAN_DECISION_REQUIRED'
  | 'CI_REPAIR_LIMIT_REACHED'
  | 'CI_TRANSIENT_RETRY_LIMIT_REACHED';

export type CiObservation = {
  checks: CiCheck[];
  evidence: string;
  transient: boolean;
  evidenceComplete?: boolean;
  runId?: string;
};

export type CiRepairState = {
  repairCycles: number;
  transientReruns: number;
  lastFailureSignature?: string;
  meaningfulProgress: boolean;
};

export type CiGateResult = {
  status: CiCompletionStatus;
  observation: CiObservation;
  state: CiRepairState;
  classification?: CiFailureClassification;
  reason?: string;
};

export type CiRepairOutcome = {
  changed: boolean;
  validated: boolean;
  pushed: boolean;
  reviewPassed?: boolean;
};

export type CiFeedbackDependencies = {
  observe: () => CiObservation;
  wait: () => void;
  rerunTransient: () => boolean;
  repair: (observation: CiObservation) => CiRepairOutcome;
};

export function classifyCiFailure(evidence: string): CiFailureClassification {
  const normalized = evidence.toLowerCase();
  if (
    /(secret|credential|permission denied|resource not accessible|runner unavailable|service unavailable|github outage|dependency .*unavailable)/.test(
      normalized,
    )
  ) {
    return 'BLOCKED';
  }
  if (
    /(product|architecture|scope|authentication|authorization|privacy|retention|cost|external service)/.test(
      normalized,
    )
  ) {
    return 'HUMAN_DECISION_REQUIRED';
  }
  return 'AUTO_FIX';
}

export function failureSignature(observation: CiObservation): string {
  return observation.checks
    .filter((check) => check.state === 'FAILURE' || check.state === 'CANCELLED')
    .map((check) => `${check.name}:${check.state}`)
    .sort()
    .join('|');
}

export function decideCiFailure(observation: CiObservation, state: CiRepairState): CiGateResult {
  const signature = failureSignature(observation);
  if (observation.evidenceComplete === false) {
    return {
      status: 'CI_BLOCKED',
      observation,
      state,
      classification: 'BLOCKED',
      reason: 'Head-matched failed job, step, or log evidence was unavailable.',
    };
  }
  const repeatedWithoutProgress =
    Boolean(signature) && signature === state.lastFailureSignature && !state.meaningfulProgress;
  const nextState = signature ? { ...state, lastFailureSignature: signature } : { ...state };

  if (observation.transient) {
    if (state.transientReruns >= maxTransientCiReruns) {
      return {
        status: 'CI_TRANSIENT_RETRY_LIMIT_REACHED',
        observation,
        state: nextState,
        classification: 'BLOCKED',
        reason: `Transient CI rerun limit of ${maxTransientCiReruns} reached.`,
      };
    }
    return { status: 'CI_FAILED', observation, state: nextState, classification: 'BLOCKED' };
  }

  const classification = classifyCiFailure(observation.evidence);
  if (classification === 'BLOCKED') {
    return {
      status: 'CI_BLOCKED',
      observation,
      state: nextState,
      classification,
      reason: 'CI failure requires an unavailable prerequisite or infrastructure recovery.',
    };
  }
  if (classification === 'HUMAN_DECISION_REQUIRED') {
    return {
      status: 'CI_HUMAN_DECISION_REQUIRED',
      observation,
      state: nextState,
      classification,
      reason:
        'CI repair would require a human-owned product, architecture, scope, or security decision.',
    };
  }
  if (repeatedWithoutProgress || state.repairCycles >= maxCiRepairCycles) {
    return {
      status: 'CI_REPAIR_LIMIT_REACHED',
      observation,
      state: nextState,
      classification,
      reason: repeatedWithoutProgress
        ? 'The same materially equivalent CI failure remains without meaningful progress.'
        : `CI repair-cycle limit of ${maxCiRepairCycles} reached.`,
    };
  }
  return { status: 'CI_FAILED', observation, state: nextState, classification };
}

export function runCiFeedbackLoop(
  dependencies: CiFeedbackDependencies,
  initialState: CiRepairState = { repairCycles: 0, transientReruns: 0, meaningfulProgress: false },
): CiGateResult {
  let state = initialState;
  let pendingPolls = 0;

  while (true) {
    const observation = dependencies.observe();
    if (
      observation.checks.length > 0 &&
      observation.checks.every((check) => check.state === 'SUCCESS')
    ) {
      return { status: 'READY_FOR_HUMAN_REVIEW', observation, state };
    }
    if (observation.checks.length === 0) {
      return {
        status: 'CI_BLOCKED',
        observation,
        state,
        classification: 'BLOCKED',
        reason: 'Required GitHub Actions checks could not be observed.',
      };
    }
    if (
      observation.checks.some((check) => check.state === 'SKIPPED' || check.state === 'UNKNOWN')
    ) {
      return {
        status: 'CI_BLOCKED',
        observation,
        state,
        classification: 'BLOCKED',
        reason: 'A required CI check was skipped or could not be normalized.',
      };
    }
    if (observation.checks.some((check) => check.state === 'PENDING')) {
      pendingPolls += 1;
      if (pendingPolls >= maxCiPendingPolls) {
        return {
          status: 'CI_BLOCKED',
          observation,
          state,
          classification: 'BLOCKED',
          reason: `CI observation wait limit of ${maxCiPendingPolls} polls reached.`,
        };
      }
      dependencies.wait();
      continue;
    }

    const decision = decideCiFailure(observation, state);
    state = decision.state;
    if (decision.status !== 'CI_FAILED') return decision;

    if (decision.observation.transient) {
      state = { ...state, transientReruns: state.transientReruns + 1, meaningfulProgress: false };
      if (!dependencies.rerunTransient()) {
        return {
          ...decision,
          status: 'CI_BLOCKED',
          classification: 'BLOCKED',
          reason: 'The transient CI run could not be rerun.',
          state,
        };
      }
      continue;
    }

    const outcome = dependencies.repair(observation);
    if (outcome.reviewPassed === false) {
      return {
        ...decision,
        status: 'CI_HUMAN_DECISION_REQUIRED',
        classification: 'HUMAN_DECISION_REQUIRED',
        reason: 'Fresh Independent Review did not PASS after the CI repair commit.',
        state,
      };
    }
    if (!outcome.changed || !outcome.validated || !outcome.pushed) {
      return {
        ...decision,
        status: 'CI_REPAIR_LIMIT_REACHED',
        reason: 'CI AUTO_FIX did not produce a validated pushed repository change.',
        state,
      };
    }
    state = {
      ...state,
      repairCycles: state.repairCycles + 1,
      meaningfulProgress: true,
    };
  }
}
