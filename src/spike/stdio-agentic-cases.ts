import { measuredCaseSetups, type MeasuredCaseSetup } from './measured-case-setup.js';
import {
  extractFinalAnswer,
  extractStructuredOutcome,
  summarizeResponseEnvelope,
  summarizeUsage,
  type StructuredOutcome,
} from './response-telemetry.js';
import { structuredOutcomeTextFormat } from './openai-mcp-request.js';
import {
  openAiStdioTools,
  stdioMaxToolCalls,
  summarizeStdioToolArguments,
} from './stdio-bridge-policy.js';
import { readKeychainSecret } from './keychain-secrets.js';
import { TableauStdioBridge, type StdioCallSummary } from './tableau-stdio-bridge.js';
import { stdioOperationTimeoutMs } from './operation-timeout.js';
import {
  verifyEmptyRecovery,
  verifyHypothesisOutcome,
  verifyIncompleteExploration,
  verifyInsufficientEvidence,
  verifyStructuredOutcome,
} from './evidence-verifier.js';

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

type CaseRunResult = {
  caseId: MeasuredCaseSetup['id'];
  classification:
    'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'SETUP_FAILURE' | 'TRANSPORT_FAILURE' | 'COMPLETION_FAILURE';
  calls: StdioCallSummary[];
  responseCount: number;
  structuredOutcome: StructuredOutcome | null;
  finalAnswerPresent: boolean;
  stopReason: string;
  error: string | null;
  costUsd: number;
};

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

function readOpenAiKey(): string {
  return readKeychainSecret(openAiKeychainService);
}

