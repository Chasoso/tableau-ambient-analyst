const authorizationFlags = [
  '--authorize-resume-after-limit',
  '--authorize-termination-recovery',
  '--authorize-reviewer-failure-recovery',
] as const;

const resumeFlags = [
  '--resume-after-limit',
  '--resume-after-recovery',
  '--resume-reviewer-failure-recovery',
] as const;

export function hasAuthorizationResumeConflict(rawArguments: readonly string[]): boolean {
  const hasAuthorization = authorizationFlags.some((flag) => rawArguments.includes(flag));
  const hasResume = resumeFlags.some((flag) => rawArguments.includes(flag));
  return hasAuthorization && hasResume;
}
