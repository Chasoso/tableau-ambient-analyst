import { describe, expect, it } from 'vitest';

import {
  canOpenPullRequest,
  maxReviewCycles,
  parseReviewResult,
  reviewCycleLimitExceeded,
  reviewerInvocationFailure,
} from '../src/review/gate.js';
import { extractFinalReviewerMessage } from '../src/review/runner.js';

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
    expect(canOpenPullRequest(true, malformed)).toBe(false);
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
});
