import { readKeychainSecret } from './keychain-secrets.js';
import { TableauStdioBridge, type StdioCallSummary } from './tableau-stdio-bridge.js';
import { stdioOperationTimeoutMs } from './operation-timeout.js';
import {
  openAiStdioTools,
  stdioMaxToolCalls,
  summarizeStdioToolArguments,
} from './stdio-bridge-policy.js';

const openAiKeychainService = 'ambient_openai_chasoso_20261004';
const model = 'gpt-5.6-luna';
const maxOutputTokens = 1024;
const maxToolCalls = stdioMaxToolCalls;

type ResponseItem = {
  type?: unknown;
  id?: unknown;
  call_id?: unknown;
  name?: unknown;
  arguments?: unknown;
  content?: unknown;
};

type ResponsesEnvelope = {
  id?: unknown;
  status?: unknown;
  error?: unknown;
  incomplete_details?: { reason?: unknown } | null;
  output?: unknown;
  output_text?: unknown;
  usage?: Record<string, unknown>;
};

type LoopResult = {
  response: ResponsesEnvelope;
  calls: StdioCallSummary[];
  iterations: number;
  stopReason: string;
};

export function buildFunctionCallOutput(callId: string, result: unknown): Record<string, unknown> {
  return { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) };
}

export function canContinueWithToolCalls(
  completedCalls: number,
  pendingCalls: number,
  maxCalls = maxToolCalls,
): boolean {
  return completedCalls + pendingCalls <= maxCalls;
}

function readOpenAiKey(): string {
  return readKeychainSecret(openAiKeychainService);
}

function outputItems(response: ResponsesEnvelope): ResponseItem[] {
  return Array.isArray(response.output)
    ? response.output.filter(
        (item): item is ResponseItem => typeof item === 'object' && item !== null,
      )
    : [];
}

function functionCalls(response: ResponsesEnvelope): ResponseItem[] {
  return outputItems(response).filter((item) => item.type === 'function_call');
}

function finalMessagePresent(response: ResponsesEnvelope): boolean {
  return outputItems(response).some(
    (item) =>
      item.type === 'message' &&
      Array.isArray(item.content) &&
      item.content.some(
        (content) =>
          typeof content === 'object' &&
          content !== null &&
          (content as { type?: unknown }).type === 'output_text',
      ),
  );
}

function safeUsage(usage: Record<string, unknown> | undefined): Record<string, number | null> {
  const outputDetails =
    usage?.output_tokens_details && typeof usage.output_tokens_details === 'object'
      ? (usage.output_tokens_details as Record<string, unknown>)
      : undefined;
  const numberValue = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  return {
    inputTokens: numberValue(usage?.input_tokens),
    cachedInputTokens: numberValue(
      usage?.input_tokens_details && typeof usage.input_tokens_details === 'object'
        ? (usage.input_tokens_details as Record<string, unknown>).cached_tokens
        : null,
    ),
    outputTokens: numberValue(usage?.output_tokens),
    reasoningTokens: numberValue(outputDetails?.reasoning_tokens),
    totalTokens: numberValue(usage?.total_tokens),
  };
}

