import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canOpenPullRequest,
  canContinueAutoFix,
  maxAutoFixCycles,
  maxReviewCycles,
  normalizedFindingCategory,
  parseReviewResult,
  reviewCycleLimitExceeded,
  reviewerInvocationFailure,
  requiresHumanDecision,
  validationFailure,
  type ReviewAccounting,
} from '../src/review/gate.js';
import {
  autoFixAllowedPaths,
  buildReviewerPrompt,
  extractFinalReviewerMessage,
  reserveReviewCycleAtPath,
  readReviewAccountingAtPath,
  runBoundedReviewFixLoop,
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

  it.each([
    ['FAILED', { executionStatus: 'FAILED' as const }],
    ['omitted', {}],
  ])('keeps a PASS closed when execution status is %s', (_label, status) => {
    const result = {
      result: 'PASS' as const,
      blockingFindings: [],
      nonBlockingFindings: [],
      escalationRequired: false,
      ...status,
    };

    expect(canOpenPullRequest(true, result)).toBe(false);
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

  it('fails closed for inconsistent severity and hidden escalation', () => {
    const finding = {
      severity: 'non-blocking',
      classification: 'AUTO_FIX',
      finding: 'Finding',
      generalized_rule: 'Rule',
      affected_locations: ['src/example.ts'],
      recommended_fix: 'Fix',
    };
    expect(
      parseReviewResult(
        JSON.stringify({
          result: 'CHANGES_REQUIRED',
          blockingFindings: [finding],
          nonBlockingFindings: [],
          escalationRequired: false,
        }),
      ).executionStatus,
    ).toBe('FAILED');

    const humanFinding = { ...finding, classification: 'HUMAN_DECISION_REQUIRED' };
    const hiddenHuman = parseReviewResult(
      JSON.stringify({
        result: 'PASS',
        blockingFindings: [],
        nonBlockingFindings: [{ ...humanFinding, severity: 'non-blocking' }],
        escalationRequired: false,
      }),
    );
    expect(hiddenHuman.executionStatus).toBe('FAILED');

    const hiddenResultEscalation = parseReviewResult(
      JSON.stringify({
        result: 'HUMAN_DECISION_REQUIRED',
        blockingFindings: [],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );
    expect(hiddenResultEscalation.executionStatus).toBe('FAILED');
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

  it('allows only explicit AUTO_FIX findings to continue without human approval', () => {
    const autoFix = parseReviewResult(
      JSON.stringify({
        result: 'CHANGES_REQUIRED',
        blockingFindings: [
          {
            severity: 'blocking',
            classification: 'AUTO_FIX',
            finding: 'Unknown properties are accepted.',
            generalized_rule: 'External boundary objects reject unknown properties.',
            affected_locations: ['src/review/review-result.schema.json'],
            recommended_fix: 'Add the missing closed schema.',
          },
        ],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );
    expect(canContinueAutoFix(autoFix)).toBe(true);
    expect(requiresHumanDecision(autoFix)).toBe(false);
  });

  it('escalates genuine decisions and missing prerequisites', () => {
    for (const classification of ['HUMAN_DECISION_REQUIRED', 'BLOCKED'] as const) {
      const result = parseReviewResult(
        JSON.stringify({
          result: 'CHANGES_REQUIRED',
          blockingFindings: [
            {
              severity: 'blocking',
              classification,
              finding: 'The workflow cannot continue.',
              generalized_rule: 'The repository boundary must be respected.',
              affected_locations: ['AGENTS.md'],
              recommended_fix: 'Decide or provide the missing prerequisite.',
            },
          ],
          nonBlockingFindings: [],
          escalationRequired: false,
        }),
      );
      expect(canContinueAutoFix(result)).toBe(false);
      expect(requiresHumanDecision(result)).toBe(true);
    }
  });

  it('requires generalized rule and sibling locations for structured findings', () => {
    const result = parseReviewResult(
      JSON.stringify({
        result: 'CHANGES_REQUIRED',
        blockingFindings: [
          {
            severity: 'blocking',
            classification: 'AUTO_FIX',
            finding: 'One boundary is not fail-closed.',
            generalized_rule: 'External boundaries reject unknown input.',
            affected_locations: ['src/a.ts', 'src/b.ts'],
            recommended_fix: 'Apply the existing validation policy to siblings.',
          },
        ],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );
    expect(result.blockingFindings[0]).toMatchObject({
      generalized_rule: expect.stringContaining('External boundaries'),
      affected_locations: ['src/a.ts', 'src/b.ts'],
    });
  });
});

describe('independent review runner control flow', () => {
  const input: IndependentReviewInput = {
    cwd: '/repo',
    base: 'main',
    issue: '26',
  };

  function autoFixReview(rule: string): ReturnType<typeof parseReviewResult> {
    return parseReviewResult(
      JSON.stringify({
        result: 'CHANGES_REQUIRED',
        blockingFindings: [
          {
            severity: 'blocking',
            classification: 'AUTO_FIX',
            finding: `Finding for ${rule}`,
            generalized_rule: rule,
            affected_locations: ['src/example.ts'],
            recommended_fix: 'Apply the deterministic repository rule.',
          },
        ],
        nonBlockingFindings: [],
        escalationRequired: false,
      }),
    );
  }

  function dependencies(
    overrides: Partial<ReviewRunnerDependencies> = {},
  ): ReviewRunnerDependencies {
    let accounting: ReviewAccounting = {
      reviewInvocationCount: 0,
      autoFixCycleCount: 0,
      generalizedRuleHistory: [] as string[],
      consecutiveRepeatCount: 0,
      lastFixChangedRepository: null as boolean | null,
      cycleResults: [],
    };
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
      readAccounting: () => accounting,
      recordReview: (_cwd, _base, review) => {
        const rules = review.blockingFindings
          .filter((finding) => typeof finding !== 'string')
          .map(normalizedFindingCategory);
        const nextRules = [...new Set(rules)];
        const consecutiveRepeatCount = nextRules.reduce((maximum, rule) => {
          let count = 0;
          for (let index = accounting.cycleResults.length - 1; index >= 0; index -= 1) {
            const record = accounting.cycleResults[index];
            if (!record || !record.generalizedRules.includes(rule)) break;
            count += 1;
          }
          return Math.max(maximum, count + 1);
        }, 0);
        accounting = {
          ...accounting,
          reviewInvocationCount: accounting.reviewInvocationCount + 1,
          generalizedRuleHistory: rules.length
            ? [...accounting.generalizedRuleHistory, ...rules]
            : accounting.generalizedRuleHistory,
          consecutiveRepeatCount,
          cycleResults: [
            ...accounting.cycleResults,
            {
              reviewInvocation: accounting.reviewInvocationCount + 1,
              result: review.result,
              classifications: [],
              generalizedRules: rules,
              repositoryChanged: null,
            },
          ],
        };
        return accounting;
      },
      recordAutoFix: (_cwd, _base, changedRepository) => {
        accounting = {
          ...accounting,
          autoFixCycleCount: accounting.autoFixCycleCount + (changedRepository ? 1 : 0),
          lastFixChangedRepository: changedRepository,
        };
        return accounting;
      },
      recordTermination: (_cwd, _base, terminationReason) => {
        if (terminationReason) accounting = { ...accounting, terminationReason };
        return accounting;
      },
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
        reserveCycle: () => 'Review invocation limit of 12 reached for feature/review.',
        invokeReviewer: () => {
          invoked += 1;
          return reviewerInvocationFailure('unexpected invocation');
        },
      }),
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(result.terminationReason).toBe('MAX_REVIEW_INVOCATIONS');
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

  it('continues AUTO_FIX through validation and a fresh review', () => {
    let reviews = 0;
    let validations = 0;
    let fixes = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        runValidation: () => {
          validations += 1;
          return true;
        },
        invokeReviewer: () => {
          reviews += 1;
          return reviews === 1
            ? parseReviewResult(
                JSON.stringify({
                  result: 'CHANGES_REQUIRED',
                  blockingFindings: [
                    {
                      severity: 'blocking',
                      classification: 'AUTO_FIX',
                      finding: 'Deterministic gap',
                      generalized_rule: 'Existing rule applies to siblings.',
                      affected_locations: ['src/a.ts', 'src/b.ts'],
                      recommended_fix: 'Apply the existing rule to both.',
                    },
                  ],
                  nonBlockingFindings: [],
                  escalationRequired: false,
                }),
              )
            : parseReviewResult(
                JSON.stringify({
                  result: 'PASS',
                  blockingFindings: [],
                  nonBlockingFindings: [],
                  escalationRequired: false,
                }),
              );
        },
      }),
      () => {
        fixes += 1;
        return { changedRepository: true };
      },
    );

    expect(result.result).toBe('PASS');
    expect(fixes).toBe(1);
    expect(validations).toBe(2);
    expect(reviews).toBe(2);
    expect(result.accounting?.reviewInvocationCount).toBe(2);
    expect(result.accounting?.autoFixCycleCount).toBe(1);
  });

  it('does not count a PASS or result-capture retry as an AUTO_FIX cycle', () => {
    let fixes = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        invokeReviewer: () =>
          parseReviewResult(
            JSON.stringify({
              result: 'PASS',
              blockingFindings: [],
              nonBlockingFindings: [],
              escalationRequired: false,
            }),
          ),
      }),
      () => {
        fixes += 1;
        return { changedRepository: true };
      },
    );

    expect(result.result).toBe('PASS');
    expect(result.accounting?.reviewInvocationCount).toBe(1);
    expect(result.accounting?.autoFixCycleCount).toBe(0);
    expect(fixes).toBe(0);
  });

  it('stops the AUTO_FIX loop when the bounded cycle limit is reached', () => {
    let fixes = 0;
    let reviews = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        invokeReviewer: () => {
          reviews += 1;
          return autoFixReview(`distinct rule ${reviews}`);
        },
      }),
      () => {
        fixes += 1;
        return { changedRepository: true };
      },
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(result.terminationReason).toBe('MAX_AUTO_FIX_CYCLES');
    expect(
      result.blockingFindings.some(
        (finding) => typeof finding === 'string' && finding.includes('AUTO_FIX cycle limit'),
      ),
    ).toBe(true);
    expect(fixes).toBe(maxAutoFixCycles);
  });

  it('continues across different generalized rules within both limits', () => {
    const rules = [
      'schema validation',
      'stale documentation',
      'dependency pinning',
      'evidence verifier',
    ];
    let reviews = 0;
    let fixes = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        invokeReviewer: () => {
          const rule = rules[reviews];
          reviews += 1;
          return rule
            ? autoFixReview(rule)
            : parseReviewResult(
                JSON.stringify({
                  result: 'PASS',
                  blockingFindings: [],
                  nonBlockingFindings: [],
                  escalationRequired: false,
                }),
              );
        },
      }),
      () => {
        fixes += 1;
        return { changedRepository: true };
      },
    );

    expect(result.result).toBe('PASS');
    expect(reviews).toBe(5);
    expect(fixes).toBe(4);
    expect(result.accounting?.consecutiveRepeatCount).toBe(0);
  });

  it('escalates after the same generalized rule repeats three times', () => {
    let fixes = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({ invokeReviewer: () => autoFixReview('same external-boundary rule') }),
      () => {
        fixes += 1;
        return { changedRepository: true };
      },
    );

    expect(result.result).toBe('HUMAN_DECISION_REQUIRED');
    expect(result.terminationReason).toBe('NON_CONVERGING_REVIEW');
    expect(result.accounting?.consecutiveRepeatCount).toBe(3);
    expect(fixes).toBe(2);
  });

  it('tracks a repeated generalized rule when it is not the first finding', () => {
    let reviews = 0;
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        invokeReviewer: () => {
          reviews += 1;
          return parseReviewResult(
            JSON.stringify({
              result: 'CHANGES_REQUIRED',
              blockingFindings: [
                {
                  severity: 'blocking',
                  classification: 'AUTO_FIX',
                  finding: 'First finding',
                  generalized_rule: `different rule ${reviews}`,
                  affected_locations: ['src/example.ts'],
                  recommended_fix: 'Apply the deterministic rule.',
                },
                {
                  severity: 'blocking',
                  classification: 'AUTO_FIX',
                  finding: 'Repeated finding',
                  generalized_rule: 'repeated second rule',
                  affected_locations: ['src/example.ts'],
                  recommended_fix: 'Apply the deterministic rule.',
                },
              ],
              nonBlockingFindings: [],
              escalationRequired: false,
            }),
          );
        },
      }),
      () => ({ changedRepository: true }),
    );

    expect(result.terminationReason).toBe('NON_CONVERGING_REVIEW');
    expect(result.accounting?.consecutiveRepeatCount).toBe(3);
    expect(reviews).toBe(3);
  });

  it('escalates when AUTO_FIX makes no repository change', () => {
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({ invokeReviewer: () => autoFixReview('missing fail-closed handling') }),
      () => ({ changedRepository: false }),
    );

    expect(result.terminationReason).toBe('NO_PROGRESS');
    expect(result.accounting?.autoFixCycleCount).toBe(0);
    expect(result.accounting?.lastFixChangedRepository).toBe(false);
  });

  it('escalates when the AUTO_FIX callback returns no result', () => {
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({ invokeReviewer: () => autoFixReview('missing explicit result') }),
      () => undefined as never,
    );

    expect(result.terminationReason).toBe('NO_PROGRESS');
    expect(result.accounting?.autoFixCycleCount).toBe(0);
  });

  it('does not run another review after a persisted terminal state', () => {
    let invoked = 0;
    const accounting: ReviewAccounting = {
      reviewInvocationCount: 3,
      autoFixCycleCount: 2,
      generalizedRuleHistory: ['same rule'],
      consecutiveRepeatCount: 3,
      lastFixChangedRepository: true,
      cycleResults: [],
      terminationReason: 'NON_CONVERGING_REVIEW',
    };
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        readAccounting: () => accounting,
        invokeReviewer: () => {
          invoked += 1;
          return autoFixReview('unexpected');
        },
      }),
      () => ({ changedRepository: true }),
    );

    expect(result.terminationReason).toBe('NON_CONVERGING_REVIEW');
    expect(invoked).toBe(0);
  });

  it('stops at the independent review invocation limit separately from AUTO_FIX cycles', () => {
    let reviews = 0;
    const limitAccounting = {
      reviewInvocationCount: 11,
      autoFixCycleCount: 0,
      generalizedRuleHistory: [] as string[],
      consecutiveRepeatCount: 0,
      lastFixChangedRepository: null as boolean | null,
      cycleResults: [],
    };
    const result = runBoundedReviewFixLoop(
      input,
      dependencies({
        readAccounting: () => limitAccounting,
        recordReview: () => ({ ...limitAccounting, reviewInvocationCount: 12 }),
        recordTermination: () => ({
          ...limitAccounting,
          reviewInvocationCount: 12,
          terminationReason: 'MAX_REVIEW_INVOCATIONS' as const,
        }),
        invokeReviewer: () => {
          reviews += 1;
          return autoFixReview(`rule-${reviews}`);
        },
      }),
      () => ({ changedRepository: true }),
    );

    expect(result.terminationReason).toBe('MAX_REVIEW_INVOCATIONS');
    expect(result.accounting?.reviewInvocationCount).toBe(12);
    expect(result.accounting?.autoFixCycleCount).toBe(0);
  });
});

