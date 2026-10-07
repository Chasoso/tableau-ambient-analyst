import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { synchronizeLocalBase } from '../src/review/git-sync.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commit(cwd: string, message: string): void {
  git(cwd, ['add', '.']);
  git(cwd, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-qm',
    message,
  ]);
}

function fixture(): { local: string; remote: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ambient-git-sync-'));
  const remote = join(root, 'origin.git');
  const local = join(root, 'local');
  git(root, ['init', '-q', '--bare', remote]);
  git(root, ['init', '-q', '-b', 'main', local]);
  git(local, ['config', 'user.name', 'Test']);
  git(local, ['config', 'user.email', 'test@example.test']);
  writeFileSync(join(local, 'README.md'), '# fixture\n');
  commit(local, 'initial');
  git(local, ['remote', 'add', 'origin', remote]);
  git(local, ['push', '-q', '--set-upstream', 'origin', 'main']);
  return { local, remote, root };
}

function peerFor(remote: string, root: string): string {
  const peer = join(root, 'peer');
  git(root, ['clone', '-q', '--branch', 'main', remote, peer]);
  git(peer, ['config', 'user.name', 'Test']);
  git(peer, ['config', 'user.email', 'test@example.test']);
  return peer;
}

describe('local main synchronization', () => {
  it('continues when local main is already up to date', () => {
    const { local, root } = fixture();
    try {
      expect(synchronizeLocalBase(local)).toMatchObject({ status: 'UP_TO_DATE' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fast-forwards local main when origin/main is ahead', () => {
    const { local, remote, root } = fixture();
    try {
      const peer = peerFor(remote, root);
      writeFileSync(join(peer, 'remote.txt'), 'remote\n');
      commit(peer, 'remote update');
      git(peer, ['push', '-q', 'origin', 'main']);

      expect(synchronizeLocalBase(local)).toMatchObject({ status: 'FAST_FORWARD' });
      expect(git(local, ['rev-parse', 'HEAD'])).toBe(git(local, ['rev-parse', 'origin/main']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks when local main is ahead of origin/main', () => {
    const { local, root } = fixture();
    try {
      writeFileSync(join(local, 'local.txt'), 'local\n');
      commit(local, 'local update');
      expect(synchronizeLocalBase(local)).toMatchObject({ status: 'BLOCKED' });
      expect(git(local, ['log', '-1', '--format=%s']).trim()).toBe('local update');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks when local main and origin/main have diverged', () => {
    const { local, remote, root } = fixture();
    try {
      writeFileSync(join(local, 'local.txt'), 'local\n');
      commit(local, 'local update');
      const peer = peerFor(remote, root);
      writeFileSync(join(peer, 'remote.txt'), 'remote\n');
      commit(peer, 'remote update');
      git(peer, ['push', '-q', 'origin', 'main']);

      expect(synchronizeLocalBase(local)).toMatchObject({ status: 'BLOCKED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks before fetch when the working tree is dirty', () => {
    const { local, root } = fixture();
    try {
      writeFileSync(join(local, 'uncommitted.txt'), 'dirty\n');
      expect(synchronizeLocalBase(local)).toMatchObject({ status: 'BLOCKED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
