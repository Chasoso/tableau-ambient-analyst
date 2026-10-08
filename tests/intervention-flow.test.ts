import { describe, expect, it, vi } from 'vitest';
import { runTranscriptInterventionFlow } from '../src/replay/intervention-flow.js';
import type {
  AgenticAnalysisModel,
  AgenticAnalysisResponse,
  AgenticAnalysisToolRunner,
} from '../src/analysis/agentic-analysis.js';
import type {
  ModelVisibleMcpEvidence,
  StdioCallSummary,
} from '../src/spike/tableau-stdio-bridge.js';
import { stdioDatasourceLuid } from '../src/spike/stdio-bridge-policy.js';
import type { TriggerDetector } from '../src/trigger/detector.js';

const decisionFixture = [
  JSON.stringify({ sequence: 0, speaker: 'A', text: 'Assuming demand will stay high.' }),
  JSON.stringify({ sequence: 1, speaker: 'B', text: 'We should launch next week.' }),
].join('\n');

function response(output: readonly Record<string, unknown>[], id: string): AgenticAnalysisResponse {
  return {
    id,
    status: 'completed',
    output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

function modelFor(finalOutcome: Record<string, unknown>): AgenticAnalysisModel {
  let callCount = 0;
  return {
    async respond() {
      callCount += 1;
      if (callCount === 1) {
        return response(
          [
            {
              type: 'function_call',
              call_id: 'call-1',
              name: 'query_datasource',
              arguments: JSON.stringify({ datasourceLuid: stdioDatasourceLuid }),
            },
          ],
          'response-1',
        );
      }
      return response(
        [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(finalOutcome) }],
          },
        ],
        'response-final',
      );
    },
  };
}

function summary(): StdioCallSummary {
  return {
    openAiTool: 'query_datasource',
    mcpTool: 'query-datasource',
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
  modelEvidence: ModelVisibleMcpEvidence = {
    tool: 'query_datasource',
    datasourceLuid: stdioDatasourceLuid,
    rows: [{ 'SUM(Daily View Count)': 120 }],
  },
): AgenticAnalysisToolRunner & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async connect() {},
    async listTools() {
      return {
        tools: [
          { name: 'list-datasources' },
          { name: 'get-datasource-metadata' },
          { name: 'query-datasource' },
        ],
      };
    },
    async callTool() {
      calls += 1;
      return { modelEvidence, summary: summary() };
    },
    async close() {},
  };
}

function outcome(evidenceComplete: boolean): Record<string, unknown> {
  return {
    outcome: evidenceComplete ? 'supported' : 'insufficient-evidence',
    summary: evidenceComplete ? 'Evidence was collected.' : 'Evidence is incomplete.',
    evidence_complete: evidenceComplete,
    missing_evidence: evidenceComplete ? [] : ['decision-assumption-support'],
    hypothesis_state: 'not-applicable',
    stop_reason: evidenceComplete ? 'sufficient-evidence' : 'insufficient-evidence',
  };
}

function dependencies(status: 'supported' | 'contradicted' | 'unresolved') {
  return {
    model: modelFor(outcome(status !== 'unresolved')),
    tools: toolsFor(),
    interpretEvidence: (analysis: { normalizedEvidence: readonly { sequence: number }[] }) =>
      analysis.normalizedEvidence.map(({ sequence }) => ({
        sequence,
        questionId: 'decision-assumption-support',
        status,
        observation: 'The bounded Tableau observation was interpreted for the assumption.',
      })),
  };
}

