import { describe, expect, it, vi } from 'vitest';
import {
  runAgenticTableauAnalysis,
  createOpenAiResponsesModel,
  type AgenticAnalysisModel,
  type AgenticAnalysisResponse,
  type AgenticAnalysisToolRunner,
} from '../src/analysis/agentic-analysis.js';
import type { AnalysisContract } from '../src/analysis/contract.js';
import { stdioDatasourceLuid } from '../src/spike/stdio-bridge-policy.js';
import type {
  ModelVisibleMcpEvidence,
  StdioCallSummary,
} from '../src/spike/tableau-stdio-bridge.js';

const contract: AnalysisContract = {
  claim: 'We should launch next week.',
  context: [
    { sequence: 0, speaker: 'A', text: 'Assuming demand will stay high.' },
    { sequence: 1, speaker: 'B', text: 'We should launch next week.' },
  ],
  requiredEvidence: [
    { id: 'decision-assumption-support', question: 'Is the assumption supported?' },
  ],
  optionalEvidence: [],
  openQuestions: [],
};

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

function response(
  output: readonly Record<string, unknown>[],
  id = 'response-1',
): AgenticAnalysisResponse {
  return { id, status: 'completed', output, usage };
}

function finalResponse(id = 'response-final'): AgenticAnalysisResponse {
  return response(
    [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              outcome: 'supported',
              summary: 'The assumption is supported by the available evidence.',
              evidence_complete: true,
              missing_evidence: [],
              hypothesis_state: 'not-applicable',
              stop_reason: 'sufficient-evidence',
              reported_rank_1: null,
            }),
          },
        ],
      },
    ],
    id,
  );
}

function summary(toolName: string): StdioCallSummary {
  return {
    openAiTool: toolName,
    mcpTool: toolName.replaceAll('_', '-'),
    datasourceLuid: stdioDatasourceLuid,
    rowCount: 1,
    empty: false,
    resultBytes: 20,
    latencyMs: 1,
    error: null,
    topWorkbook: null,
    topMetric: null,
    fixedHypothesisScope: false,
    hasAggregateEvidence: true,
    hasWorkbookLevelEvidence: false,
    hasFixtureRankingContract: false,
    observedFieldNames: ['SUM(Daily View Count)'],
    queryContract: null,
  };
}

function toolsFor(
  modelEvidence: ModelVisibleMcpEvidence | null = {
    tool: 'query_datasource',
    datasourceLuid: stdioDatasourceLuid,
    rows: [{ 'SUM(Daily View Count)': 120 }],
  },
): AgenticAnalysisToolRunner & { calls: string[]; connected: boolean; closed: boolean } {
  const state = { calls: [] as string[], connected: false, closed: false };
  return {
    get calls() {
      return state.calls;
    },
    get connected() {
      return state.connected;
    },
    get closed() {
      return state.closed;
    },
    async connect() {
      state.connected = true;
    },
    async listTools() {
      return {
        tools: [
          { name: 'list-datasources' },
          { name: 'get-datasource-metadata' },
          { name: 'query-datasource' },
        ],
      };
    },
    async callTool(toolName) {
      state.calls.push(toolName);
      return {
        modelEvidence: modelEvidence as ModelVisibleMcpEvidence,
        summary: summary(toolName),
      };
    },
    async close() {
      state.closed = true;
    },
  };
}

