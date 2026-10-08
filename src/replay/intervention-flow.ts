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
  triggerDetector as defaultTriggerDetector,
  type AnalyzeOpportunity,
  type TriggerDetector,
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

export type FlowFailureStage = 'fixture' | 'trigger' | 'analysis' | 'evidence' | 'verification';

export type TranscriptInterventionDependencies = {
  triggerDetector?: TriggerDetector;
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
  contract: TranscriptInterventionFlowResult['contract'] = null,
  analysis: AgenticAnalysisResult | null = null,
  evidence: readonly Evidence[] = [],
  verification: EvidenceVerificationResult | null = null,
): TranscriptInterventionFlowResult {
  events.push({ type: 'flow-failed', stage, reason: `${stage.toUpperCase()}_FAILED` });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validateTriggerContext(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('TRIGGER_DETECTION_INVALID');
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['sequence', 'speaker', 'text'])) {
      throw new Error('TRIGGER_DETECTION_INVALID');
    }
    if (
      typeof item.sequence !== 'number' ||
      !Number.isSafeInteger(item.sequence) ||
      item.sequence < 0 ||
      typeof item.speaker !== 'string' ||
      item.speaker.trim() === '' ||
      typeof item.text !== 'string' ||
      item.text.trim() === ''
    ) {
      throw new Error('TRIGGER_DETECTION_INVALID');
    }
  }
}

function validateTriggerDetection(value: unknown): TriggerDetection {
  if (!isRecord(value) || typeof value.decision !== 'string') {
    throw new Error('TRIGGER_DETECTION_INVALID');
  }
  if (value.decision === 'IGNORE') {
    if (
      !hasOnlyKeys(value, ['decision', 'reason', 'context']) ||
      value.reason !== 'no-analytical-opportunity'
    ) {
      throw new Error('TRIGGER_DETECTION_INVALID');
    }
    validateTriggerContext(value.context);
    return value as TriggerDetection;
  }
  if (value.decision !== 'ANALYZE' || !hasOnlyKeys(value, ['decision', 'opportunity'])) {
    throw new Error('TRIGGER_DETECTION_INVALID');
  }
  if (
    !isRecord(value.opportunity) ||
    !hasOnlyKeys(value.opportunity, ['claim', 'reason', 'context'])
  ) {
    throw new Error('TRIGGER_DETECTION_INVALID');
  }
  try {
    analysisContractFromOpportunity(value.opportunity as unknown as AnalyzeOpportunity);
  } catch {
    throw new Error('TRIGGER_DETECTION_INVALID');
  }
  return value as TriggerDetection;
}

function validateInterpretations(
  value: unknown,
  contract: ReturnType<typeof analysisContractFromOpportunity>,
): readonly AgenticEvidenceInterpretation[] {
  if (!Array.isArray(value)) throw new Error('EVIDENCE_INTERPRETATION_INVALID');
  const questionIds = new Set([
    ...contract.requiredEvidence.map(({ id }) => id),
    ...contract.optionalEvidence.map(({ id }) => id),
    ...contract.openQuestions.map(({ id }) => id),
  ]);
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('EVIDENCE_INTERPRETATION_INVALID');
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !['sequence', 'questionId', 'status', 'observation'].includes(key),
      ) ||
      typeof record.sequence !== 'number' ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence <= 0 ||
      typeof record.questionId !== 'string' ||
      record.questionId.trim() === '' ||
      !questionIds.has(record.questionId) ||
      !['supported', 'contradicted', 'unresolved'].includes(String(record.status)) ||
      typeof record.observation !== 'string' ||
      record.observation.trim() === '' ||
      record.observation.length > 2_000
    ) {
      throw new Error('EVIDENCE_INTERPRETATION_INVALID');
    }
    return {
      sequence: record.sequence,
      questionId: record.questionId,
      status: record.status as AgenticEvidenceInterpretation['status'],
      observation: record.observation,
    };
  });
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
  } catch {
    return failureResult(
      events,
      { decision: 'IGNORE', reason: 'no-analytical-opportunity', context: [] },
      'fixture',
    );
  }

  const replayed: TranscriptUtterance[] = [];
  const detector = dependencies.triggerDetector ?? defaultTriggerDetector;
  let afterSequence: number | undefined;
  let detection: TriggerDetection = {
    decision: 'IGNORE',
    reason: 'no-analytical-opportunity',
    context: [],
  };

  for (const utterance of utterances) {
    replayed.push(utterance);
    events.push({ type: 'utterance-received', utterance });
    try {
      detection = validateTriggerDetection(
        detector.detect(replayed, afterSequence === undefined ? {} : { afterSequence }),
      );
    } catch {
      return failureResult(events, detection, 'trigger');
    }
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
  } catch {
    return failureResult(events, detection, 'verification');
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
  } catch {
    return failureResult(events, detection, 'analysis', contract);
  }
  events.push({
    type: 'evidence-collected',
    sequences: analysis.normalizedEvidence.map(({ sequence }) => sequence),
  });

  let evidence: readonly Evidence[];
  try {
    const interpretations = validateInterpretations(
      dependencies.interpretEvidence(analysis),
      contract,
    );
    evidence = interpretAgenticEvidence(analysis.normalizedEvidence, interpretations);
  } catch {
    return failureResult(events, detection, 'evidence', contract, analysis);
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
