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
  /\b(metric|sales|revenue|conversion|rate|result|value|number|target|forecast|data|evidence|performance|increased|decreased|higher|lower|grew|fell|percent|percentage|report|customer|customers|user|users|order|orders|case|cases|unit|units|total|amount|volume|cost|price)\b/i;
const numericalValue = /(?:\$|€|£)\s*\d|\b\d+(?:[.,]\d+)?\s*%?\b/i;
const numericalClaimLanguage =
  /\b(is|are|was|were|shows?|reported|reached|increased|decreased|has|have|had|total(?:ed)?|equals?)\b/i;
const temporalLanguage = /\b(meeting|clock|o'clock|today|tomorrow|starts?|ends?|am|pm)\b/i;
const causalLanguage =
  /\b(because|due to|caused? by|caus(?:e|ed|es|ing)|leads? to|results? in|driven by|as a result of)\b/i;
const strongCausalLanguage =
  /\b(caus(?:e|ed|es|ing)|leads? to|results? in|driven by|as a result of)\b/i;
const causalHypothesisLanguage = /\b(think|believe|might|may|likely|hypothesis|assume)\b/i;
const assumptionLanguage = /\b(assum(?:e|ed|es|ing|ption)|based on|given that|if .+ then)\b/i;
const decisionLanguage = /\b(we should|let's|decide|decision|recommend|ship|launch|adopt)\b/i;
const disagreementLanguage =
  /\b(disagree|not true|wrong|incorrect|does(?:n't| not) match|contradict|different from|otherwise)\b/i;

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

function reasonFor(
  text: string,
  context: readonly TranscriptUtterance[],
): TriggerReason | undefined {
  const precedingText = context
    .slice(0, -1)
    .map(({ text: contextUtterance }) => contextUtterance)
    .join(' ');
  const contextText = `${precedingText} ${text}`.trim();
  const hasCurrentAnalyticalTerm = analyticalTerms.test(text);
  const hasContextAnalyticalTerm = analyticalTerms.test(contextText);
  const numericValues = [...contextText.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map(([value]) => value);
  const hasDistinctNumericValues = new Set(numericValues).size > 1;
  if (
    (hasCurrentAnalyticalTerm ||
      strongCausalLanguage.test(text) ||
      causalHypothesisLanguage.test(text)) &&
    (causalLanguage.test(text) ||
      causalLanguage.test(precedingText) ||
      causalHypothesisLanguage.test(text))
  ) {
    return 'causal-hypothesis';
  }
  if (
    decisionLanguage.test(text) &&
    (assumptionLanguage.test(text) || assumptionLanguage.test(precedingText))
  ) {
    return 'assumption-based-decision';
  }
  if (
    hasCurrentAnalyticalTerm &&
    (disagreementLanguage.test(text) ||
      /\bbut\b/i.test(text) ||
      (numericalValue.test(text) && hasDistinctNumericValues && hasContextAnalyticalTerm))
  ) {
    return 'factual-disagreement';
  }
  if (
    numericalValue.test(text) &&
    ((hasCurrentAnalyticalTerm && numericalClaimLanguage.test(text)) ||
      (numericalClaimLanguage.test(text) && !temporalLanguage.test(text)))
  ) {
    return 'numerical-claim';
  }
  return undefined;
}

export function detectTrigger(utterances: readonly TranscriptUtterance[]): TriggerDetection {
  for (const [index, utterance] of utterances.entries()) {
    const context = utterances.slice(Math.max(0, index - 2), index + 1);
    const reason = reasonFor(utterance.text, context);
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
