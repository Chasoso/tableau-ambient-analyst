import type { UsageTelemetry } from './response-telemetry.js';

/** Safety limits for one opt-in agentic case; they do not choose analysis actions. */
export const stdioRunWallClockMs = 15 * 60 * 1000;
export const stdioRunMaxTokens = 100_000;
export const stdioRunMaxCostUsd = 0.05;
const reservedInputTokensPerResponse = 12_000;
const reservedOutputTokensPerResponse = 1_024;

export type RunBudgetSnapshot = {
  totalTokens: number;
  costUsd: number;
};

/**
 * Tracks one case's wall-clock, observed usage, and conservative per-request
 * reservation. On any limit or missing usage it fails closed before another
 * paid request; it never proposes a recovery or conclusion.
 */
export class StdioRunBudget {
  private totalTokens = 0;
  private costUsd = 0;

  constructor(private readonly startedAtMs = Date.now()) {}

  assertCanContinue(nowMs = Date.now()): void {
    if (nowMs - this.startedAtMs >= stdioRunWallClockMs) {
      throw new Error('RUN_WALL_CLOCK_LIMIT_REACHED');
    }
    if (this.totalTokens >= stdioRunMaxTokens) throw new Error('RUN_TOKEN_BUDGET_EXCEEDED');
    if (this.costUsd >= stdioRunMaxCostUsd) throw new Error('RUN_SPEND_BUDGET_EXCEEDED');
    const projectedTokens =
      this.totalTokens + reservedInputTokensPerResponse + reservedOutputTokensPerResponse;
    const projectedCost =
      this.costUsd +
      reservedInputTokensPerResponse * 0.2e-6 +
      reservedOutputTokensPerResponse * 1.2e-6;
    if (projectedTokens > stdioRunMaxTokens) throw new Error('RUN_TOKEN_BUDGET_EXCEEDED');
    if (projectedCost > stdioRunMaxCostUsd) throw new Error('RUN_SPEND_BUDGET_EXCEEDED');
  }

  recordUsage(usage: UsageTelemetry): RunBudgetSnapshot {
    if (usage.totalTokens === null || usage.approximateCostUsd === null) {
      throw new Error('RUN_USAGE_BUDGET_UNAVAILABLE');
    }
    this.totalTokens += usage.totalTokens;
    this.costUsd += usage.approximateCostUsd;
    if (this.totalTokens > stdioRunMaxTokens) throw new Error('RUN_TOKEN_BUDGET_EXCEEDED');
    if (this.costUsd > stdioRunMaxCostUsd) throw new Error('RUN_SPEND_BUDGET_EXCEEDED');
    return this.snapshot();
  }

  remainingWallClockMs(nowMs = Date.now()): number {
    return Math.max(0, stdioRunWallClockMs - (nowMs - this.startedAtMs));
  }

  snapshot(): RunBudgetSnapshot {
    return { totalTokens: this.totalTokens, costUsd: this.costUsd };
  }
}
