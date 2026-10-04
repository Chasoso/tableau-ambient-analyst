export type OutcomeType = 'supported' | 'revised' | 'rejected' | 'insufficient-evidence';
export type HypothesisState = 'maintained' | 'revised' | 'rejected' | 'not-applicable';
export type StopReason =
  'sufficient-evidence' | 'insufficient-evidence' | 'tool-error' | 'limit-reached' | 'other';

export type StructuredOutcome = {
  outcome: OutcomeType;
  summary: string;
  evidence_complete: boolean;
  missing_evidence: string[];
  hypothesis_state: HypothesisState;
  stop_reason: StopReason;
};

export type ToolCallTelemetry = {
  sequence: number;
  name: string | null;
  parameterKeys: string[];
  datasourceLuidPresent: boolean;
  queryType: string | null;
  resultRowCount: number | null;
  empty: boolean | null;
  error: unknown;
};

export type UsageTelemetry = {
  inputTokens: number | null;
  cachedInputTokens: number;
  outputTokens: number | null;
  totalTokens: number | null;
  approximateCostUsd: number | null;
};

type OutputItem = {
  type?: unknown;
  name?: unknown;
  error?: unknown;
  arguments?: unknown;
  output?: unknown;
  content?: unknown;
  text?: unknown;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function textFromOutputValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => textFromOutputValue(item));
  if (typeof value !== 'object' || value === null) return [];
  const item = value as Record<string, unknown>;
  const texts: string[] = [];
  if (typeof item.text === 'string') texts.push(item.text);
  if (item.content !== undefined) texts.push(...textFromOutputValue(item.content));
  return texts;
}

export function extractFinalAnswer(
  output: readonly OutputItem[],
  topLevelOutputText?: unknown,
): string {
  return [
    ...textFromOutputValue(topLevelOutputText),
    ...output
      .filter((item) => item.type === 'message' || item.type === 'output_text')
      .flatMap((item) => textFromOutputValue(item)),
  ]
    .join('\n')
    .trim()
    .slice(0, 2000);
}

function readField(record: Record<string, unknown>, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

export function extractStructuredOutcome(finalAnswer: string): StructuredOutcome | null {
  const match = finalAnswer.match(/\{[\s\S]*\}/);
  const parsed = match === null ? null : parseJson(match[0]);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const outcome = readField(record, 'outcome', 'outcome');
  const summary = readField(record, 'summary', 'summary');
  const evidenceComplete = readField(record, 'evidenceComplete', 'evidence_complete');
  const missingEvidence = readField(record, 'missingEvidence', 'missing_evidence');
  const hypothesisState = readField(record, 'hypothesisState', 'hypothesis_state');
  const stopReason = readField(record, 'stopReason', 'stop_reason');
  const validOutcomes = new Set<OutcomeType>([
    'supported',
    'revised',
    'rejected',
    'insufficient-evidence',
  ]);
  const validHypothesisStates = new Set<HypothesisState>([
    'maintained',
    'revised',
    'rejected',
    'not-applicable',
  ]);
  const validStopReasons = new Set<StopReason>([
    'sufficient-evidence',
    'insufficient-evidence',
    'tool-error',
    'limit-reached',
    'other',
  ]);
  if (
    !validOutcomes.has(outcome as OutcomeType) ||
    typeof summary !== 'string' ||
    typeof evidenceComplete !== 'boolean' ||
    !Array.isArray(missingEvidence) ||
    !missingEvidence.every((value) => typeof value === 'string') ||
    !validHypothesisStates.has(hypothesisState as HypothesisState) ||
    !validStopReasons.has(stopReason as StopReason)
  ) {
    return null;
  }
  return {
    outcome: outcome as OutcomeType,
    summary,
    evidence_complete: evidenceComplete,
    missing_evidence: missingEvidence as string[],
    hypothesis_state: hypothesisState as HypothesisState,
    stop_reason: stopReason as StopReason,
  };
}

export function resultRowCount(value: unknown): number | null {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed.length;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  for (const key of ['rows', 'data', 'results']) {
    if (Array.isArray(candidate[key])) return candidate[key].length;
  }
  return null;
}

export function extractToolCalls(
  output: readonly OutputItem[],
  datasourceLuid: string,
): ToolCallTelemetry[] {
  return output
    .filter((item) => item.type === 'mcp_call')
    .map((item, index) => {
      const args = parseJson(item.arguments);
      const parameterKeys = typeof args === 'object' && args !== null ? Object.keys(args) : [];
      const name = typeof item.name === 'string' ? item.name : null;
      const rowCount = resultRowCount(item.output);
      return {
        sequence: index + 1,
        name,
        parameterKeys,
        datasourceLuidPresent:
          typeof args === 'object' &&
          args !== null &&
          JSON.stringify(args).includes(datasourceLuid),
        queryType: name === 'query-datasource' ? 'aggregation-requested' : null,
        resultRowCount: rowCount,
        empty: rowCount === null ? null : rowCount === 0,
        error: item.error ?? null,
      };
    });
}

export function summarizeUsage(usage: Record<string, unknown> | undefined): UsageTelemetry {
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : null;
  const inputDetails = usage?.input_tokens_details as Record<string, unknown> | undefined;
  const cachedInputTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : null;
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : null;
  const uncachedInput = Math.max((inputTokens ?? 0) - cachedInputTokens, 0);
  const approximateCostUsd =
    inputTokens === null || outputTokens === null
      ? null
      : uncachedInput * 0.2e-6 + cachedInputTokens * 0.02e-6 + outputTokens * 1.2e-6;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    approximateCostUsd,
  };
}
