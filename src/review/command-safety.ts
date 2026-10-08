function executableName(file: string): string {
  return file.split('/').at(-1) ?? file;
}

function dynamicArgument(value: string): boolean {
  return value.includes('$') || value.includes('`');
}

function forceOption(value: string): boolean {
  return (
    value === '-f' ||
    value === '--force' ||
    value === '--force-with-lease' ||
    value.startsWith('--force=') ||
    value.startsWith('--force-with-lease=') ||
    (value.startsWith('-') && !value.startsWith('--') && value.slice(1).includes('f'))
  );
}

function shortOption(value: string, flag: string): boolean {
  return value.startsWith('-') && !value.startsWith('--') && value.slice(1).includes(flag);
}

function dangerousAlias(value: string): boolean {
  const match = /^alias\.[^=]+=([\s\S]*)$/.exec(value);
  if (!match) return false;
  const expansion = match[1]?.trim() ?? '';
  if (expansion.startsWith('!')) return true;
  return (
    (expansion.startsWith('push') &&
      (expansion.includes('force') ||
        /(^|\s)-[^\s]*f/.test(expansion) ||
        expansion.includes('$'))) ||
    (expansion.startsWith('reset') && expansion.includes('--hard')) ||
    (expansion.startsWith('branch') &&
      (/(^|\s)-[^\s]*D/.test(expansion) ||
        expansion.includes('--delete') ||
        expansion.includes('--force'))) ||
    (expansion.startsWith('worktree') &&
      expansion.includes('remove') &&
      (expansion.includes('force') || /(^|\s)-[^\s]*f/.test(expansion))) ||
    (expansion.startsWith('update-ref') && expansion.includes('refs/heads/'))
  );
}

function hasDangerousAlias(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const configEnv = option === '--config-env' || option?.startsWith('--config-env=');
    const value =
      option === '-c' || option === '--config-env'
        ? args[index + 1]
        : option?.startsWith('-c')
          ? option.slice(2)
          : option?.startsWith('--config-env=')
            ? option.slice('--config-env='.length)
            : undefined;
    if (configEnv && value?.startsWith('alias.')) return true;
    if (value && dangerousAlias(value)) return true;
  }
  return false;
}

function gitVerb(args: readonly string[]): [string | undefined, readonly string[]] {
  const valueOptions = new Set([
    '-C',
    '--config-env',
    '--exec-path',
    '--git-dir',
    '--namespace',
    '--super-prefix',
    '--work-tree',
    '-c',
  ]);
  const flagOptions = new Set([
    '--bare',
    '--no-pager',
    '--no-replace-objects',
    '--paginate',
    '--literal-pathspecs',
    '--glob-pathspecs',
    '--noglob-pathspecs',
    '--version',
    '--help',
    '-p',
    '-P',
  ]);
  let index = 0;
  while (index < args.length) {
    const option = args[index];
    if (!option?.startsWith('-')) break;
    if (valueOptions.has(option)) index += 2;
    else if (flagOptions.has(option) || (option.startsWith('--') && option.includes('=')))
      index += 1;
    else if ((option.startsWith('-c') || option.startsWith('-C')) && option.length > 2) index += 1;
    else break;
  }
  return [args[index], args.slice(index + 1)];
}

export function assertSafeChildProcess(file: string, args: readonly string[]): void {
  const executable = executableName(file);
  if (executable === 'gh') {
    let index = 0;
    while (index < args.length && args[index]?.startsWith('-'))
      index += args[index]?.includes('=') ? 1 : 2;
    if (args[index] === 'pr' && args[index + 1] === 'merge') {
      throw new Error('Pull request merge operations are blocked by the repository Hook.');
    }
    if (args[index] === 'api') {
      const apiArgs = args.slice(index + 1);
      let method: string | undefined;
      for (let apiIndex = 0; apiIndex < apiArgs.length; apiIndex += 1) {
        if (apiArgs[apiIndex] === '-X' || apiArgs[apiIndex] === '--method')
          method = apiArgs[apiIndex + 1];
        else if (apiArgs[apiIndex]?.startsWith('--method='))
          method = apiArgs[apiIndex]?.slice('--method='.length);
      }
      if (
        method?.toUpperCase() === 'PUT' &&
        apiArgs.some((argument) => /\/pulls\/[^/]+\/merge(?:$|[?])/.test(argument))
      ) {
        throw new Error('Pull request merge operations are blocked by the repository Hook.');
      }
    }
    return;
  }
  if (executable !== 'git' || args.includes('--no-verify')) {
    if (executable === 'git' && args.includes('--no-verify')) {
      throw new Error('Git verification bypass (--no-verify) is blocked by the repository Hook.');
    }
    return;
  }
  if (hasDangerousAlias(args)) {
    throw new Error(
      'Git alias injection for protected operations is blocked by the repository Hook.',
    );
  }
  const [verb, commandArgs] = gitVerb(args);
  if (verb === 'push') {
    const positional = commandArgs.filter((argument) => !argument.startsWith('-'));
    if (commandArgs.some(forceOption) || positional.some((argument) => argument.startsWith('+')))
      throw new Error('Force push is blocked by the repository Hook.');
    if (positional.some(dynamicArgument))
      throw new Error('Push destination cannot be determined statically; execution is blocked.');
    if (positional.length < 2)
      throw new Error(
        'Push destination is implicit; an explicit canonical branch ref is required.',
      );
    const destinations = positional.slice(1);
    if (
      destinations.some((argument) => {
        const destination = argument.split(':').at(-1)?.replace(/^\+/, '');
        return (
          destination === 'main' ||
          destination?.endsWith('/main') ||
          destination === 'refs/heads/main'
        );
      })
    )
      throw new Error('Direct push to protected branch main is blocked by the repository Hook.');
    if (destinations.some((argument) => argument === 'HEAD' || argument.startsWith('HEAD:')))
      throw new Error('Ambiguous HEAD push destinations are blocked by the repository Hook.');
  }
  if (
    verb === 'reset' &&
    commandArgs.some((argument) => argument === '--hard' || argument.startsWith('--hard='))
  )
    throw new Error('Destructive hard reset is blocked by the repository Hook.');
  const branchDeletion =
    commandArgs.includes('-d') ||
    commandArgs.includes('--delete') ||
    commandArgs.some((argument) => shortOption(argument, 'd'));
  if (
    verb === 'branch' &&
    (commandArgs.some((argument) => argument === '-D' || shortOption(argument, 'D')) ||
      (branchDeletion &&
        commandArgs.some((argument) => argument === '--force' || forceOption(argument))))
  )
    throw new Error('Force deletion of local branches is blocked by the repository Hook.');
  if (verb === 'update-ref' && commandArgs.includes('--stdin'))
    throw new Error(
      'Update-ref stdin operations cannot be determined statically; execution is blocked.',
    );
  if (
    verb === 'update-ref' &&
    commandArgs.some((argument) => argument.startsWith('refs/heads/')) &&
    commandArgs.some((argument) => /^0{40}$|^0{64}$/.test(argument))
  ) {
    throw new Error('Deletion of local branch refs is blocked by the repository Hook.');
  }
  if (
    verb === 'update-ref' &&
    (commandArgs.includes('-d') || commandArgs.includes('--delete')) &&
    commandArgs.some((argument) => argument.startsWith('refs/heads/'))
  ) {
    throw new Error('Deletion of local branch refs is blocked by the repository Hook.');
  }
  if (verb === 'worktree' && commandArgs[0] === 'remove' && commandArgs.slice(1).some(forceOption))
    throw new Error('Force removal of worktrees is blocked by the repository Hook.');
}
