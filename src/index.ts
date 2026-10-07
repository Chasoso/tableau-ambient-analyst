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
  TriggerDetector,
  TriggerReason,
} from './trigger/detector.js';
