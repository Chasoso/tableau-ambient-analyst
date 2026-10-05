import { describe, expect, it } from 'vitest';

import {
  StdioRunBudget,
  stdioRunMaxCostUsd,
  stdioRunMaxTokens,
  stdioRunWallClockMs,
} from '../src/spike/run-budget.js';

const usage = (totalTokens: number, approximateCostUsd: number) => ({
  inputTokens: totalTokens,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens,
  approximateCostUsd,
});

describe('stdio agentic run budget', () => {
  it('allows work within the wall-clock and cumulative budgets', () => {
    const budget = new StdioRunBudget(1_000);
    budget.assertCanContinue(1_001);
    expect(budget.recordUsage(usage(1_000, 0.001))).toEqual({ totalTokens: 1_000, costUsd: 0.001 });
    budget.assertCanContinue(1_002);
  });

  it('fails closed when the wall-clock expires', () => {
    const budget = new StdioRunBudget(1_000);
    expect(() => budget.assertCanContinue(1_000 + stdioRunWallClockMs)).toThrow(
      'RUN_WALL_CLOCK_LIMIT_REACHED',
    );
  });

  it('fails closed when observed spend or tokens exceed their budget', () => {
    expect(() => new StdioRunBudget(1_000).recordUsage(usage(stdioRunMaxTokens + 1, 0))).toThrow(
      'RUN_TOKEN_BUDGET_EXCEEDED',
    );
    expect(() =>
      new StdioRunBudget(1_000).recordUsage(usage(1, stdioRunMaxCostUsd + 0.001)),
    ).toThrow('RUN_SPEND_BUDGET_EXCEEDED');
  });

  it('does not permit a next request when conservative reservation exceeds a budget', () => {
    const budget = new StdioRunBudget(1_000);
    budget.recordUsage(usage(90_000, 0.001));
    expect(() => budget.assertCanContinue(1_001)).toThrow('RUN_TOKEN_BUDGET_EXCEEDED');
  });

  it('fails closed when usage needed for the aggregate budget is unavailable', () => {
    expect(() =>
      new StdioRunBudget(1_000).recordUsage({
        inputTokens: null,
        cachedInputTokens: 0,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        approximateCostUsd: null,
      }),
    ).toThrow('RUN_USAGE_BUDGET_UNAVAILABLE');
  });
});
