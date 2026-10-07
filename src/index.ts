export function getAppName(): string {
  return 'tableau-ambient-analyst';
}

export {
  parseTranscriptFixture,
  replayTranscript,
  TranscriptFixtureError,
} from './replay/transcript.js';
export type { TranscriptFixtureFormat, TranscriptUtterance } from './replay/transcript.js';