async function createResponse(
  apiKey: string,
  input: unknown,
  previousResponseId?: string,
): Promise<{ response: ResponsesEnvelope; latencyMs: number }> {
  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(stdioOperationTimeoutMs),
    body: JSON.stringify({
      model,
      input,
      ...(previousResponseId === undefined ? {} : { previous_response_id: previousResponseId }),
      tools: openAiStdioTools,
      tool_choice: 'auto',
      max_output_tokens: maxOutputTokens,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as ResponsesEnvelope & {
    error?: { type?: unknown; code?: unknown; message?: unknown; param?: unknown };
  };
  if (!response.ok) {
    throw new Error(
      `OPENAI_REQUEST_FAILED: ${JSON.stringify({
        status: response.status,
        type: body.error?.type ?? null,
        code: body.error?.code ?? null,
        param: body.error?.param ?? null,
        message: body.error?.message ?? null,
      })}`,
    );
  }
  return { response: body, latencyMs: Date.now() - startedAt };
}

export async function runAppManagedStdioSmoke(): Promise<LoopResult> {
  const bridge = new TableauStdioBridge();
  const apiKey = readOpenAiKey();
  const calls: StdioCallSummary[] = [];
  let iterations = 0;
  try {
    await bridge.connect();
    const listed = await bridge.listTools();
    const names = listed.tools.map((tool) => tool.name);
    const required = ['list-datasources', 'get-datasource-metadata', 'query-datasource'];
    if (!required.every((name) => names.includes(name))) throw new Error('MCP_PROTOCOL_FAILED');
    let input: unknown =
      'Use the approved Tableau tool to inspect the fixed datasource Tableau Public Per Day(2025/04-). Query the aggregate SUM of Daily View Count for that datasource, then briefly explain the returned value. Do not use another datasource or any write-capable tool.';
    let previousResponseId: string | undefined;
    for (;;) {
      iterations += 1;
      const { response, latencyMs } = await createResponse(apiKey, input, previousResponseId);
      const items = outputItems(response);
      console.log(
        JSON.stringify({
          status: 'app_managed_stdio_openai_response',
          responseId: typeof response.id === 'string' ? response.id : null,
          responseStatus: response.status ?? null,
          outputTypes: items.map((item) => (typeof item.type === 'string' ? item.type : 'unknown')),
          messagePresent: finalMessagePresent(response),
          toolCallPresent: functionCalls(response).length > 0,
          usage: safeUsage(response.usage),
          latencyMs,
        }),
      );
      if (response.status !== 'completed') {
        throw new Error(`FINAL_MESSAGE_MISSING: response status ${String(response.status)}`);
      }
      const pendingCalls = functionCalls(response);
      if (pendingCalls.length === 0) {
        if (!finalMessagePresent(response)) throw new Error('FINAL_MESSAGE_MISSING');
        return { response, calls, iterations, stopReason: 'completed' };
      }
      if (!canContinueWithToolCalls(calls.length, pendingCalls.length)) {
        throw new Error('TOOL_CALL_LIMIT_REACHED');
      }
      const outputs: Array<Record<string, unknown>> = [];
      for (const call of pendingCalls) {
        const openAiTool = typeof call.name === 'string' ? call.name : '';
        const callId = typeof call.call_id === 'string' ? call.call_id : '';
        if (!openAiTool || !callId || typeof call.arguments !== 'string') {
          throw new Error('INVALID_TOOL_CALL');
        }
        let argumentsValue: unknown;
        try {
          argumentsValue = JSON.parse(call.arguments);
        } catch {
          throw new Error('INVALID_TOOL_CALL');
        }
        console.log(
          JSON.stringify({
            status: 'app_managed_stdio_tool_arguments',
            ...summarizeStdioToolArguments(openAiTool, argumentsValue),
          }),
        );
        const executed = await bridge.callTool(openAiTool, argumentsValue);
        calls.push(executed.summary);
        console.log(JSON.stringify({ status: 'app_managed_stdio_tool_call', ...executed.summary }));
        outputs.push(buildFunctionCallOutput(callId, executed.result));
      }
      previousResponseId = typeof response.id === 'string' ? response.id : undefined;
      if (previousResponseId === undefined) throw new Error('OPENAI_CONTINUATION_FAILED');
      input = outputs;
    }
  } finally {
    await bridge.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAppManagedStdioSmoke()
    .then((result) => {
      console.log(
        JSON.stringify({
          status: 'APP_MANAGED_STDIO_SMOKE',
          result: 'PASS',
          iterations: result.iterations,
          toolCalls: result.calls.length,
          stopReason: result.stopReason,
          finalMessagePresent: finalMessagePresent(result.response),
          usage: safeUsage(result.response.usage),
        }),
      );
    })
    .catch((error: unknown) => {
      console.log(
        JSON.stringify({
          status: 'APP_MANAGED_STDIO_SMOKE',
          result: 'FAIL',
          error: error instanceof Error ? error.message : 'UNKNOWN',
        }),
      );
      process.exitCode = 1;
    });
}
