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
    else if (character === '\n') {
      flush();
      tokens.push(';');
    } else if (/\s/.test(character)) flush();
    else if (character === '(' || character === ')') {
      flush();
      tokens.push(character);
    } else if (character === ';' || character === '|' || character === '&') {
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

function commandIndex(segment) {
  let index = 0;
  while (index < segment.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) {
      index += 1;
      continue;
    }
    if (segment[index] === '!') {
      index += 1;
      continue;
    }
    if (segment[index] === 'time') {
      index += 1;
      while (index < segment.length && segment[index].startsWith('-')) index += 1;
      continue;
    }
    if (segment[index] === 'exec') {
      index += 1;
      continue;
    }
    if (segment[index] === 'command') {
      index += 1;
      while (index < segment.length && segment[index].startsWith('-')) index += 1;
      continue;
    }
    if (segment[index] === 'env') {
      index += 1;
      while (index < segment.length && (segment[index].includes('=') || segment[index].startsWith('-'))) index += 1;
      continue;
    }
    if (segment[index] === 'sudo') {
      index += 1;
      while (index < segment.length && segment[index].startsWith('-')) {
        const option = segment[index];
        if (option === '-u' || option === '--user' || option === '-g' || option === '--group' || option === '--host' || option === '-p' || option === '--prompt') index += 2;
        else index += 1;
      }
      continue;
    }
    break;
  }
  return index;
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
    token === '--{force}' || token === '--{force-with-lease}' ||
    shortOptionBundleContains(token, 'f');
}

function protectedDestination(refspec) {
  const destination = refspec.split(':').at(-1).replace(/^\+/, '');
  return destination === 'main' || destination.endsWith('/main') || destination === 'refs/heads/main';
}

function dynamicToken(token) {
  return token.includes('$') || token.includes('`');
}

function braceExpansion(token) {
  return /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(token);
}

function dangerousAlias(value) {
  const match = /^alias\.[^=]+=([\s\S]*)$/.exec(value);
  if (!match) return false;
  const expansion = match[1].trim();
  if (expansion.startsWith('!')) return true;
  return Boolean(decision(`git ${expansion}`));
}

function configEnvAlias(value) {
  return value.startsWith('alias.');
}

function unsupportedControlStructure(tokens) {
  const hasIfStructure = tokens.includes('if') && (tokens.includes('then') || tokens.includes('fi'));
  const hasGroupStructure = tokens.includes('{') || tokens.includes('}') || tokens.includes('(') || tokens.includes(')');
  if (!hasIfStructure && !hasGroupStructure) return false;
  return tokens.some((token, index) => {
    if (executableName(token) !== 'git' && executableName(token) !== 'gh') return false;
    return hasIfStructure || index === 0 || ['then', '{', '('].includes(tokens[index - 1]);
  });
}

