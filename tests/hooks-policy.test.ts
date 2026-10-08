import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const wrapper = resolve('.codex/hooks/run_pre_tool_use_policy.mjs');

function runHook(command: string): string {
  return execFileSync('node', [wrapper], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
}

function runRawHook(input: string): string {
  return execFileSync('node', [wrapper], { input, encoding: 'utf8' });
}

function denial(command: string): string | undefined {
  const output = runHook(command).trim();
  if (!output) return undefined;
  const parsed = JSON.parse(output) as {
    hookSpecificOutput?: { permissionDecisionReason?: string };
  };
  return parsed.hookSpecificOutput?.permissionDecisionReason;
}

describe('repository-local Codex safety Hook', () => {
  it('uses the official repository-local PreToolUse Bash configuration', () => {
    const configuration = JSON.parse(readFileSync(resolve('.codex/hooks.json'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };
    expect(configuration.hooks.PreToolUse[0]?.matcher).toBe('^Bash$');
    expect(configuration.hooks.PreToolUse[0]?.hooks[0]?.command).toContain(
      '.codex/hooks/run_pre_tool_use_policy.mjs',
    );
  });

  it.each([
    ['git push --force origin feat/issue-55', 'Force push'],
    ['git push --force-with-lease origin feat/issue-55', 'Force push'],
    ['git push --force-with-lease=refs/heads/feat/issue-55 origin feat/issue-55', 'Force push'],
    ['git reset --hard HEAD~1', 'hard reset'],
    ['git push origin main', 'protected branch main'],
    ['git push origin HEAD:refs/heads/main', 'protected branch main'],
    ['git push', 'implicit'],
    ['git push origin', 'implicit'],
    ['git push origin HEAD', 'Ambiguous HEAD'],
    ['git push origin "$(git branch --show-current)"', 'substitution'],
    ['git push origin "${BRANCH}"', 'determined statically'],
    ['git push origin "$TARGET"', 'determined statically'],
    ['git push origin `git branch --show-current`', 'substitution'],
    ['FOO=bar git push --force origin feat/issue-55', 'Force push'],
    ['FOO=bar git reset --hard HEAD~1', 'hard reset'],
    ['FOO=bar gh pr merge 61', 'merge operations'],
    ['A=1 B=2 git worktree remove --force .worktrees/issue-55', 'Force removal'],
    ['git push origin +refs/heads/feat/issue-55', 'Force push'],
    ['git push origin +refs/heads/feat/issue-55:refs/heads/feat/issue-56', 'Force push'],
    ['git push +refs/heads/feat/issue-55', 'Force push'],
    ['git commit --no-verify -m bypass', 'verification bypass'],
    ['git push --no-verify origin feat/issue-55', 'verification bypass'],
    ['gh pr merge 60', 'merge operations'],
    ['git branch -D feat/issue-60', 'Force deletion'],
    ['git branch -df feat/issue-60', 'Force deletion'],
    ['git push -uf origin feat/issue-55', 'Force push'],
    ['git branch --delete -f feat/issue-60', 'Force deletion'],
    ['git branch --delete --force feat/issue-60', 'Force deletion'],
    ['git worktree remove --force .worktrees/issue-60', 'Force removal'],
  ])('denies %s', (command, reason) => {
    expect(denial(command)).toContain(reason);
  });

  it.each([
    'git status --short',
    'git diff --check',
    'git --version',
    'git --help',
    'git -P status --short',
    'git fetch origin main',
    'git push origin feat/issue-55',
    'FOO=bar git status --short',
    'A=1 B=2 git diff --check',
    'git push origin main:refs/heads/feat/issue-55',
    'git worktree add -b feat/issue-55 .worktrees/issue-55 main',
    'git worktree remove .worktrees/issue-55',
    'gh pr view 60 --json state',
    "printf 'git push --force origin feat/issue-55'",
    'gh pr list --search merge',
    'echo "${HOME}"',
    'echo "$HOME"',
    'printf "{}"',
    'echo \'{"status":"ok"}\'',
    "printf '${HOME}'",
  ])('allows safe command %s', (command) => {
    expect(denial(command)).toBeUndefined();
  });

  it('does not allow a shell-chain bypass of a prohibited command', () => {
    expect(denial('git status && git push --force origin feat/issue-55')).toContain('Force push');
    expect(denial('printf "$(git push --force origin feat/issue-55)"')).toContain('substitution');
    expect(denial("printf '$(git push --force origin feat/issue-55)'")).toBeUndefined();
    expect(denial("bash -c $'git push --force origin feat/issue-55'")).toContain('substitution');
    expect(denial('git push --{force} origin feat/issue-55')).toContain('Force push');
  });

  it.each([
    'bash -c "git push --force origin feat/issue-55"',
    'bash -lc "git push --force origin feat/issue-55"',
    'sh -ec "git reset --hard HEAD~1"',
    'zsh -fc "git branch -D feat/issue-55"',
    'bash -lxc "gh pr merge 61"',
    'bash -c "$CMD"',
    'env git push --force origin feat/issue-55',
    'sudo git reset --hard HEAD~1',
    'sudo -u alice git push --force origin feat/issue-55',
    'gh --repo Chasoso/tableau-ambient-analyst pr merge 61',
    'git reset --hard=HEAD~1',
    'git worktree remove -f .worktrees/issue-55',
    'command git reset --hard HEAD~1',
    '/usr/bin/git push --force origin feat/issue-55',
    'command gh pr merge 60',
  ])('denies obvious wrapper or executable aliases: %s', (command) => {
    expect(denial(command)).toBeDefined();
  });

  it('fails closed for malformed Hook input and unparseable commands', () => {
    expect(JSON.parse(runRawHook('{not-json')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(runRawHook('{}')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(denial("git push --force 'unterminated")).toContain('parse');
  });

  it('uses the repository Node-only runtime and fails closed for malformed input', () => {
    expect(readFileSync(resolve('.codex/hooks.json'), 'utf8')).toContain(
      'run_pre_tool_use_policy.mjs',
    );
    const result = execFileSync('node', [wrapper], {
      input: '{not-json',
      encoding: 'utf8',
    });
    expect(JSON.parse(result).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(readFileSync(resolve('.codex/hooks.json'), 'utf8')).not.toContain('python3');
  });

  it.each([
    'git -c core.hooksPath=/dev/null push --force origin feat/issue-55',
    'git --config-env core.hooksPath=HOOKS push --force origin feat/issue-55',
  ])('guards prohibited commands after Git global options: %s', (command) => {
    expect(denial(command)).toContain('Force push');
  });
});
