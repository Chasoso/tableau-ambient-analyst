import {
  resolveWorkingDirectory,
  runExistingPullRequestUpdate,
  runIssueToPullRequest,
  runIndependentReview,
  authorizeReviewResumeAfterLimit,
  resumeReviewAfterLimit,
  currentBranch,
  type IndependentReviewInput,
} from './runner.js';
import { canonicalIssueBranch } from './issue-worktree.js';

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
const resumeAfterLimit = rawArguments.includes('--resume-after-limit');
const authorizeAfterLimit = rawArguments.includes('--authorize-resume-after-limit');
const existingPullRequest = argumentsByName.get('update-pr');
if (resumeAfterLimit && authorizeAfterLimit) {
  console.error('Authorization and resume are separate commands.');
  process.exitCode = 2;
} else if (authorizeAfterLimit) {
  const authorizationResult = authorizeFromLimit(input);
  console.log(JSON.stringify(authorizationResult, null, 2));
  if (typeof authorizationResult === 'string') process.exitCode = 1;
} else if (resumeAfterLimit) {
  const resumeResult = resumeFromLimit(input);
  console.log(JSON.stringify(resumeResult, null, 2));
  if (typeof resumeResult === 'string') process.exitCode = 1;
} else {
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
}

function requiredArgument(name: string): string {
  const value = argumentsByName.get(name);

  if (!value) {
    console.error(`Missing required argument: --${name}`);
    process.exit(2);
  }

  return value;
}

function resumeFromLimit(reviewInput: IndependentReviewInput) {
  const branchError = validateIssueBranch(reviewInput);
  if (branchError) return branchError;
  return resumeReviewAfterLimit(reviewInput.cwd, reviewInput.base);
}

function authorizeFromLimit(reviewInput: IndependentReviewInput) {
  const branchError = validateIssueBranch(reviewInput);
  if (branchError) return branchError;
  if (!rawArguments.includes('--confirm-human-authorization')) {
    return 'Human authorization requires --confirm-human-authorization.';
  }
  return authorizeReviewResumeAfterLimit(reviewInput.cwd, reviewInput.base);
}

function validateIssueBranch(reviewInput: IndependentReviewInput): string | undefined {
  const issue = requiredArgument('issue');
  let expectedBranch: string;
  try {
    expectedBranch = canonicalIssueBranch(issue);
  } catch {
    console.error('Issue number must be numeric.');
    process.exit(2);
  }
  if (currentBranch(reviewInput.cwd) !== expectedBranch) {
    return 'Review recovery requires the canonical Issue feature branch.';
  }
  return undefined;
}