describe('transcript intervention flow', () => {
  it('passes non-triggering utterances through without analysis', async () => {
    const tools = toolsFor();
    const result = await runTranscriptInterventionFlow(
      '[{"sequence":0,"speaker":"A","text":"Let us discuss lunch."},{"sequence":1,"speaker":"B","text":"The weather is pleasant."}]',
      {
        ...dependencies('supported'),
        tools,
      },
    );

    expect(result.status).toBe('IGNORED');
    expect(result.intervention).toBeNull();
    expect(result.events.map(({ type }) => type)).toEqual([
      'utterance-received',
      'trigger-ignored',
      'utterance-received',
      'trigger-ignored',
    ]);
    expect(tools.calls).toBe(0);
  });

  it('uses an injected TriggerDetector implementation', async () => {
    const detector: TriggerDetector = {
      detect: vi.fn(() => ({
        decision: 'ANALYZE' as const,
        opportunity: {
          claim: 'We should launch next week.',
          reason: 'assumption-based-decision' as const,
          context: [
            { sequence: 0, speaker: 'A', text: 'Assuming demand will stay high.' },
            { sequence: 1, speaker: 'B', text: 'We should launch next week.' },
          ],
        },
      })),
    };
    const result = await runTranscriptInterventionFlow(
      '[{"sequence":0,"speaker":"A","text":"Let us discuss lunch."}]',
      { ...dependencies('supported'), triggerDetector: detector },
    );

    expect(result.status).toBe('COMPLETED');
    expect(detector.detect).toHaveBeenCalledOnce();
  });

  it('does not analyze when an injected TriggerDetector ignores the replay', async () => {
    let modelCalled = false;
    const detector: TriggerDetector = {
      detect: vi.fn(() => ({
        decision: 'IGNORE' as const,
        reason: 'no-analytical-opportunity' as const,
        context: [],
      })),
    };
    const tools = toolsFor();
    const result = await runTranscriptInterventionFlow(decisionFixture, {
      ...dependencies('supported'),
      triggerDetector: detector,
      model: {
        async respond() {
          modelCalled = true;
          throw new Error('model must not be called');
        },
      },
      tools,
    });

    expect(result.status).toBe('IGNORED');
    expect(modelCalled).toBe(false);
    expect(tools.calls).toBe(0);
    expect(detector.detect).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an injected TriggerDetector fails or returns malformed data', async () => {
    const detector: TriggerDetector = {
      detect: vi.fn(() => {
        throw new Error('sensitive provider detail');
      }),
    };
    const failed = await runTranscriptInterventionFlow(decisionFixture, {
      ...dependencies('supported'),
      triggerDetector: detector,
    });

    expect(failed.status).toBe('FAILED');
    expect(failed.intervention?.decision).toBe('HOLD');
    expect(failed.events).toContainEqual({
      type: 'flow-failed',
      stage: 'trigger',
      reason: 'TRIGGER_FAILED',
    });
    expect(JSON.stringify(failed.events)).not.toContain('sensitive provider detail');

    const malformed = await runTranscriptInterventionFlow(decisionFixture, {
      ...dependencies('supported'),
      triggerDetector: {
        detect: () => ({ decision: 'IGNORE' }) as never,
      },
    });
    expect(malformed.status).toBe('FAILED');
    expect(malformed.events).toContainEqual(
      expect.objectContaining({ type: 'flow-failed', stage: 'trigger' }),
    );
  });

  it('replays a trigger through verification to HOLD for supported evidence', async () => {
    const result = await runTranscriptInterventionFlow(decisionFixture, dependencies('supported'));

    expect(result.status).toBe('COMPLETED');
    expect(result.verification?.completion).toBe('COMPLETE');
    expect(result.intervention).toEqual({
      decision: 'HOLD',
      reason:
        'Evidence is complete without a decision-relevant contradiction requiring intervention.',
    });
    expect(result.events.map(({ type }) => type)).toContain('verification-complete');
    expect(result.events.map(({ type }) => type)).toContain('intervention-hold');
  });

  it('replays a trigger through verified contradiction to INTERVENE', async () => {
    const result = await runTranscriptInterventionFlow(
      decisionFixture,
      dependencies('contradicted'),
    );

    expect(result.intervention?.decision).toBe('INTERVENE');
    expect(result.events.map(({ type }) => type)).toContain('intervention-recommended');
  });

  it('holds when the evidence interpretation is unresolved', async () => {
    const result = await runTranscriptInterventionFlow(decisionFixture, dependencies('unresolved'));

    expect(result.status).toBe('COMPLETED');
    expect(result.verification?.completion).toBe('INSUFFICIENT');
    expect(result.intervention?.decision).toBe('HOLD');
    expect(result.events.map(({ type }) => type)).toContain('verification-insufficient');
  });

  it('fails closed when the external tool result is malformed', async () => {
    const result = await runTranscriptInterventionFlow(decisionFixture, {
      ...dependencies('supported'),
      tools: toolsFor({
        tool: 'query_datasource',
        datasourceLuid: stdioDatasourceLuid,
        rows: [{ invalid: { nested: true } }],
      } as unknown as ModelVisibleMcpEvidence),
    });

    expect(result.status).toBe('FAILED');
    expect(result.intervention?.decision).toBe('HOLD');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'flow-failed', stage: 'analysis' }),
    );
  });

  it('fails closed when the interpretation references an unknown question', async () => {
    const result = await runTranscriptInterventionFlow(decisionFixture, {
      ...dependencies('supported'),
      interpretEvidence: () => [
        {
          sequence: 1,
          questionId: 'unknown-question',
          status: 'supported',
          observation: 'This interpretation is outside the contract.',
        },
      ],
    });

    expect(result.status).toBe('FAILED');
    expect(result.intervention?.decision).toBe('HOLD');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'flow-failed', stage: 'evidence' }),
    );
  });
});
