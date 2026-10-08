import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { assertSafeChildProcess } from './command-safety.js';

export type IssueWorkspaceStatus = 'NEW' | 'REUSE' | 'BLOCKED';

export type IssueWorkspaceResult =
  | {
      status: 'NEW' | 'REUSE';
      issue: string;
      branch: string;
      path: string;
    }
  | { status: 'BLOCKED'; reason: string };

type WorktreeEntry = { path: string; branch?: string };

function git(cwd: string, args: string[]): string {
  assertSafeChildProcess('git', args);
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function issuePattern(issue: string): RegExp {
  return new RegExp(`(?:^|/)issue-${issue}(?:$|[-/])`);
}

function repositoryRoot(cwd: string): string {
  const commonDirectory = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return resolve(dirname(commonDirectory));
}

function validateCanonicalPath(root: string, path: string): string | undefined {
  const worktreeRoot = resolve(root, '.worktrees');
  try {
    const worktreeRootStat = lstatSync(worktreeRoot);
    if (worktreeRootStat.isSymbolicLink() || !worktreeRootStat.isDirectory()) {
      return 'Canonical worktree root is not a real repository-managed directory.';
    }
  } catch {
    // The managed root is created below when it does not exist.
  }
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return 'Canonical Issue worktree path must not be a symbolic link.';
    }
  } catch {
    // The canonical path is expected to be absent for a new workspace.
  }
  return undefined;
}

function parseWorktrees(cwd: string): WorktreeEntry[] {
  const lines = git(cwd, ['worktree', 'list', '--porcelain']).split('\n');
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function isClean(path: string): boolean {
  return git(path, ['status', '--porcelain', '--untracked-files=all']) === '';
}

function localBranchesForIssue(cwd: string, issue: string, canonicalBranch: string): string[] {
  return git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n')
    .map((branch) => branch.trim())
    .filter(
      (branch) => branch !== '' && branch !== canonicalBranch && issuePattern(issue).test(branch),
    );
}

export function canonicalIssueBranch(issue: string): string {
  if (!/^\d+$/.test(issue)) throw new Error('Issue number must be numeric.');
  return `feat/issue-${issue}`;
}

export function canonicalIssueWorktreePath(cwd: string, issue: string): string {
  const root = repositoryRoot(cwd);
  return resolve(root, '.worktrees', `issue-${issue}`);
}

/**
 * Resolve the one repository-managed workspace for an Issue. This function
 * never renames or deletes legacy branches and never stashes dirty work.
 */
export function resolveIssueWorkspace(
  cwd: string,
  issue: string,
  base = 'main',
  options: { createBranch?: boolean } = { createBranch: true },
): IssueWorkspaceResult {
  if (!/^\d+$/.test(issue)) return { status: 'BLOCKED', reason: 'Issue number must be numeric.' };
  if (!/^[A-Za-z0-9._/-]+$/.test(base)) {
    return { status: 'BLOCKED', reason: 'Base branch name is invalid.' };
  }

  try {
    const branch = canonicalIssueBranch(issue);
    const path = canonicalIssueWorktreePath(cwd, issue);
    const root = repositoryRoot(cwd);
    const pathError = validateCanonicalPath(root, path);
    if (pathError) return { status: 'BLOCKED', reason: pathError };
    const alternateBranches = localBranchesForIssue(cwd, issue, branch);
    if (alternateBranches.length > 0) {
      return {
        status: 'BLOCKED',
        reason: `Ambiguous local branches represent Issue #${issue}: ${alternateBranches.join(', ')}.`,
      };
    }

    const worktrees = parseWorktrees(cwd);
    const conflictingWorktree = worktrees.find((entry) => {
      const entryPath = resolve(entry.path);
      if (entryPath === path) return false;
      const normalizedPath = entryPath.replaceAll('\\', '/');
      return issuePattern(issue).test(normalizedPath);
    });
    if (conflictingWorktree) {
      return {
        status: 'BLOCKED',
        reason: `Ambiguous worktrees represent Issue #${issue}: ${conflictingWorktree.path}.`,
      };
    }
    const attachedCanonical = worktrees.find((entry) => entry.branch === `refs/heads/${branch}`);
    if (attachedCanonical && resolve(attachedCanonical.path) !== path) {
      return {
        status: 'BLOCKED',
        reason: `Canonical branch ${branch} is attached to another worktree.`,
      };
    }

    const pathExists = existsSync(path);
    if (pathExists && !worktrees.some((entry) => resolve(entry.path) === path)) {
      return {
        status: 'BLOCKED',
        reason: `Canonical worktree path already exists outside Git worktree registration: ${path}.`,
      };
    }

    if (attachedCanonical) {
      if (!isClean(path)) {
        return { status: 'BLOCKED', reason: 'Canonical Issue worktree is dirty.' };
      }
      return { status: 'REUSE', issue, branch, path };
    }

    const branchExists = (() => {
      try {
        git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
        return true;
      } catch {
        return false;
      }
    })();

    if (!options.createBranch) {
      return {
        status: 'BLOCKED',
        reason: branchExists
          ? `Canonical branch ${branch} exists without its canonical worktree.`
          : `Canonical branch ${branch} and worktree do not exist.`,
      };
    }

    mkdirSync(dirname(path), { recursive: true });
    if (branchExists) {
      git(cwd, ['worktree', 'add', path, branch]);
      return { status: 'REUSE', issue, branch, path };
    }

    git(cwd, ['worktree', 'add', '-b', branch, path, base]);
    return { status: 'NEW', issue, branch, path };
  } catch {
    return {
      status: 'BLOCKED',
      reason: `Could not resolve the canonical worktree for Issue #${issue}.`,
    };
  }
}

export function validateIssueWorkspace(path: string, branch: string): string | undefined {
  try {
    if (git(path, ['branch', '--show-current']) !== branch) {
      return 'Canonical Issue worktree is not on its canonical branch.';
    }
    if (!isClean(path)) return 'Canonical Issue worktree is dirty.';
    return undefined;
  } catch {
    return 'Canonical Issue worktree could not be validated.';
  }
}
