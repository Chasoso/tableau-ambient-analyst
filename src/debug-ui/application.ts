import { runTranscriptInterventionFlow } from '../replay/intervention-flow.js';
import type {
  AgenticAnalysisModel,
  AgenticAnalysisResponse,
  AgenticAnalysisResult,
  AgenticAnalysisToolRunner,
} from '../analysis/agentic-analysis.js';
import type { StdioCallSummary, ModelVisibleMcpEvidence } from '../spike/tableau-stdio-bridge.js';
import { stdioDatasourceLuid } from '../spike/stdio-bridge-policy.js';
import { scenarios, type AnalysisClient, type DebugScenario, type ReplayState } from './model.js';

const boundedSummary: StdioCallSummary = {
  openAiTool: 'query_datasource',
  mcpTool: 'query-datasource',
  datasourceLuid: stdioDatasourceLuid,
  rowCount: 1,
  empty: false,
  resultBytes: 32,
  latencyMs: 1,
  error: null,
  topWorkbook: null,
  topMetric: null,
  fixedHypothesisScope: false,
  hasAggregateEvidence: true,
  hasWorkbookLevelEvidence: false,
  hasFixtureRankingContract: false,
  observedFieldNames: ['fixture.metric'],
  queryContract: null,
};

function response(output: readonly Record<string, unknown>[], id: string): AgenticAnalysisResponse {
  return {
    id,
    status: 'completed',
    output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

export function deterministicDependencies(scenarioId: string) {
  let call = 0;
  const model: AgenticAnalysisModel = {
    async respond() {
      call += 1;
      if (call === 1) {
        return response(
          [
            {
              type: 'function_call',
              call_id: 'fixture-call-1',
              name: 'query_datasource',
              arguments: JSON.stringify({ datasourceLuid: stdioDatasourceLuid }),
            },
            {
              type: 'function_call',
              call_id: 'fixture-call-2',
              name: 'query_datasource',
              arguments: JSON.stringify({ datasourceLuid: stdioDatasourceLuid }),
            },
          ],
          'fixture-response-1',
        );
      }
      const complete = scenarioId !== 'hold-insufficient';
      return response(
        [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  outcome: complete ? 'supported' : 'insufficient-evidence',
                  summary: 'Deterministic local fixture analysis.',
                  evidence_complete: complete,
                  missing_evidence: complete ? [] : ['decision-assumption-support'],
                  hypothesis_state: 'not-applicable',
                  stop_reason: complete ? 'sufficient-evidence' : 'insufficient-evidence',
                }),
              },
            ],
          },
        ],
        'fixture-response-2',
      );
    },
  };
  const tools: AgenticAnalysisToolRunner = {
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
      const modelEvidence: ModelVisibleMcpEvidence = {
        tool: 'query_datasource',
        datasourceLuid: stdioDatasourceLuid,
        rows: [{ 'fixture.metric': 1 }],
      };
      return { modelEvidence, summary: boundedSummary };
    },
    async close() {},
  };
  return {
    model,
    tools,
    interpretEvidence: (analysis: AgenticAnalysisResult) =>
      analysis.normalizedEvidence.map(({ sequence }) => ({
        sequence,
        questionId:
          analysis.contract.requiredEvidence[sequence - 1]?.id ??
          analysis.contract.requiredEvidence[0]?.id ??
          'decision-assumption-support',
        status:
          scenarioId === 'hold-insufficient' ? ('unresolved' as const) : ('contradicted' as const),
        observation:
          'Deterministic fixture evidence was collected through the application boundary.',
      })),
  };
}

function sourceFor(scenario: DebugScenario): string {
  if (scenario.id === 'failed') return '{malformed fixture';
  if (scenario.id === 'verified-intervention') {
    return JSON.stringify([
      {
        sequence: 0,
        speaker: 'Aki',
        text: 'Assuming the conversion rate will remain high.',
      },
      { sequence: 1, speaker: 'Morgan', text: "Let's decide whether to launch the campaign." },
    ]);
  }
  return JSON.stringify(
    scenario.utterances.map((utterance, sequence) => ({ ...utterance, sequence })),
  );
}

function project(
  scenario: DebugScenario,
  flow: Awaited<ReturnType<typeof runTranscriptInterventionFlow>>,
): ReplayState {
  const status: ReplayState['status'] =
    flow.status === 'FAILED'
      ? 'failed'
      : flow.status === 'IGNORED'
        ? 'ignored'
        : flow.verification?.completion === 'INSUFFICIENT'
          ? 'insufficient-evidence'
          : 'completed';
  const evidence = flow.evidence.slice(0, 20).map((item, index) => ({
    source: 'local-analysis',
    detail: item.observation.slice(0, 500),
    provenance: `evidence-${index + 1}`,
  }));
  const intervention = flow.intervention
    ? { decision: flow.intervention.decision, reason: flow.intervention.reason.slice(0, 500) }
    : null;
  const types = new Set(flow.events.map(({ type }) => type));
  const failedStage = flow.events.find((event) => event.type === 'flow-failed')?.stage;
  const stage = (name: string, complete: boolean, failed: boolean, detail: string) => ({
    name,
    status: failed ? ('failed' as const) : complete ? ('complete' as const) : ('skipped' as const),
    detail,
  });
  const stages = [
    stage(
      'Trigger',
      types.has('trigger-detected') || types.has('trigger-ignored'),
      failedStage === 'trigger' || failedStage === 'fixture',
      'Derived from the trigger detector event.',
    ),
    stage(
      'Analysis Contract',
      types.has('analysis-contract-created'),
      false,
      'Derived from the application analysis contract.',
    ),
    stage(
      'Analysis',
      types.has('tableau-analysis-started') && failedStage !== 'analysis',
      failedStage === 'analysis',
      'Derived from the agentic analysis boundary.',
    ),
    stage(
      'Evidence',
      types.has('evidence-collected'),
      failedStage === 'evidence',
      'Derived from bounded evidence interpretation.',
    ),
    stage(
      'Verifier',
      types.has('verification-complete') || types.has('verification-insufficient'),
      failedStage === 'verification',
      'Derived from the evidence verifier event.',
    ),
    stage(
      'Intervention',
      types.has('intervention-hold') || types.has('intervention-recommended'),
      false,
      'Derived from the intervention policy event.',
    ),
  ];
  const projectedScenario: DebugScenario = {
    ...scenario,
    questions: flow.contract?.requiredEvidence.map(({ question }) => question) ?? [],
    evidence,
    verifier: flow.verification
      ? {
          status: flow.verification.completion === 'COMPLETE' ? 'VERIFIED' : 'INSUFFICIENT',
          detail: flow.verification.reasons.join(' ').slice(0, 500) || 'Verification completed.',
        }
      : scenario.verifier,
    intervention,
    stages,
  };
  if (flow.status === 'FAILED') projectedScenario.error = 'The application flow failed closed.';
  const audit = flow.events.slice(0, 64).map(({ type }) => type as string);
  audit.push('audit.recorded');
  return { status, scenario: projectedScenario, audit };
}

export class ApplicationAnalysisClient implements AnalysisClient {
  constructor(
    private readonly dependencyFactory: (
      scenarioId: string,
    ) => ReturnType<typeof deterministicDependencies> = deterministicDependencies,
  ) {}

  async replay(scenario: DebugScenario): Promise<ReplayState> {
    const flow = await runTranscriptInterventionFlow(
      sourceFor(scenario),
      this.dependencyFactory(scenario.id),
    );
    return project(scenario, flow);
  }
}

export const applicationScenarios = scenarios;
