import { readFileSync } from 'node:fs';
import process from 'node:process';

const separators = new Set([';', '&&', '||', '|', '&']);
const shells = new Set(['bash', 'sh', 'zsh']);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function tokensFor(command) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (token) {
      tokens.push(token);
      token = '';
    }
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '\\' && command[index + 1] === '"') escaped = true;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '\\') escaped = true;
    else if (/\s/.test(character)) flush();
    else if (character === ';' || character === '|' || character === '&') {
      flush();
      const next = command[index + 1];
      if (next === character) {
        tokens.push(character + next);
        index += 1;
      } else tokens.push(character);
    } else token += character;
  }
  if (quote || escaped) return null;
  flush();
  return tokens;
}

function executableName(token) {
  return token.split('/').at(-1);
}

function splitSegments(tokens) {
  const result = [];
  let current = [];
  for (const token of tokens) {
    if (separators.has(token)) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) result.push(current);
  return result;
}

function shortOptionBundleContains(token, flag) {
  return token.startsWith('-') && !token.startsWith('--') && token.slice(1).includes(flag);
}

function forceOption(token) {
  return token === '-f' || token === '--force' || token === '--force-with-lease' ||
    token.startsWith('--force=') || token.startsWith('--force-with-lease=') ||
    shortOptionBundleContains(token, 'f');
}

function protectedDestination(refspec) {
  const destination = refspec.split(':').at(-1).replace(/^\+/, '');
  return destination === 'main' || destination.endsWith('/main') || destination === 'refs/heads/main';
}

function dynamicToken(token) {
  return token.includes('$') || token.includes('`');
}

function gitInvocations(segment) {
  const invocations = [];
  const valueOptions = new Set([
    '-C', '--config-env', '--exec-path', '--git-dir', '--namespace',
    '--super-prefix', '--work-tree', '-c',
  ]);
  const flagOptions = new Set([
    '--bare', '--no-pager', '--no-replace-objects', '--paginate',
    '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
    '--version', '--help', '-p', '-P',
  ]);
  for (let index = 0; index < segment.length; index += 1) {
    if (executableName(segment[index]) !== 'git' || (index !== 0 && segment[index - 1] !== 'command')) continue;
    let cursor = index + 1;
    while (cursor < segment.length && segment[cursor].startsWith('-')) {
      const option = segment[cursor];
      if (valueOptions.has(option)) cursor += 2;
      else if (flagOptions.has(option) || (option.startsWith('--') && option.includes('='))) cursor += 1;
      else if ((option.startsWith('-c') || option.startsWith('-C')) && option.length > 2) cursor += 1;
      else return { invocations: [], parseFailed: true };
    }
    if (cursor < segment.length) invocations.push([segment[cursor], segment.slice(cursor + 1)]);
  }
  return { invocations, parseFailed: false };
}

function shellCommand(segment, index) {
  if (!shells.has(executableName(segment[index]))) return null;
  let cursor = index + 1;
  while (cursor < segment.length && segment[cursor].startsWith('-')) {
    const option = segment[cursor];
    if (!option.startsWith('--') && option.slice(1).includes('c')) {
      return cursor + 1 < segment.length ? segment[cursor + 1] : null;
    }
    cursor += 1;
  }
  return null;
}

function decision(command) {
  const tokens = tokensFor(command);
  if (!tokens) return 'Hook could not parse the pending shell command; execution is blocked.';
  for (const segment of splitSegments(tokens)) {
    for (let index = 0; index < segment.length; index += 1) {
      const nested = shellCommand(segment, index);
      if (nested !== null) {
        const nestedReason = decision(nested);
        if (nestedReason) return nestedReason;
      }
    }
    const { invocations, parseFailed } = gitInvocations(segment);
    if (parseFailed) return 'Hook could not analyze Git global options; execution is blocked.';
    for (const [verb, args] of invocations) {
      if (args.includes('--no-verify')) return 'Git verification bypass (--no-verify) is blocked by the repository Hook.';
      if (verb === 'push') {
        const positional = args.filter((token) => !token.startsWith('-'));
        if (args.some(forceOption) || positional.some((token) => token.startsWith('+'))) return 'Force push is blocked by the repository Hook.';
        if (positional.some(dynamicToken)) return 'Push destination cannot be determined statically; execution is blocked.';
        if (positional.length < 2) return 'Push destination is implicit; an explicit canonical branch ref is required.';
        if (positional.slice(1).some(protectedDestination)) return 'Direct push to protected branch main is blocked by the repository Hook.';
        if (positional.slice(1).some((token) => token === 'HEAD' || token.startsWith('HEAD:'))) return 'Ambiguous HEAD push destinations are blocked by the repository Hook.';
      }
      if (verb === 'reset' && args.includes('--hard')) return 'Destructive hard reset is blocked by the repository Hook.';
      if (verb === 'branch') {
        const deleteBranch = args.includes('-d') || args.includes('--delete') || args.some((token) => shortOptionBundleContains(token, 'd'));
        const forceDelete = args.includes('-D') || args.some((token) => shortOptionBundleContains(token, 'D')) || (deleteBranch && args.some(forceOption));
        if (forceDelete) return 'Force deletion of local branches is blocked by the repository Hook.';
      }
      if (verb === 'worktree' && args[0] === 'remove' && args.slice(1).some(forceOption)) return 'Force removal of worktrees is blocked by the repository Hook.';
    }
    for (let index = 0; index < segment.length; index += 1) {
      if (executableName(segment[index]) === 'gh' && (index === 0 || segment[index - 1] === 'command')) {
        const ghArgs = segment.slice(index + 1);
        if (ghArgs[0] === 'pr' && ghArgs[1] === 'merge') return 'Pull request merge operations are blocked by the repository Hook.';
      }
    }
  }
  return null;
}

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (!payload || typeof payload !== 'object' || !payload.tool_input || typeof payload.tool_input !== 'object') deny('Hook input was malformed; execution is blocked.');
  else if (typeof payload.tool_input.command !== 'string') deny('Hook command input was malformed; execution is blocked.');
  else {
    const reason = decision(payload.tool_input.command);
    if (reason) deny(reason);
  }
} catch {
  deny('Repository safety Hook failed closed; execution is blocked.');
}