describe('application-layer agentic analysis', () => {
  it('starts from an Analysis Contract and returns structured output after a tool call', async () => {
    const modelInputs: unknown[] = [];
    const responses = [
      response([
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'query_datasource',
          arguments: JSON.stringify({ datasourceLuid: stdioDatasourceLuid }),
        },
      ]),
      finalResponse('response-2'),
    ];
    const model: AgenticAnalysisModel = {
      async respond(input, previousResponseId) {
        modelInputs.push({ input, previousResponseId });
        const next = responses.shift();
        if (next === undefined) throw new Error('unexpected model call');
        return next;
      },
    };
    const tools = toolsFor();

    const result = await runAgenticTableauAnalysis(contract, model, tools);

    expect(result.structuredOutcome.outcome).toBe('supported');
    expect(result.modelReportedMissingEvidenceQuestionIds).toEqual([]);
    expect(result.normalizedEvidence).toEqual([
      expect.objectContaining({
        sequence: 1,
        toolName: 'query_datasource',
        evidence: {
          tool: 'query_datasource',
          datasourceLuid: stdioDatasourceLuid,
          rows: [{ 'SUM(Daily View Count)': 120 }],
        },
      }),
    ]);
    expect(result.responseCount).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(tools.calls).toEqual(['query_datasource']);
    expect(tools.connected).toBe(true);
    expect(tools.closed).toBe(true);
    expect(JSON.stringify(modelInputs[0])).toContain('Assuming demand will stay high.');
    expect(modelInputs[1]).toMatchObject({ previousResponseId: 'response-1' });
  });

  it('fails closed at the proven tool-call bound', async () => {
    const model: AgenticAnalysisModel = {
      async respond() {
        return response(
          Array.from({ length: 7 }, (_, index) => ({
            type: 'function_call',
            call_id: `call-${index}`,
            name: 'query_datasource',
            arguments: '{}',
          })),
        );
      },
    };
    const tools = toolsFor();

    await expect(runAgenticTableauAnalysis(contract, model, tools)).rejects.toThrow(
      'TOOL_CALL_LIMIT_REACHED',
    );
    expect(tools.calls).toEqual([]);
    expect(tools.closed).toBe(true);
  });

  it('propagates provider timeout/failure and closes the tool runner', async () => {
    const model: AgenticAnalysisModel = {
      async respond() {
        throw new Error('OPERATION_TIMEOUT: model response');
      },
    };
    const tools = toolsFor();

    await expect(runAgenticTableauAnalysis(contract, model, tools)).rejects.toThrow(
      'OPERATION_TIMEOUT: model response',
    );
    expect(tools.closed).toBe(true);
  });

  it('rejects malformed provider output and malformed normalized tool evidence', async () => {
    const malformedProvider: AgenticAnalysisModel = {
      async respond() {
        return response([
          { type: 'message', content: [{ type: 'output_text', text: 'not-json' }] },
        ]);
      },
    };
    await expect(
      runAgenticTableauAnalysis(contract, malformedProvider, toolsFor()),
    ).rejects.toThrow('ANALYSIS_STRUCTURED_OUTPUT_INVALID');

    const malformedToolModel: AgenticAnalysisModel = {
      async respond() {
        return response([
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'query_datasource',
            arguments: '{}',
          },
        ]);
      },
    };
    await expect(
      runAgenticTableauAnalysis(contract, malformedToolModel, toolsFor(null)),
    ).rejects.toThrow('MALFORMED_TOOL_RESULT');

    await expect(
      runAgenticTableauAnalysis(
        contract,
        malformedToolModel,
        toolsFor({} as ModelVisibleMcpEvidence),
      ),
    ).rejects.toThrow('MALFORMED_TOOL_RESULT');
  });

  it('maps known missing required question IDs and rejects unknown IDs', async () => {
    const incompleteModel: AgenticAnalysisModel = {
      async respond() {
        return response([
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  outcome: 'insufficient-evidence',
                  summary: 'The required assumption evidence is unavailable.',
                  evidence_complete: false,
                  missing_evidence: ['decision-assumption-support'],
                  hypothesis_state: 'not-applicable',
                  stop_reason: 'insufficient-evidence',
                  reported_rank_1: null,
                }),
              },
            ],
          },
        ]);
      },
    };
    const incomplete = await runAgenticTableauAnalysis(contract, incompleteModel, toolsFor());
    expect(incomplete.modelReportedMissingEvidenceQuestionIds).toEqual([
      'decision-assumption-support',
    ]);

    const unknownIdModel: AgenticAnalysisModel = {
      async respond() {
        return response([
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  outcome: 'insufficient-evidence',
                  summary: 'The result is incomplete.',
                  evidence_complete: false,
                  missing_evidence: ['unknown-question'],
                  hypothesis_state: 'not-applicable',
                  stop_reason: 'insufficient-evidence',
                  reported_rank_1: null,
                }),
              },
            ],
          },
        ]);
      },
    };
    await expect(runAgenticTableauAnalysis(contract, unknownIdModel, toolsFor())).rejects.toThrow(
      'ANALYSIS_OUTCOME_QUESTION_ID_INVALID',
    );
  });

  it.each([null, [], {}])('rejects malformed successful provider envelope: %j', async (body) => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    const model = createOpenAiResponsesModel('test-token', fetchImplementation);

    await expect(model.respond('input', undefined, 1000)).rejects.toThrow(
      'MALFORMED_PROVIDER_RESULT',
    );
  });

  it('keeps the deterministic baseline no-network by requiring injected boundaries', async () => {
    const model = {
      respond: vi.fn().mockResolvedValue(finalResponse()),
    } satisfies AgenticAnalysisModel;
    const tools = toolsFor();

    const result = await runAgenticTableauAnalysis(contract, model, tools);

    expect(model.respond).toHaveBeenCalledOnce();
    expect(tools.calls).toEqual([]);
    expect(tools.closed).toBe(true);
    expect(result.structuredOutcome.evidence_complete).toBe(true);
    expect(result.modelReportedMissingEvidenceQuestionIds).toEqual([]);
    expect(result.normalizedEvidence).toEqual([]);
  });
});
