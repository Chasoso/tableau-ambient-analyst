const authorizationFlags = [
  '--authorize-resume-after-limit',
  '--authorize-termination-recovery',
  '--authorize-reviewer-failure-recovery',
  '--authorize-reservation-reconciliation',
] as const;

const resumeFlags = [
  '--resume-after-limit',
  '--resume-after-recovery',
  '--resume-reviewer-failure-recovery',
  '--reconcile-reserved-review',
] as const;

export function hasAuthorizationResumeConflict(rawArguments: readonly string[]): boolean {
  return (
    [...authorizationFlags, ...resumeFlags].filter((flag) => rawArguments.includes(flag)).length > 1
  );
}
