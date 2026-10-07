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

export type TriggerDetectionOptions = {
  afterSequence?: number;
};

export interface TriggerDetector {
  detect(
    utterances: readonly TranscriptUtterance[],
    options?: TriggerDetectionOptions,
  ): TriggerDetection;
}

const analyticalTerms =
  /\b(metric|sales|revenue|conversion|rate|result|value|number|target|forecast|data|evidence|performance|increased|decreased|higher|lower|grew|fell|percent|percentage|report|customer|customers|user|users|order|orders|case|cases|unit|units|total|amount|volume|cost|price)\b/i;
const japaneseAnalyticalTerms =
  /(売上|収益|コンバージョン|指標|数値|目標|予測|データ|根拠|実績|増加|減少|上昇|低下|顧客|ユーザー|注文|単価|費用|価格|離脱|レポート)/u;
const numericalValue = /(?:\$|€|£)\s*\d|\b\d+(?:[.,]\d+)?\s*%?\b/i;
const japaneseNumericalValue = /\d+(?:\.\d+)?\s*(?:%|％|件|人|円|個|回|台|名)/u;
const numericalClaimLanguage =
  /\b(is|are|was|were|shows?|reported|reached|increased|decreased|has|have|had|total(?:ed)?|equals?)\b/i;
const japaneseNumericalClaimLanguage = /(は|が|です|でした|増え|減り|増加|減少|上昇|低下)/u;
const temporalLanguage = /\b(meeting|clock|o'clock|today|tomorrow|starts?|ends?|am|pm)\b/i;
const causalLanguage =
  /\b(because|due to|caused? by|caus(?:e|ed|es|ing)|leads? to|results? in|driven by|as a result of)\b/i;
const strongCausalLanguage =
  /\b(caus(?:e|ed|es|ing)|leads? to|results? in|driven by|as a result of)\b/i;
const causalHypothesisLanguage = /\b(think|believe|might|may|likely|hypothesis|assume)\b/i;
const japaneseCausalLanguage = /(原因|理由|ため|ので|結果|影響|起因|増やした|減らした|つながった)/u;
const japaneseStrongCausalLanguage = /(原因|起因|影響|結果|つながった)/u;
const japaneseCausalHypothesisLanguage = /(と思う|と思います|かもしれない|可能性)/u;
const assumptionLanguage = /\b(assum(?:e|ed|es|ing|ption)|based on|given that|if .+ then)\b/i;
const japaneseAssumptionLanguage = /(前提|仮定|としたら|ならば|と仮定)/u;
const decisionLanguage = /\b(we should|let's|decide|decision|recommend|ship|launch|adopt)\b/i;
const japaneseDecisionLanguage = /(すべき|決め|決定|リリース|採用|進め|導入)/u;
const disagreementLanguage =
  /\b(disagree|not true|wrong|incorrect|does(?:n't| not) match|contradict|different from|otherwise)\b/i;
const japaneseDisagreementLanguage = /(不一致|食い違|一致しない|異なる|違う|反対|しかし|ですが)/u;

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
  const hasCurrentAnalyticalTerm = analyticalTerms.test(text) || japaneseAnalyticalTerms.test(text);
  const hasContextAnalyticalTerm =
    analyticalTerms.test(contextText) || japaneseAnalyticalTerms.test(contextText);
  const currentCausal = causalLanguage.test(text) || japaneseCausalLanguage.test(text);
  const precedingCausal =
    causalLanguage.test(precedingText) || japaneseCausalLanguage.test(precedingText);
  const currentStrongCausal =
    strongCausalLanguage.test(text) || japaneseStrongCausalLanguage.test(text);
  const currentCausalHypothesis =
    causalHypothesisLanguage.test(text) || japaneseCausalHypothesisLanguage.test(text);
  const currentNumericalValue = numericalValue.test(text) || japaneseNumericalValue.test(text);
  const currentNumericalClaim =
    numericalClaimLanguage.test(text) || japaneseNumericalClaimLanguage.test(text);
  const currentAssumption = assumptionLanguage.test(text) || japaneseAssumptionLanguage.test(text);
  const precedingAssumption =
    assumptionLanguage.test(precedingText) || japaneseAssumptionLanguage.test(precedingText);
  const currentDecision = decisionLanguage.test(text) || japaneseDecisionLanguage.test(text);
  const currentDisagreement =
    disagreementLanguage.test(text) || japaneseDisagreementLanguage.test(text);
  const numericValues = [...contextText.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map(([value]) => value);
  const hasDistinctNumericValues = new Set(numericValues).size > 1;
  if (
    (hasCurrentAnalyticalTerm || currentStrongCausal || currentCausalHypothesis) &&
    (currentCausal || precedingCausal || currentCausalHypothesis)
  ) {
    return 'causal-hypothesis';
  }
  if (currentDecision && (currentAssumption || precedingAssumption)) {
    return 'assumption-based-decision';
  }
  if (
    hasCurrentAnalyticalTerm &&
    (currentDisagreement ||
      /\bbut\b/i.test(text) ||
      (currentNumericalValue && hasDistinctNumericValues && hasContextAnalyticalTerm))
  ) {
    return 'factual-disagreement';
  }
  if (
    currentNumericalValue &&
    ((hasCurrentAnalyticalTerm && currentNumericalClaim) ||
      (currentNumericalClaim && !temporalLanguage.test(text)))
  ) {
    return 'numerical-claim';
  }
  return undefined;
}

export function detectTrigger(
  utterances: readonly TranscriptUtterance[],
  options: TriggerDetectionOptions = {},
): TriggerDetection {
  for (const [index, utterance] of utterances.entries()) {
    if (options.afterSequence !== undefined && utterance.sequence <= options.afterSequence) {
      continue;
    }
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
