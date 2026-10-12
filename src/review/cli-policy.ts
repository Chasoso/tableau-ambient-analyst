const authorizationFlags = [
  '--authorize-resume-after-limit',
  '--authorize-termination-recovery',
  '--authorize-reviewer-failure-recovery',
  '--authorize-reservation-reconciliation',
  '--authorize-review-limit-terminal',
] as const;

const resumeFlags = [
  '--resume-after-limit',
  '--resume-after-recovery',
  '--resume-reviewer-failure-recovery',
  '--reconcile-reserved-review',
  '--finalize-review-limit-terminal',
] as const;

export function hasAuthorizationResumeConflict(rawArguments: readonly string[]): boolean {
  const recoveryModeCount = [...authorizationFlags, ...resumeFlags].filter((flag) =>
    rawArguments.includes(flag),
  ).length;
  const reviewModeCount = ['--review-only', '--update-pr'].filter((flag) =>
    rawArguments.includes(flag),
  ).length;
  return (
    recoveryModeCount > 1 || reviewModeCount > 1 || (recoveryModeCount > 0 && reviewModeCount > 0)
  );
}