function casePrompt(setup: MeasuredCaseSetup): string {
  return [
    `Evaluation case: ${setup.id}.`,
    setup.initialPrompt,
    `Use only the approved datasource Tableau Public Per Day(2025/04-) (LUID 14f3ac6d-1171-4065-baac-c63bdce1470f).`,
    'Use only the three available read-only Tableau tools. Do not use or request any write operation.',
    'Choose the next tool call yourself from the evidence returned by the preceding call.',
    'Do not claim evidence that was not returned by Tableau. Stop when the evidence is sufficient, or explicitly return insufficient-evidence when required evidence is unavailable.',
    'Return the required structured outcome with a concise human-readable summary, missing evidence, hypothesis state, and stop reason.',
  ].join('\n');
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
      text: { format: structuredOutcomeTextFormat },
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

function classifyCase(
  setup: MeasuredCaseSetup,
  calls: readonly StdioCallSummary[],
  outcome: StructuredOutcome | null,
): CaseRunResult['classification'] {
  if (outcome === null || !verifyStructuredOutcome(outcome).ok) return 'COMPLETION_FAILURE';
  if (setup.id === 'incomplete-first-result') {
    return verifyIncompleteExploration(calls, outcome).ok ? 'PASS' : 'FAIL';
  }
  if (setup.id === 'empty-result-recovery') {
    return verifyEmptyRecovery(calls, outcome).ok ? 'PASS' : 'FAIL';
  }
  if (setup.id === 'hypothesis-disproved') {
    return verifyHypothesisOutcome(
      outcome,
      '#MoM 2024 Week 34 | SNS Popularity in the U.S.',
      undefined,
      calls,
    ).ok
      ? 'PASS'
      : 'FAIL';
  }
  return verifyInsufficientEvidence(calls, outcome).ok ? 'PASS' : 'FAIL';
}

async function runCase(setup: MeasuredCaseSetup, apiKey: string): Promise<CaseRunResult> {
  const bridge = new TableauStdioBridge();
  const calls: StdioCallSummary[] = [];
  let responseCount = 0;
  let totalCostUsd = 0;
  try {
    await bridge.connect();
    const listed = await bridge.listTools();
    const available = listed.tools.map((tool) => tool.name);
    if (
      !['list-datasources', 'get-datasource-metadata', 'query-datasource'].every((name) =>
        available.includes(name),
      )
    ) {
      return {
        caseId: setup.id,
        classification: 'SETUP_FAILURE',
        calls,
        responseCount,
        structuredOutcome: null,
        finalAnswerPresent: false,
        stopReason: 'approved-tool-discovery-failed',
        error: 'MCP_PROTOCOL_FAILED',
        costUsd: totalCostUsd,
      };
    }

    let input: unknown = casePrompt(setup);
    let previousResponseId: string | undefined;
    for (;;) {
      const { response, latencyMs } = await createResponse(apiKey, input, previousResponseId);
      responseCount += 1;
      const envelope = summarizeResponseEnvelope(response);
      const usage = summarizeUsage(response.usage);
      totalCostUsd += usage.approximateCostUsd ?? 0;
      console.log(
        JSON.stringify({
          event: 'stdio_agentic_response',
          caseId: setup.id,
          responseId: typeof response.id === 'string' ? response.id : null,
          latencyMs,
          ...envelope,
          usage,
        }),
      );
      if (response.status !== 'completed') {
        return {
          caseId: setup.id,
          classification: 'COMPLETION_FAILURE',
          calls,
          responseCount,
          structuredOutcome: null,
          finalAnswerPresent: false,
          stopReason: 'response-not-completed',
          error: envelope.incompleteReason ?? 'response-not-completed',
          costUsd: totalCostUsd,
        };
      }

      const pendingCalls = functionCalls(response);
      if (pendingCalls.length === 0) {
        const finalAnswer = extractFinalAnswer(outputItems(response), response.output_text);
        const outcome = extractStructuredOutcome(finalAnswer);
        const finalPresent = finalMessagePresent(response);
        const classification = finalPresent
          ? classifyCase(setup, calls, outcome)
          : 'COMPLETION_FAILURE';
        console.log(
          JSON.stringify({
            status: 'stdio_agentic_case_result',
            caseId: setup.id,
            classification,
            finalMessagePresent: finalPresent,
            structuredOutcome: outcome,
            summary: outcome?.summary ?? null,
            responseCount,
            toolCalls: calls.length,
            stopReason: outcome?.stop_reason ?? 'missing-structured-outcome',
            costUsd: Number(totalCostUsd.toFixed(8)),
          }),
        );
        return {
          caseId: setup.id,
          classification,
          calls,
          responseCount,
          structuredOutcome: outcome,
          finalAnswerPresent: finalPresent,
          stopReason: outcome?.stop_reason ?? 'missing-structured-outcome',
          error: null,
          costUsd: totalCostUsd,
        };
      }
      if (calls.length + pendingCalls.length > maxToolCalls) {
        return {
          caseId: setup.id,
          classification: 'INCONCLUSIVE',
          calls,
          responseCount,
          structuredOutcome: null,
          finalAnswerPresent: false,
          stopReason: 'limit-reached',
          error: 'TOOL_CALL_LIMIT_REACHED',
          costUsd: totalCostUsd,
        };
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
            status: 'stdio_agentic_tool_request',
            caseId: setup.id,
            sequence: calls.length + 1,
            ...summarizeStdioToolArguments(openAiTool, argumentsValue),
          }),
        );
        const executed = await bridge.callTool(openAiTool, argumentsValue);
        calls.push(executed.summary);
        console.log(
          JSON.stringify({
            status: 'stdio_agentic_tool_result',
            caseId: setup.id,
            sequence: calls.length,
            ...executed.summary,
          }),
        );
        outputs.push({
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(executed.modelEvidence),
        });
      }
      previousResponseId = typeof response.id === 'string' ? response.id : undefined;
      if (previousResponseId === undefined) throw new Error('OPENAI_CONTINUATION_FAILED');
      input = outputs;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    const classification = message.startsWith('OPENAI_')
      ? 'TRANSPORT_FAILURE'
      : message.includes('MCP') || message.includes('Datasource') || message.includes('Query')
        ? 'TRANSPORT_FAILURE'
        : 'INCONCLUSIVE';
    console.log(
      JSON.stringify({
        status: 'stdio_agentic_case_result',
        caseId: setup.id,
        classification,
        error: message,
        responseCount,
        toolCalls: calls.length,
        costUsd: Number(totalCostUsd.toFixed(8)),
      }),
    );
    return {
      caseId: setup.id,
      classification,
      calls,
      responseCount,
      structuredOutcome: null,
      finalAnswerPresent: false,
      stopReason: 'error',
      error: message,
      costUsd: totalCostUsd,
    };
  } finally {
    await bridge.close();
  }
}

export async function runStdioAgenticCases(): Promise<CaseRunResult[]> {
  const apiKey = readOpenAiKey();
  const results: CaseRunResult[] = [];
  for (const setup of measuredCaseSetups) {
    results.push(await runCase(setup, apiKey));
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdioAgenticCases()
    .then((results) => {
      const totalCostUsd = results.reduce((sum, result) => sum + result.costUsd, 0);
      console.log(
        JSON.stringify({
          status: 'STDIO_AGENTIC_CASES',
          cases: results.map(
            ({ caseId, classification, responseCount, calls, structuredOutcome }) => ({
              caseId,
              classification,
              responseCount,
              toolCalls: calls.length,
              structuredOutcome,
            }),
          ),
          totalCostUsd: Number(totalCostUsd.toFixed(8)),
        }),
      );
    })
    .catch((error: unknown) => {
      console.log(
        JSON.stringify({
          status: 'STDIO_AGENTIC_CASES',
          result: 'FAIL',
          error: error instanceof Error ? error.message : 'UNKNOWN',
        }),
      );
      process.exitCode = 1;
    });
}
