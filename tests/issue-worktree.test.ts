import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalIssueBranch,
  canonicalIssueWorktreePath,
  resolveIssueWorkspace,
} from '../src/review/issue-worktree.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function fixture(): { root: string; local: string } {
  const root = mkdtempSync(join(tmpdir(), 'ambient-issue-worktree-'));
  const local = join(root, 'repo');
  git(root, ['init', '-q', '-b', 'main', local]);
  git(local, ['config', 'user.name', 'Test']);
  git(local, ['config', 'user.email', 'test@example.test']);
  writeFileSync(join(local, '.gitignore'), '.worktrees/\n');
  writeFileSync(join(local, 'README.md'), '# fixture\n');
  git(local, ['add', '.']);
  git(local, ['commit', '-qm', 'initial']);
  return { root, local };
}

describe('canonical Issue workspaces', () => {
  it('creates and then reuses the Issue-number workspace without moving primary main', () => {
    const { root, local } = fixture();
    try {
      const created = resolveIssueWorkspace(local, '60');
      expect(created).toMatchObject({
        status: 'NEW',
        issue: '60',
        branch: 'feat/issue-60',
        path: canonicalIssueWorktreePath(local, '60'),
      });
      expect(git(local, ['branch', '--show-current']).trim()).toBe('main');

      const reused = resolveIssueWorkspace(local, '60');
      expect(reused).toMatchObject({ status: 'REUSE', branch: 'feat/issue-60' });
      expect(git(local, ['branch', '--show-current']).trim()).toBe('main');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reuses an existing canonical branch by creating its canonical worktree', () => {
    const { root, local } = fixture();
    try {
      git(local, ['branch', canonicalIssueBranch('61'), 'main']);
      expect(resolveIssueWorkspace(local, '61')).toMatchObject({
        status: 'REUSE',
        branch: 'feat/issue-61',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks a legacy same-Issue branch instead of creating a canonical sibling', () => {
    const { root, local } = fixture();
    try {
      git(local, ['branch', 'feat/issue-62-old-title', 'main']);
      expect(resolveIssueWorkspace(local, '62')).toMatchObject({ status: 'BLOCKED' });
      expect(git(local, ['branch', '--list', 'feat/issue-62'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks legacy same-Issue worktree paths and slash-separated branches', () => {
    const { root, local } = fixture();
    try {
      const legacyPath = join(local, '.worktrees', 'issue-68-old');
      mkdirSync(join(local, '.worktrees'));
      git(local, ['worktree', 'add', '-q', '-b', 'feat/other', legacyPath, 'main']);
      expect(resolveIssueWorkspace(local, '68')).toMatchObject({ status: 'BLOCKED' });

      git(local, ['branch', 'feat/issue-69/retry', 'main']);
      expect(resolveIssueWorkspace(local, '69')).toMatchObject({ status: 'BLOCKED' });
      expect(git(local, ['branch', '--list', 'feat/issue-69'])).toBe('');

      const externalLegacyPath = join(root, 'issue-70-old');
      git(local, [
        'worktree',
        'add',
        '-q',
        '-b',
        'feat/other-external',
        externalLegacyPath,
        'main',
      ]);
      expect(resolveIssueWorkspace(local, '70')).toMatchObject({ status: 'BLOCKED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks a dirty canonical worktree without stashing or discarding it', () => {
    const { root, local } = fixture();
    try {
      const workspace = resolveIssueWorkspace(local, '63');
      if (workspace.status === 'BLOCKED') throw new Error(workspace.reason);
      writeFileSync(join(workspace.path, 'uncommitted.txt'), 'keep me\n');
      expect(resolveIssueWorkspace(local, '63')).toMatchObject({ status: 'BLOCKED' });
      expect(git(workspace.path, ['status', '--porcelain'])).toContain('uncommitted.txt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks a canonical branch attached to a different worktree', () => {
    const { root, local } = fixture();
    try {
      const other = join(root, 'other');
      git(local, ['worktree', 'add', '-q', '-b', 'feat/issue-64', other, 'main']);
      expect(resolveIssueWorkspace(local, '64')).toMatchObject({ status: 'BLOCKED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not create a fresh branch for review-only resolution', () => {
    const { root, local } = fixture();
    try {
      expect(resolveIssueWorkspace(local, '65', 'main', { createBranch: false })).toMatchObject({
        status: 'BLOCKED',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not create a canonical worktree for review-only resolution when only the branch exists', () => {
    const { root, local } = fixture();
    try {
      git(local, ['branch', canonicalIssueBranch('67'), 'main']);
      const worktreePath = canonicalIssueWorktreePath(local, '67');
      const before = git(local, ['worktree', 'list', '--porcelain']);

      expect(resolveIssueWorkspace(local, '67', 'main', { createBranch: false })).toMatchObject({
        status: 'BLOCKED',
      });
      expect(existsSync(worktreePath)).toBe(false);
      expect(git(local, ['worktree', 'list', '--porcelain'])).toBe(before);
      expect(git(local, ['branch', '--show-current']).trim()).toBe('main');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks a symlinked managed worktree root', () => {
    const { root, local } = fixture();
    try {
      const outside = join(root, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, join(local, '.worktrees'));

      expect(resolveIssueWorkspace(local, '66')).toMatchObject({ status: 'BLOCKED' });
      expect(lstatSync(join(local, '.worktrees')).isSymbolicLink()).toBe(true);
      expect(git(local, ['branch', '--list', 'feat/issue-66'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
