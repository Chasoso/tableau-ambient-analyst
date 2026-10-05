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
  reported_rank_1?: string | null;
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
  reasoningTokens: number | null;
  approximateCostUsd: number | null;
};

export type ResponseEnvelopeTelemetry = {
  status: string | null;
  incompleteReason: string | null;
  responseErrorPresent: boolean;
  maxOutputTokens: number | null;
  outputItemTypes: string[];
  outputItemStatuses: Array<string | null>;
  messagePresent: boolean;
  outputTextPresent: boolean;
  topLevelOutputTextPresent: boolean;
  reasoningTokens: number | null;
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
  const reportedRank1 = readField(record, 'reportedRank1', 'reported_rank_1');
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
    !validStopReasons.has(stopReason as StopReason) ||
    (reportedRank1 !== undefined && reportedRank1 !== null && typeof reportedRank1 !== 'string')
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
    ...(reportedRank1 === undefined ? {} : { reported_rank_1: reportedRank1 as string | null }),
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
  const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens =
    typeof outputDetails?.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : null;
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
    reasoningTokens,
    approximateCostUsd,
  };
}

export function summarizeResponseEnvelope(response: unknown): ResponseEnvelopeTelemetry {
  if (typeof response !== 'object' || response === null) {
    return {
      status: null,
      incompleteReason: null,
      responseErrorPresent: false,
      maxOutputTokens: null,
      outputItemTypes: [],
      outputItemStatuses: [],
      messagePresent: false,
      outputTextPresent: false,
      topLevelOutputTextPresent: false,
      reasoningTokens: null,
    };
  }
  const record = response as Record<string, unknown>;
  const incompleteDetails = record.incomplete_details;
  const incompleteReason =
    typeof incompleteDetails === 'object' &&
    incompleteDetails !== null &&
    typeof (incompleteDetails as Record<string, unknown>).reason === 'string'
      ? ((incompleteDetails as Record<string, unknown>).reason as string)
      : null;
  const output = Array.isArray(record.output) ? record.output : [];
  const outputItems = output.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
  const outputItemTypes = outputItems.map((item) =>
    typeof item.type === 'string' ? item.type : 'unknown',
  );
  const outputItemStatuses = outputItems.map((item) =>
    typeof item.status === 'string' ? item.status : null,
  );
  const messageItems = outputItems.filter((item) => item.type === 'message');
  const outputTextPresent = outputItems.some((item) => {
    if (item.type === 'output_text') return true;
    if (!Array.isArray(item.content)) return false;
    return item.content.some(
      (content) =>
        typeof content === 'object' &&
        content !== null &&
        (content as Record<string, unknown>).type === 'output_text',
    );
  });
  const usage =
    typeof record.usage === 'object' && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : undefined;
  const outputDetails = usage?.output_tokens_details;
  return {
    status: typeof record.status === 'string' ? record.status : null,
    incompleteReason,
    responseErrorPresent: record.error !== null && record.error !== undefined,
    maxOutputTokens: typeof record.max_output_tokens === 'number' ? record.max_output_tokens : null,
    outputItemTypes,
    outputItemStatuses,
    messagePresent: messageItems.length > 0,
    outputTextPresent,
    topLevelOutputTextPresent:
      typeof record.output_text === 'string' && record.output_text.length > 0,
    reasoningTokens:
      typeof outputDetails === 'object' &&
      outputDetails !== null &&
      typeof (outputDetails as Record<string, unknown>).reasoning_tokens === 'number'
        ? ((outputDetails as Record<string, unknown>).reasoning_tokens as number)
        : null,
  };
}