function substitutionReason(command) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '\\') escaped = true;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === "'") {
      quote = character;
      continue;
    }
    if (character === '`') {
      const end = command.indexOf('`', index + 1);
      if (end === -1) return 'Executable shell substitution cannot be analyzed safely; execution is blocked.';
      const reason = decision(command.slice(index + 1, end));
      if (reason) return reason;
      index = end;
      continue;
    }
    if (character === '$' && command[index + 1] === '(') {
      let depth = 1;
      let end = index + 2;
      while (end < command.length && depth > 0) {
        if (command[end] === '(') depth += 1;
        else if (command[end] === ')') depth -= 1;
        end += 1;
      }
      if (depth !== 0) return 'Executable shell substitution cannot be analyzed safely; execution is blocked.';
      const reason = decision(command.slice(index + 2, end - 1));
      if (reason) return reason;
      index = end - 1;
    }
  }
  return null;
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
    if (index !== commandIndex(segment) || executableName(segment[index]) !== 'git') continue;
    let cursor = index + 1;
    while (cursor < segment.length && segment[cursor].startsWith('-')) {
      const option = segment[cursor];
      if (option === '-c') {
        if (dangerousAlias(segment[cursor + 1] ?? '')) return { invocations: [], parseFailed: true };
        cursor += 2;
      } else if (option.startsWith('-c') && option.length > 2) {
        if (dangerousAlias(option.slice(2))) return { invocations: [], parseFailed: true };
        cursor += 1;
      } else if (option === '--config-env') {
        if (configEnvAlias(segment[cursor + 1] ?? '')) return { invocations: [], parseFailed: true };
        cursor += 2;
      } else if (option.startsWith('--config-env=')) {
        if (configEnvAlias(option.slice('--config-env='.length))) return { invocations: [], parseFailed: true };
        cursor += 1;
      } else if (valueOptions.has(option)) cursor += 2;
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
  const substitution = substitutionReason(command);
  if (substitution) return substitution;
  if (unsupportedControlStructure(tokens)) {
    return 'Unsupported shell control structure may hide a protected Git or GitHub operation; execution is blocked.';
  }
  for (const segment of splitSegments(tokens)) {
    const executableIndex = commandIndex(segment);
    if (executableName(segment[executableIndex]) === 'eval') {
      const evalArguments = segment.slice(executableIndex + 1);
      if (evalArguments.length !== 1 || dynamicToken(evalArguments[0])) {
        return 'Eval command content cannot be determined statically; execution is blocked.';
      }
      const evalReason = decision(evalArguments[0]);
      if (evalReason) return evalReason;
    }
    for (let index = 0; index < segment.length; index += 1) {
      const nested = shellCommand(segment, index);
      if (nested !== null) {
        const nestedTokens = tokensFor(nested);
        if (!nestedTokens || nested.startsWith('$') || nested.startsWith('`') || (nestedTokens.length === 1 && dynamicToken(nestedTokens[0]))) {
          return 'Shell wrapper command cannot be determined statically; execution is blocked.';
        }
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
        if (args.some(braceExpansion)) return 'Protected Git arguments with brace expansion cannot be determined statically; execution is blocked.';
        if (args.some(forceOption) || positional.some((token) => token.startsWith('+'))) return 'Force push is blocked by the repository Hook.';
        if (positional.some(dynamicToken)) return 'Push destination cannot be determined statically; execution is blocked.';
        if (positional.length < 2) return 'Push destination is implicit; an explicit canonical branch ref is required.';
        if (positional.slice(1).some(protectedDestination)) return 'Direct push to protected branch main is blocked by the repository Hook.';
        if (positional.slice(1).some((token) => token === 'HEAD' || token.startsWith('HEAD:'))) return 'Ambiguous HEAD push destinations are blocked by the repository Hook.';
      }
      if (verb === 'reset' && args.some((argument) => argument === '--hard' || argument.startsWith('--hard='))) return 'Destructive hard reset is blocked by the repository Hook.';
      if (verb === 'branch') {
        if (args.some(braceExpansion)) return 'Protected Git arguments with brace expansion cannot be determined statically; execution is blocked.';
        const deleteBranch = args.includes('-d') || args.includes('--delete') || args.some((token) => shortOptionBundleContains(token, 'd'));
        const forceDelete = args.includes('-D') || args.some((token) => shortOptionBundleContains(token, 'D')) || (deleteBranch && args.some(forceOption));
        if (forceDelete) return 'Force deletion of local branches is blocked by the repository Hook.';
      }
      if (verb === 'update-ref' && (args.includes('-d') || args.includes('--delete')) && args.some((argument) => argument.startsWith('refs/heads/'))) {
        return 'Deletion of local branch refs is blocked by the repository Hook.';
      }
      if (verb === 'update-ref' && args.includes('--stdin')) {
        return 'Update-ref stdin operations cannot be determined statically; execution is blocked.';
      }
      if (verb === 'update-ref' && args.some((argument) => argument.startsWith('refs/heads/')) && args.some((argument) => /^0{40}$|^0{64}$/.test(argument))) {
        return 'Deletion of local branch refs is blocked by the repository Hook.';
      }
      if (verb === 'worktree' && args[0] === 'remove') {
        if (args.some(braceExpansion)) return 'Protected Git arguments with brace expansion cannot be determined statically; execution is blocked.';
        if (args.slice(1).some(forceOption)) return 'Force removal of worktrees is blocked by the repository Hook.';
      }
    }
    for (let index = 0; index < segment.length; index += 1) {
      if (index === commandIndex(segment) && executableName(segment[index]) === 'gh') {
        const ghArgs = segment.slice(index + 1);
        let ghCursor = 0;
        while (ghCursor < ghArgs.length && ghArgs[ghCursor].startsWith('-')) {
          ghCursor += ghArgs[ghCursor].includes('=') ? 1 : 2;
        }
        if (ghArgs[ghCursor] === 'pr' && ghArgs[ghCursor + 1] === 'merge') return 'Pull request merge operations are blocked by the repository Hook.';
        if (ghArgs[ghCursor] === 'api') {
          const apiArgs = ghArgs.slice(ghCursor + 1);
          let method;
          for (let apiIndex = 0; apiIndex < apiArgs.length; apiIndex += 1) {
            if (apiArgs[apiIndex] === '-X' || apiArgs[apiIndex] === '--method') method = apiArgs[apiIndex + 1];
            else if (apiArgs[apiIndex]?.startsWith('--method=')) method = apiArgs[apiIndex].slice('--method='.length);
          }
          const endpoint = apiArgs.find((argument) => /\/pulls\/[^/]+\/merge(?:$|[?])/.test(argument));
          if (String(method).toUpperCase() === 'PUT' && endpoint) return 'Pull request merge operations are blocked by the repository Hook.';
        }
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
