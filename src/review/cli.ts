import {
  currentBranch,
  resolveWorkingDirectory,
  runIndependentReview,
  type IndependentReviewInput,
} from './runner.js';

const argumentsByName = new Map<string, string>();
const rawArguments = process.argv.slice(2);

for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  const value = rawArguments[index + 1];

  if (argument?.startsWith('--') && value && !value.startsWith('--')) {
    argumentsByName.set(argument.slice(2), value);
    index += 1;
  }
}

const cwd = resolveWorkingDirectory(argumentsByName.get('cwd') ?? process.cwd());
const input: IndependentReviewInput = {
  cwd,
  base: argumentsByName.get('base') ?? 'main',
  branch: argumentsByName.get('branch') ?? currentBranch(cwd),
  issue: requiredArgument('issue'),
  validation: (
    argumentsByName.get('validation') ?? 'npm run validate: executed by review command'
  ).split('|'),
};

const result = runIndependentReview(input);
console.log(JSON.stringify(result, null, 2));

if (result.result !== 'PASS') {
  process.exitCode = 1;
}

function requiredArgument(name: string): string {
  const value = argumentsByName.get(name);

  if (!value) {
    console.error(`Missing required argument: --${name}`);
    process.exit(2);
  }

  return value;
}
