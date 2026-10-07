import {
  resolveWorkingDirectory,
  runExistingPullRequestUpdate,
  runIssueToPullRequest,
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
  issue: requiredArgument('issue'),
};

const reviewOnly = rawArguments.includes('--review-only');
const existingPullRequest = argumentsByName.get('update-pr');
const result = reviewOnly
  ? runIndependentReview(input)
  : existingPullRequest
    ? runExistingPullRequestUpdate(input, existingPullRequest)
    : runIssueToPullRequest(input);
console.log(JSON.stringify(result, null, 2));

if (
  result.result !== 'PASS' ||
  ('completionStatus' in result && result.completionStatus !== 'READY_FOR_HUMAN_REVIEW')
) {
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
