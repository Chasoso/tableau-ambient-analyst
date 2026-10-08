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
    ['git push origin "$(git branch --show-current)"', 'determined statically'],
    ['git push origin "${BRANCH}"', 'determined statically'],
    ['git push origin "$TARGET"', 'determined statically'],
    ['git push origin `git branch --show-current`', 'determined statically'],
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
    ['git status --short\ngit push --force origin feat/issue-55', 'Force push'],
    ['git status --short\ngh pr merge 61', 'merge operations'],
    ['if true; then git push --force origin feat/issue-55; fi', 'control structure'],
    ['if true; then gh pr merge 61; fi', 'control structure'],
    ['{ git reset --hard HEAD~1; }', 'control structure'],
    ['( git branch -D feat/issue-55 )', 'control structure'],
    ['(git push --force origin feat/issue-55)', 'control structure'],
    ['(git reset --hard HEAD~1)', 'control structure'],
    ['(gh pr merge 61)', 'control structure'],
    ['cat <(git push --force origin feat/issue-55)', 'control structure'],
    ['cat <(git reset --hard HEAD~1)', 'control structure'],
    ['diff <(git status) <(git reset --hard HEAD~1)', 'control structure'],
    ['echo >(git push --force origin feat/issue-55)', 'control structure'],
    ['git push origin {main,feat/issue-55}', 'brace expansion'],
    ['git push origin refs/heads/{main,feat/issue-55}', 'brace expansion'],
    ['git push origin m{a..a}in', 'brace expansion'],
    ['git push origin refs/heads/m{a..a}in', 'brace expansion'],
    ['git push --{force,verbose} origin feat/issue-55', 'brace expansion'],
    ['git push --forc{e..e} origin feat/issue-55', 'brace expansion'],
    ['git branch -{D,v} feat/issue-55', 'brace expansion'],
    ['git branch -{D..D} feat/issue-55', 'brace expansion'],
    ['git worktree remove --{force,verbose} .worktrees/issue-55', 'brace expansion'],
    ['git worktree remove --forc{e..e} .worktrees/issue-55', 'brace expansion'],
    ['! git push --force origin feat/issue-55', 'Force push'],
    ['! git reset --hard HEAD~1', 'hard reset'],
    ['time git push --force origin feat/issue-55', 'Force push'],
    ['time gh pr merge 61', 'merge operations'],
    ['time -p git reset --hard HEAD~1', 'hard reset'],
    ['exec git push --force origin feat/issue-55', 'Force push'],
    ['exec gh pr merge 61', 'merge operations'],
    ['command -p git push --force origin feat/issue-55', 'Force push'],
    ['command -- git reset --hard HEAD~1', 'hard reset'],
    ["eval 'git push --force origin feat/issue-55'", 'Force push'],
    ["eval 'git reset --hard HEAD~1'", 'hard reset'],
    ["eval 'gh pr merge 61'", 'merge operations'],
    ['eval "$CMD"', 'Eval command content'],
    ["git -c alias.fp='push --force' fp origin feat/issue-55", 'Git global options'],
    ["git -c alias.fp='push -f' fp origin feat/issue-55", 'Git global options'],
    ["git -c alias.fp='push --force-with-lease' fp origin feat/issue-55", 'Git global options'],
    ["git -c alias.fp='push +refs/heads/foo:refs/heads/bar' fp", 'Git global options'],
    ["git -c alias.pm='push origin main' pm", 'Git global options'],
    ["git -c alias.pm='push origin HEAD:refs/heads/main' pm", 'Git global options'],
    ['git -c "alias.pm=push origin \'main\'" pm', 'Git global options'],
    ['git -c \'alias.pm=push origin "main"\' pm', 'Git global options'],
    ['git -c "alias.pm=push origin \'HEAD:refs/heads/main\'" pm', 'Git global options'],
    ['git -c \'alias.pm=push origin "HEAD:refs/heads/main"\' pm', 'Git global options'],
    ['git -c "alias.fp=push origin \'+refs/heads/foo:refs/heads/bar\'" fp', 'Git global options'],
    ["git -c alias.hr='reset --hard' hr HEAD~1", 'Git global options'],
    ["git -c alias.bd='branch -D' bd feat/issue-55", 'Git global options'],
    ["git -c alias.bd='branch -df' bd feat/issue-55", 'Git global options'],
    ["git -c alias.bd='branch -fd' bd feat/issue-55", 'Git global options'],
    ['git -c alias.fp=\'!git push --force "$@"\' fp origin feat/issue-55', 'Git global options'],
    ["git -c alias.wr='worktree remove -f' wr .worktrees/issue-55", 'Git global options'],
    ["git -c alias.ur='update-ref -d refs/heads/feat/issue-55' ur", 'Git global options'],
    ['gh api -X PUT repos/Chasoso/tableau-ambient-analyst/pulls/61/merge', 'merge operations'],
    [
      'gh api --method PUT repos/Chasoso/tableau-ambient-analyst/pulls/61/merge',
      'merge operations',
    ],
    ['git update-ref -d refs/heads/feat/issue-55', 'local branch refs'],
    ['git update-ref --delete refs/heads/feat/issue-55', 'local branch refs'],
    ['git update-ref --stdin', 'Update-ref stdin'],
    ['git update-ref --stdin -z', 'Update-ref stdin'],
    ["printf 'delete refs/heads/feat/issue-55\\n' | git update-ref --stdin", 'Update-ref stdin'],
    [
      'git update-ref refs/heads/feat/issue-55 0000000000000000000000000000000000000000',
      'local branch refs',
    ],
    [
      "ALIAS='push --force' git --config-env=alias.fp=ALIAS fp origin feat/issue-55",
      'Git global options',
    ],
    ["ALIAS='reset --hard' git --config-env=alias.hr=ALIAS hr HEAD~1", 'Git global options'],
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
    'echo "value={a..z}"',
    'printf "{}"',
    'echo \'{"status":"ok"}\'',
    "printf '${HOME}'",
    'git status --short\ngit diff --check',
    'bash -c \'echo "$HOME"\'',
    'bash -c \'printf "${HOME}"\'',
    'bash -c \'printf "{}"\'',
    'echo "(hello)"',
    'printf "<(text)"',
    'printf ">(text)"',
    'echo "$(date)"',
    'printf "$(pwd)"',
    'echo `date`',
    'bash -c \'echo "$(date)"\'',
    '! git status --short',
    'time git status --short',
    'time -p git diff --check',
    'exec git status --short',
    'command -p git status --short',
    'command -- git diff --check',
    "eval 'git status --short'",
    "eval 'printf hello'",
    'git -c alias.st=status st --short',
    'git -c "alias.st=status --short" st',
    'git -c "alias.df=diff --check" df',
    'gh api repos/Chasoso/tableau-ambient-analyst/pulls/61',
    'git update-ref refs/heads/some-safe-ref deadbeef',
  ])('allows safe command %s', (command) => {
    expect(denial(command)).toBeUndefined();
  });

  it('does not allow a shell-chain bypass of a prohibited command', () => {
    expect(denial('git status && git push --force origin feat/issue-55')).toContain('Force push');
    expect(denial('printf "$(git push --force origin feat/issue-55)"')).toContain('Force push');
    expect(denial("printf '$(git push --force origin feat/issue-55)'")).toBeUndefined();
    expect(denial("bash -c $'git push --force origin feat/issue-55'")).toContain('Shell wrapper');
    expect(denial('git push --{force} origin feat/issue-55')).toContain('Force push');
  });

  it.each([
    'bash -c "git push --force origin feat/issue-55"',
    'bash -lc "git push --force origin feat/issue-55"',
    'sh -ec "git reset --hard HEAD~1"',
    'zsh -fc "git branch -D feat/issue-55"',
    'bash -lxc "gh pr merge 61"',
    'bash -c "$CMD"',
    'bash -c \'git push origin "$TARGET"\'',
    'bash -c \'git push origin "${BRANCH}"\'',
    'bash -c \'git push origin "$(git branch --show-current)"\'',
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
