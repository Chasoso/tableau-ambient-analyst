import { analysisContractFromOpportunity } from '../analysis/contract.js';
import {
  interpretAgenticEvidence,
  verifyEvidence,
  type AgenticEvidenceInterpretation,
  type Evidence,
  type EvidenceVerificationResult,
} from '../analysis/evidence-verifier.js';
import {
  runAgenticTableauAnalysis,
  type AgenticAnalysisModel,
  type AgenticAnalysisResult,
  type AgenticAnalysisToolRunner,
} from '../analysis/agentic-analysis.js';
import { decideIntervention, type InterventionResult } from '../intervention/policy.js';
import {
  parseTranscriptFixture,
  type TranscriptFixtureFormat,
  type TranscriptUtterance,
} from './transcript.js';
import {
  detectTrigger,
  type AnalyzeOpportunity,
  type TriggerDetection,
} from '../trigger/detector.js';
import { StdioRunBudget } from '../spike/run-budget.js';

export type TranscriptInterventionEvent =
  | { type: 'utterance-received'; utterance: TranscriptUtterance }
  | { type: 'trigger-ignored'; sequence: number; reason: 'no-analytical-opportunity' }
  | { type: 'trigger-detected'; opportunity: AnalyzeOpportunity }
  | {
      type: 'analysis-contract-created';
      contract: ReturnType<typeof analysisContractFromOpportunity>;
    }
  | { type: 'tableau-analysis-started' }
  | { type: 'evidence-collected'; sequences: readonly number[] }
  | { type: 'verification-complete'; verification: EvidenceVerificationResult }
  | { type: 'verification-insufficient'; verification: EvidenceVerificationResult }
  | { type: 'intervention-hold'; result: InterventionResult }
  | { type: 'intervention-recommended'; result: InterventionResult }
  | { type: 'flow-failed'; stage: FlowFailureStage; reason: string };

export type FlowFailureStage = 'fixture' | 'analysis' | 'evidence' | 'verification';

export type TranscriptInterventionDependencies = {
  model: AgenticAnalysisModel;
  tools: AgenticAnalysisToolRunner;
  interpretEvidence: (analysis: AgenticAnalysisResult) => readonly AgenticEvidenceInterpretation[];
  budget?: StdioRunBudget;
};

export type TranscriptInterventionFlowResult = {
  status: 'IGNORED' | 'COMPLETED' | 'FAILED';
  events: readonly TranscriptInterventionEvent[];
  detection: TriggerDetection;
  contract: ReturnType<typeof analysisContractFromOpportunity> | null;
  analysis: AgenticAnalysisResult | null;
  evidence: readonly Evidence[];
  verification: EvidenceVerificationResult | null;
  intervention: InterventionResult | null;
};

function failureResult(
  events: TranscriptInterventionEvent[],
  detection: TriggerDetection,
  stage: FlowFailureStage,
  error: unknown,
  contract: TranscriptInterventionFlowResult['contract'] = null,
  analysis: AgenticAnalysisResult | null = null,
  evidence: readonly Evidence[] = [],
  verification: EvidenceVerificationResult | null = null,
): TranscriptInterventionFlowResult {
  const reason = error instanceof Error ? error.message : 'unknown failure';
  events.push({ type: 'flow-failed', stage, reason });
  const intervention: InterventionResult = {
    decision: 'HOLD',
    reason: `Flow failed closed during ${stage}.`,
  };
  events.push({ type: 'intervention-hold', result: intervention });
  return {
    status: 'FAILED',
    events,
    detection,
    contract,
    analysis,
    evidence,
    verification,
    intervention,
  };
}

function noOpportunityResult(
  events: TranscriptInterventionEvent[],
  detection: TriggerDetection,
): TranscriptInterventionFlowResult {
  return {
    status: 'IGNORED',
    events,
    detection,
    contract: null,
    analysis: null,
    evidence: [],
    verification: null,
    intervention: null,
  };
}

/**
 * Runs the deterministic text-replay vertical slice. External model/tool
 * boundaries and post-analysis interpretation are injected so normal tests
 * remain local and deterministic.
 */
export async function runTranscriptInterventionFlow(
  source: string | readonly TranscriptUtterance[],
  dependencies: TranscriptInterventionDependencies,
  format?: TranscriptFixtureFormat,
): Promise<TranscriptInterventionFlowResult> {
  const events: TranscriptInterventionEvent[] = [];
  let utterances: readonly TranscriptUtterance[];
  try {
    utterances =
      typeof source === 'string'
        ? parseTranscriptFixture(source, format)
        : parseTranscriptFixture(JSON.stringify(source), 'json');
  } catch (error) {
    return failureResult(
      events,
      { decision: 'IGNORE', reason: 'no-analytical-opportunity', context: [] },
      'fixture',
      error,
    );
  }

  const replayed: TranscriptUtterance[] = [];
  let afterSequence: number | undefined;
  let detection: TriggerDetection = {
    decision: 'IGNORE',
    reason: 'no-analytical-opportunity',
    context: [],
  };

  for (const utterance of utterances) {
    replayed.push(utterance);
    events.push({ type: 'utterance-received', utterance });
    detection = detectTrigger(replayed, afterSequence === undefined ? {} : { afterSequence });
    if (detection.decision === 'ANALYZE') break;
    events.push({
      type: 'trigger-ignored',
      sequence: utterance.sequence,
      reason: detection.reason,
    });
    afterSequence = utterance.sequence;
  }

  if (detection.decision === 'IGNORE') return noOpportunityResult(events, detection);

  events.push({ type: 'trigger-detected', opportunity: detection.opportunity });
  let contract: ReturnType<typeof analysisContractFromOpportunity>;
  try {
    contract = analysisContractFromOpportunity(detection.opportunity);
  } catch (error) {
    return failureResult(events, detection, 'verification', error);
  }
  events.push({ type: 'analysis-contract-created', contract });
  events.push({ type: 'tableau-analysis-started' });

  let analysis: AgenticAnalysisResult;
  try {
    analysis = await runAgenticTableauAnalysis(
      contract,
      dependencies.model,
      dependencies.tools,
      dependencies.budget,
    );
  } catch (error) {
    return failureResult(events, detection, 'analysis', error, contract);
  }
  events.push({
    type: 'evidence-collected',
    sequences: analysis.normalizedEvidence.map(({ sequence }) => sequence),
  });

  let evidence: readonly Evidence[];
  try {
    const interpretations = dependencies.interpretEvidence(analysis);
    evidence = interpretAgenticEvidence(analysis.normalizedEvidence, interpretations);
  } catch (error) {
    return failureResult(events, detection, 'evidence', error, contract, analysis);
  }

  const verification = verifyEvidence(contract, evidence);
  events.push({
    type:
      verification.completion === 'COMPLETE'
        ? 'verification-complete'
        : 'verification-insufficient',
    verification,
  });
  const intervention = decideIntervention(detection.opportunity, contract, verification);
  events.push({
    type: intervention.decision === 'INTERVENE' ? 'intervention-recommended' : 'intervention-hold',
    result: intervention,
  });
  return {
    status: 'COMPLETED',
    events,
    detection,
    contract,
    analysis,
    evidence,
    verification,
    intervention,
  };
}