describe('independent review scope context', () => {
  it('provides Issue #17 scope context without prescribing a result', () => {
    const prompt = buildReviewerPrompt(
      { cwd: '/repo', base: 'main', issue: '17' },
      { title: 'Issue', body: 'Body', url: 'https://example.test/issues/17' },
      ['npm run validate: passed'],
      'spike/issue-17-agentic-tableau-mcp',
    );

    expect(prompt).toContain('remaining #16 benchmark cases');
    expect(prompt).toContain('and Bedrock live comparisons are deferred');
    expect(prompt).toContain('superseded by the Canonical Final Result');
    expect(prompt).toContain('This is scope context only');
    expect(prompt).not.toContain('return PASS');
  });
});

describe('review cycle state', () => {
  it('migrates the known Issue #29 legacy state without resetting either bound', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');
    writeFileSync(
      statePath,
      JSON.stringify({
        branch: 'feat/issue-29-autonomous-issue-to-pr',
        base: 'main',
        cyclesUsed: 6,
      }),
      'utf8',
    );

    try {
      expect(
        readReviewAccountingAtPath(statePath, 'feat/issue-29-autonomous-issue-to-pr', 'main'),
      ).toMatchObject({
        reviewInvocationCount: 6,
        autoFixCycleCount: 1,
        generalizedRuleHistory: [],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when legacy AUTO_FIX accounting cannot be recovered', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');
    const contents = JSON.stringify({ branch: 'feature/review', base: 'main', cyclesUsed: 6 });
    writeFileSync(statePath, contents, 'utf8');

    try {
      expect(() => readReviewAccountingAtPath(statePath, 'feature/review', 'main')).toThrow(
        'invalid',
      );
      expect(readFileSync(statePath, 'utf8')).toBe(contents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates initial state only when the state file is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-state-'));
    const statePath = join(directory, 'state.json');

    try {
      expect(reserveReviewCycleAtPath(statePath, 'feature/review', 'main')).toBeUndefined();
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
        branch: 'feature/review',
        base: 'main',
        reviewInvocationCount: 1,
        autoFixCycleCount: 0,
        generalizedRuleHistory: [],
        consecutiveRepeatCount: 0,
        lastFixChangedRepository: null,
        cycleResults: [],
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
    [
      'unknown termination reason',
      JSON.stringify({
        branch: 'feature/review',
        base: 'main',
        reviewInvocationCount: 1,
        autoFixCycleCount: 0,
        generalizedRuleHistory: [],
        consecutiveRepeatCount: 0,
        lastFixChangedRepository: null,
        cycleResults: [],
        terminationReason: 'UNKNOWN',
      }),
    ],
    [
      'malformed cycle record',
      JSON.stringify({
        branch: 'feature/review',
        base: 'main',
        reviewInvocationCount: 1,
        autoFixCycleCount: 0,
        generalizedRuleHistory: [],
        consecutiveRepeatCount: 0,
        lastFixChangedRepository: null,
        cycleResults: [{ reviewInvocation: 1, result: 'PASS' }],
      }),
    ],
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
      JSON.stringify({
        branch: 'feature/review',
        base: 'main',
        reviewInvocationCount: maxReviewCycles,
        autoFixCycleCount: 0,
        generalizedRuleHistory: [],
        consecutiveRepeatCount: 0,
        lastFixChangedRepository: null,
        cycleResults: [],
      }),
      'utf8',
    );

    try {
      expect(reserveReviewCycleAtPath(statePath, 'feature/review', 'main')).toContain('limit');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('AUTO_FIX path scope', () => {
  it('rejects absolute, traversal, .git, and symlink targets while allowing safe siblings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambient-review-paths-'));
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'src', 'tracked.ts'), 'export {};\n');
    writeFileSync(join(directory, 'src', 'base-only.ts'), 'export {};\n');
    symlinkSync(join(directory, 'src', 'tracked.ts'), join(directory, 'src', 'link.ts'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: directory });
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'],
      { cwd: directory },
    );
    writeFileSync(join(directory, 'outside.ts'), 'export {};\n');
    execFileSync('git', ['checkout', '-qb', 'feature/review'], { cwd: directory });
    writeFileSync(join(directory, 'src', 'tracked.ts'), 'export { changed };\n');
    execFileSync('git', ['add', 'src/tracked.ts'], { cwd: directory });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'change'],
      { cwd: directory },
    );

    const finding = (location: string) => ({
      result: 'CHANGES_REQUIRED' as const,
      blockingFindings: [
        {
          severity: 'blocking' as const,
          classification: 'AUTO_FIX' as const,
          finding: 'finding',
          generalized_rule: 'rule',
          affected_locations: [location],
          recommended_fix: 'fix',
        },
      ],
      nonBlockingFindings: [],
      escalationRequired: false,
    });

    try {
      for (const location of [
        `${join(directory, 'src', 'tracked.ts')}:1`,
        '../src/tracked.ts:1',
        '.git/config:1',
        'src/link.ts:1',
      ]) {
        expect(autoFixAllowedPaths(finding(location), directory, 'main')).toBe(
          'AUTO_FIX finding contains an invalid repository path.',
        );
      }
      expect(autoFixAllowedPaths(finding('src/tracked.ts:1'), directory, 'main')).toEqual([
        'src/tracked.ts',
      ]);
      expect(autoFixAllowedPaths(finding('src/base-only.ts:1'), directory, 'main')).toEqual([
        'src/base-only.ts',
      ]);
      expect(autoFixAllowedPaths(finding('outside.ts:1'), directory, 'main')).toEqual([
        'outside.ts',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
