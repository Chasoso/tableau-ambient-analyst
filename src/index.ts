export function getAppName(): string {
  return 'tableau-ambient-analyst';
}

export {
  parseTranscriptFixture,
  replayTranscript,
  TranscriptFixtureError,
} from './replay/transcript.js';
export type { TranscriptFixtureFormat, TranscriptUtterance } from './replay/transcript.js';
export { detectTrigger, triggerDetector } from './trigger/detector.js';
export type {
  AnalyzeOpportunity,
  TriggerContext,
  TriggerDetection,
  TriggerDetectionOptions,
  TriggerDetector,
  TriggerReason,
} from './trigger/detector.js';
export {
  analysisContractFromOpportunity,
  AnalysisContractError,
  validateAnalysisContract,
} from './analysis/contract.js';
export type { AnalysisContract, AnalysisQuestion } from './analysis/contract.js';
export { evidenceFromAgenticRecords, verifyEvidence } from './analysis/evidence-verifier.js';
export type {
  AgenticEvidenceMapping,
  Evidence,
  EvidenceProvenance,
  EvidenceQuestionStatus,
  EvidenceStatus,
  EvidenceVerificationResult,
} from './analysis/evidence-verifier.js';
export {
  createOpenAiResponsesModel,
  runAgenticTableauAnalysis,
  runOpenAiStdioAnalysis,
} from './analysis/agentic-analysis.js';
export type {
  AgenticAnalysisModel,
  AgenticEvidenceRecord,
  AgenticAnalysisResponse,
  AgenticAnalysisResult,
  AgenticAnalysisToolRunner,
} from './analysis/agentic-analysis.js';
