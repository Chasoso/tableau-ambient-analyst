import { execFileSync } from 'node:child_process';

export type MainSyncResult =
  | { status: 'UP_TO_DATE' | 'FAST_FORWARD'; local: string; remote: string }
  | { status: 'BLOCKED'; reason: string };

/**
 * Fetch and safely align a clean local base branch with its remote tracking
 * branch. The caller must provide the primary main worktree; this intentionally
 * supports fast-forward-only movement and never switches or discards local
 * history.
 */
export function synchronizeLocalBase(cwd: string, base = 'main'): MainSyncResult {
  if (!/^[A-Za-z0-9._/-]+$/.test(base)) {
    return { status: 'BLOCKED', reason: 'Base branch name is invalid.' };
  }

  try {
    if (execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim()) {
      return { status: 'BLOCKED', reason: 'Issue-to-PR workflow requires a clean working tree.' };
    }
    const currentBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    if (!currentBranch) {
      return {
        status: 'BLOCKED',
        reason: 'Issue-to-PR workflow cannot start from a detached HEAD.',
      };
    }
    if (currentBranch !== base) {
      return {
        status: 'BLOCKED',
        reason: `Primary worktree must already be on ${base}; branch switching is forbidden.`,
      };
    }
    execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd, encoding: 'utf8' });
    execFileSync('git', ['fetch', 'origin', base], { cwd, encoding: 'utf8' });
    const counts = execFileSync(
      'git',
      ['rev-list', '--left-right', '--count', `${base}...origin/${base}`],
      { cwd, encoding: 'utf8' },
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    if (counts.length !== 2 || !counts.every((count) => Number.isInteger(count))) {
      return { status: 'BLOCKED', reason: 'Could not compare local and origin base history.' };
    }
    const ahead = counts[0] as number;
    const behind = counts[1] as number;
    if (ahead > 0) {
      return {
        status: 'BLOCKED',
        reason:
          behind > 0
            ? `Local ${base} and origin/${base} have diverged; automatic history resolution is forbidden.`
            : `Local ${base} is ahead of origin/${base}; automatic history rewriting is forbidden.`,
      };
    }
    if (behind === 0) {
      return { status: 'UP_TO_DATE', local: base, remote: `origin/${base}` };
    }
    execFileSync('git', ['merge', '--ff-only', `origin/${base}`], { cwd, encoding: 'utf8' });
    return { status: 'FAST_FORWARD', local: base, remote: `origin/${base}` };
  } catch {
    return {
      status: 'BLOCKED',
      reason: `Local ${base} could not be safely synchronized with origin/${base}.`,
    };
  }
}
