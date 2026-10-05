import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canOpenPullRequest,
  maxReviewCycles,
  parseReviewResult,
  reviewCycleLimitExceeded,
  reviewerInvocationFailure,
  validationFailure,
} from '../src/review/gate.js';
import {
  extractFinalReviewerMessage,
  reserveReviewCycleAtPath,
  runReviewControlFlow,
  type IndependentReviewInput,
  type ReviewRunnerDependencies,
} from '../src/review/runner.js';

describe('independent review gate contract', () => {
  it('opens only for a validated PASS with no blocking findings or escalation', () => {
    const result = parseReviewResult(
      JSON.stringify({
        result: 'PASS',
        blockingFindings: [],
        nonBlockingFindings: ['Optional cleanup'],
        escalationRequired: false,
      }),
    );

    expect(canOpenPullRequest(true, result)).toBe(true);
    expect(canOpenPullRequest(false, result)).toBe(false);
  });

  it('keeps CHANGES_REQUIRED closed and preserves blocking findings', () => {
    const result = parseReviewResult(
      JSON.stringify({
        result: 'CHANGES_REQUIRED',
        blockingFindings: ['Acceptance criterion is missing'],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );

    expect(result.result).toBe('CHANGES_REQUIRED');
    expect(result.blockingFindings).toHaveLength(1);
    expect(canOpenPullRequest(true, result)).toBe(false);
  });

  it('stops on human escalation, invocation failure, and malformed output', () => {
    const escalation = parseReviewResult(
      JSON.stringify({
        result: 'HUMAN_DECISION_REQUIRED',
        blockingFindings: ['Architecture choice needs human confirmation'],
        nonBlockingFindings: [],
        escalationRequired: true,
      }),
    );
    const failedInvocation = reviewerInvocationFailure('process unavailable');
    const malformed = parseReviewResult('{"result":"PASS"}');

    expect(canOpenPullRequest(true, escalation)).toBe(false);
    expect(canOpenPullRequest(true, failedInvocation)).toBe(false);
    expect(failedInvocation.executionStatus).toBe('FAILED');
    expect(canOpenPullRequest(true, malformed)).toBe(false);
    expect(malformed.executionStatus).toBe('FAILED');
  });

  it('marks valid reviewer output as completed execution', () => {
    const result = parseReviewResult(
      JSON.stringify({
        result: 'CHANGES_REQUIRED',
        blockingFindings: ['Finding'],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );

    expect(result.executionStatus).toBe('COMPLETED');
  });

  it('rejects an inconsistent PASS result', () => {
    const result = parseReviewResult(
      JSON.stringify({
        result: 'PASS',
        blockingFindings: ['Unexpected finding'],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(canOpenPullRequest(true, result)).toBe(false);
  });

  it('extracts the final structured message from Codex JSONL output', () => {
    const output = [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: JSON.stringify({
            result: 'PASS',
            blockingFindings: [],
            nonBlockingFindings: [],
            escalationRequired: false,
          }),
        },
      }),
    ].join('\n');

    expect(extractFinalReviewerMessage(output)).toContain('"result":"PASS"');
  });

  it('stops when the bounded review cycle limit is exceeded', () => {
    const result = reviewCycleLimitExceeded(maxReviewCycles + 1);

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(result.escalationRequired).toBe(true);
    expect(canOpenPullRequest(true, result)).toBe(false);
  });

  it('keeps validation failures in the implementer fix loop', () => {
    const result = validationFailure('typecheck failed');

    expect(result.result).toBe('CHANGES_REQUIRED');
    expect(result.escalationRequired).toBe(false);
    expect(canOpenPullRequest(true, result)).toBe(false);
  });
});

describe('independent review runner control flow', () => {
  const input: IndependentReviewInput = {
    cwd: '/repo',
    base: 'main',
    issue: '26',
  };

  function dependencies(
    overrides: Partial<ReviewRunnerDependencies> = {},
  ): ReviewRunnerDependencies {
    return {
      validateScope: () => undefined,
      runValidation: () => true,
      readIssue: () => ({
        title: 'Issue',
        body: 'Acceptance criteria',
        url: 'https://example.test/26',
      }),
      reserveCycle: () => undefined,
      invokeReviewer: () =>
        parseReviewResult(
          JSON.stringify({
            result: 'PASS',
            blockingFindings: [],
            nonBlockingFindings: [],
            escalationRequired: false,
          }),
        ),
      currentBranch: () => 'feature/review',
      ...overrides,
    };
  }

  it('does not launch the reviewer or consume a cycle when validation fails', () => {
    let reserved = 0;
    let invoked = 0;
    const result = runReviewControlFlow(
      input,
      dependencies({
        runValidation: () => false,
        reserveCycle: () => {
          reserved += 1;
          return undefined;
        },
        invokeReviewer: () => {
          invoked += 1;
          return reviewerInvocationFailure('unexpected invocation');
        },
      }),
    );

    expect(result.result).toBe('CHANGES_REQUIRED');
    expect(reserved).toBe(0);
    expect(invoked).toBe(0);
  });

  it.each([
    ['dirty working tree', 'Working tree is dirty.'],
    ['base branch', 'Review was requested from main.'],
    ['empty base diff', 'No committed diff exists.'],
  ])('rejects %s before validation or reviewer launch', (_caseName, error) => {
    let validated = 0;
    let invoked = 0;
    const result = runReviewControlFlow(
      input,
      dependencies({
        validateScope: () => error,
        runValidation: () => {
          validated += 1;
          return true;
        },
        invokeReviewer: () => {
          invoked += 1;
          return reviewerInvocationFailure('unexpected invocation');
        },
      }),
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(validated).toBe(0);
    expect(invoked).toBe(0);
  });

  it('does not launch the reviewer when Issue retrieval fails', () => {
    let reserved = 0;
    let invoked = 0;
    const result = runReviewControlFlow(
      input,
      dependencies({
        readIssue: () => undefined,
        reserveCycle: () => {
          reserved += 1;
          return undefined;
        },
        invokeReviewer: () => {
          invoked += 1;
          return reviewerInvocationFailure('unexpected invocation');
        },
      }),
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(reserved).toBe(0);
    expect(invoked).toBe(0);
  });

  it.each([
    ['process failure', reviewerInvocationFailure('process failed')],
    ['timeout', reviewerInvocationFailure('timed out')],
    ['non-zero exit', reviewerInvocationFailure('exited with status 1')],
    ['empty output', reviewerInvocationFailure('no final message')],
    ['malformed output', parseReviewResult('{"result":"PASS"}')],
  ])('does not open the gate for reviewer %s', (_failure, review) => {
    const result = runReviewControlFlow(input, dependencies({ invokeReviewer: () => review }));

    expect(result.result).not.toBe('PASS');
    expect(canOpenPullRequest(true, result)).toBe(false);
  });

  it('opens only for a valid PASS after validation and cycle reservation', () => {
    const events: string[] = [];
    const result = runReviewControlFlow(
      input,
      dependencies({
        runValidation: () => {
          events.push('validation');
          return true;
        },
        readIssue: () => {
          events.push('issue');
          return { title: 'Issue', body: 'Acceptance criteria', url: 'https://example.test/26' };
        },
        reserveCycle: () => {
          events.push('reserve');
          return undefined;
        },
        invokeReviewer: () => {
          events.push('review');
          return parseReviewResult(
            JSON.stringify({
              result: 'PASS',
              blockingFindings: [],
              nonBlockingFindings: [],
              escalationRequired: false,
            }),
          );
        },
      }),
    );

    expect(events).toEqual(['validation', 'issue', 'reserve', 'review']);
    expect(canOpenPullRequest(true, result)).toBe(true);
  });

  it('stops at the review cycle limit without launching Codex', () => {
    let invoked = 0;
    const result = runReviewControlFlow(
      input,
      dependencies({
        reserveCycle: () => 'Review cycle limit reached.',
        invokeReviewer: () => {
          invoked += 1;
          return reviewerInvocationFailure('unexpected invocation');
        },
      }),
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(invoked).toBe(0);
  });

  it('keeps a blocking CHANGES_REQUIRED result closed', () => {
    const result = runReviewControlFlow(
      input,
      dependencies({
        invokeReviewer: () =>
          parseReviewResult(
            JSON.stringify({
              result: 'CHANGES_REQUIRED',
              blockingFindings: ['Missing required acceptance criterion'],
              nonBlockingFindings: [],
              escalationRequired: false,
            }),
          ),
      }),
    );

    expect(result.result).toBe('CHANGES_REQUIRED');
    expect(canOpenPullRequest(true, result)).toBe(false);
  });
});

describe('review cycle state', () => {
  it('creates initial state only when the state file is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');

    try {
      expect(reserveReviewCycleAtPath(statePath, 'feature/review', 'main')).toBeUndefined();
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
        branch: 'feature/review',
        base: 'main',
        cyclesUsed: 1,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['invalid JSON', '{'],
    ['non-object JSON', 'null'],
    ['array JSON', '[]'],
    ['missing branch', JSON.stringify({ base: 'main', cyclesUsed: 0 })],
    ['non-string branch', JSON.stringify({ branch: 42, base: 'main', cyclesUsed: 0 })],
    ['non-string base', JSON.stringify({ branch: 'feature/review', base: 42, cyclesUsed: 0 })],
    [
      'non-integer cycles',
      JSON.stringify({ branch: 'feature/review', base: 'main', cyclesUsed: 1.5 }),
    ],
    ['negative cycles', JSON.stringify({ branch: 'feature/review', base: 'main', cyclesUsed: -1 })],
  ])('fails closed for %s without resetting the state', (_description, contents) => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');
    writeFileSync(statePath, contents, 'utf8');

    try {
      const error = reserveReviewCycleAtPath(statePath, 'feature/review', 'main');

      expect(error).toContain('invalid');
      expect(readFileSync(statePath, 'utf8')).toBe(contents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves the cycle limit when a valid state reaches the maximum', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');
    writeFileSync(
      statePath,
      JSON.stringify({ branch: 'feature/review', base: 'main', cyclesUsed: maxReviewCycles }),
      'utf8',
    );

    try {
      expect(reserveReviewCycleAtPath(statePath, 'feature/review', 'main')).toContain('limit');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
