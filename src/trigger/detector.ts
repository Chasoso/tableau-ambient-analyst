import type { TranscriptUtterance } from '../replay/transcript.js';

export type TriggerReason =
  'numerical-claim' | 'causal-hypothesis' | 'assumption-based-decision' | 'factual-disagreement';

export type TriggerContext = Readonly<Pick<TranscriptUtterance, 'sequence' | 'speaker' | 'text'>>;

export type AnalyzeOpportunity = {
  claim: string;
  reason: TriggerReason;
  context: readonly TriggerContext[];
};

export type TriggerDetection =
  | { decision: 'ANALYZE'; opportunity: AnalyzeOpportunity }
  | { decision: 'IGNORE'; reason: 'no-analytical-opportunity'; context: readonly TriggerContext[] };

export interface TriggerDetector {
  detect(utterances: readonly TranscriptUtterance[]): TriggerDetection;
}

const analyticalTerms =
  /\b(metric|sales|revenue|conversion|rate|result|value|number|target|forecast|data|evidence|performance|increased|decreased|higher|lower|grew|fell|percent|percentage|report)\b/i;
const numericalValue = /(?:\$|€|£)\s*\d|\b\d+(?:[.,]\d+)?\s*%?\b/i;
const causalLanguage =
  /\b(because|due to|caused by|leads? to|results? in|driven by|as a result of)\b/i;
const causalHypothesisLanguage = /\b(think|believe|might|may|likely|hypothesis|assume)\b/i;
const assumptionLanguage = /\b(assum(?:e|ed|es|ing|ption)|based on|given that|if .+ then)\b/i;
const decisionLanguage = /\b(we should|let's|decide|decision|recommend|ship|launch|adopt)\b/i;
const disagreementLanguage =
  /\b(disagree|not true|wrong|incorrect|does(?:n't| not) match|contradict|different from)\b/i;

function contextFor(
  utterances: readonly TranscriptUtterance[],
  index: number,
): readonly TriggerContext[] {
  return utterances.slice(Math.max(0, index - 2), index + 1).map(({ sequence, speaker, text }) => ({
    sequence,
    speaker,
    text,
  }));
}

function conciseClaim(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length <= 200 ? normalized : `${normalized.slice(0, 197)}...`;
}

function reasonFor(text: string): TriggerReason | undefined {
  const hasAnalyticalTerm = analyticalTerms.test(text);
  if (causalLanguage.test(text) && (hasAnalyticalTerm || causalHypothesisLanguage.test(text))) {
    return 'causal-hypothesis';
  }
  if (assumptionLanguage.test(text) && decisionLanguage.test(text)) {
    return 'assumption-based-decision';
  }
  if (hasAnalyticalTerm && (disagreementLanguage.test(text) || /\bbut\b/i.test(text))) {
    return 'factual-disagreement';
  }
  if (numericalValue.test(text) && hasAnalyticalTerm) {
    return 'numerical-claim';
  }
  return undefined;
}

export function detectTrigger(utterances: readonly TranscriptUtterance[]): TriggerDetection {
  for (const [index, utterance] of utterances.entries()) {
    const reason = reasonFor(utterance.text);
    if (reason !== undefined) {
      return {
        decision: 'ANALYZE',
        opportunity: {
          claim: conciseClaim(utterance.text),
          reason,
          context: contextFor(utterances, index),
        },
      };
    }
  }

  return {
    decision: 'IGNORE',
    reason: 'no-analytical-opportunity',
    context: contextFor(utterances, Math.max(0, utterances.length - 1)),
  };
}

export const triggerDetector: TriggerDetector = { detect: detectTrigger };
