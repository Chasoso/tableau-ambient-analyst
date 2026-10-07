import type { AnalyzeOpportunity, TriggerContext, TriggerReason } from '../trigger/detector.js';

export type AnalysisQuestion = {
  id: string;
  question: string;
};

export type AnalysisContract = {
  claim: string;
  context: readonly TriggerContext[];
  requiredEvidence: readonly AnalysisQuestion[];
  optionalEvidence: readonly AnalysisQuestion[];
  openQuestions: readonly AnalysisQuestion[];
};

export class AnalysisContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisContractError';
  }
}

const validReasons = new Set<TriggerReason>([
  'numerical-claim',
  'causal-hypothesis',
  'assumption-based-decision',
  'factual-disagreement',
]);

const questionsByReason: Record<TriggerReason, readonly AnalysisQuestion[]> = {
  'numerical-claim': [
    {
      id: 'claim-value',
      question: 'What value does the evidence show for the claimed metric or quantity?',
    },
    {
      id: 'claim-scope',
      question: 'What time period, population, or scope does that value represent?',
    },
  ],
  'causal-hypothesis': [
    {
      id: 'cause-outcome-relationship',
      question:
        'What evidence supports or contradicts the proposed cause-and-outcome relationship?',
    },
  ],
  'assumption-based-decision': [
    {
      id: 'decision-assumption-support',
      question: 'Is the assumption underlying the decision supported or contradicted by evidence?',
    },
  ],
  'factual-disagreement': [
    {
      id: 'disputed-fact',
      question: 'Which source or measurement is supported by the available evidence?',
    },
    {
      id: 'discrepancy-scope',
      question: 'What scope, definition, or time period explains the discrepancy?',
    },
  ],
};

const optionalQuestionsByReason: Record<TriggerReason, readonly AnalysisQuestion[]> = {
  'numerical-claim': [],
  'causal-hypothesis': [
    {
      id: 'alternative-explanations',
      question: 'What relevant alternative explanation should be considered?',
    },
  ],
  'assumption-based-decision': [],
  'factual-disagreement': [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateQuestion(value: unknown, location: string): AnalysisQuestion {
  if (!isRecord(value)) {
    throw new AnalysisContractError(`${location} must be an object`);
  }

  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'id' && key !== 'question')) {
    throw new AnalysisContractError(`${location} contains an unsupported field`);
  }

  const id = value.id;
  const question = value.question;
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new AnalysisContractError(`${location}.id must be a kebab-case string`);
  }
  if (typeof question !== 'string' || question.trim() === '') {
    throw new AnalysisContractError(`${location}.question must be a non-empty string`);
  }

  return { id, question };
}

function validateQuestionList(value: unknown, location: string): readonly AnalysisQuestion[] {
  if (!Array.isArray(value)) {
    throw new AnalysisContractError(`${location} must be an array`);
  }
  return value.map((question, index) => validateQuestion(question, `${location}[${index}]`));
}

function validateContext(value: unknown, location: string): TriggerContext {
  if (!isRecord(value)) {
    throw new AnalysisContractError(`${location} must be an object`);
  }

  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'sequence' && key !== 'speaker' && key !== 'text')) {
    throw new AnalysisContractError(`${location} contains an unsupported field`);
  }

  const sequence = value.sequence;
  const speaker = value.speaker;
  const text = value.text;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new AnalysisContractError(`${location}.sequence must be a non-negative integer`);
  }
  if (typeof speaker !== 'string' || speaker.trim() === '') {
    throw new AnalysisContractError(`${location}.speaker must be a non-empty string`);
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new AnalysisContractError(`${location}.text must be a non-empty string`);
  }

  return { sequence, speaker, text };
}

function validateContextList(value: unknown): readonly TriggerContext[] {
  if (!Array.isArray(value)) {
    throw new AnalysisContractError('context must be an array');
  }
  if (value.length === 0) {
    throw new AnalysisContractError('context must contain at least one utterance');
  }
  return value.map((utterance, index) => validateContext(utterance, `context[${index}]`));
}

export function validateAnalysisContract(value: unknown): AnalysisContract {
  if (!isRecord(value)) {
    throw new AnalysisContractError('analysis contract must be an object');
  }

  const expectedKeys = new Set([
    'claim',
    'context',
    'requiredEvidence',
    'optionalEvidence',
    'openQuestions',
  ]);
  if (Object.keys(value).some((key) => !expectedKeys.has(key))) {
    throw new AnalysisContractError('analysis contract contains an unsupported field');
  }

  const claim = value.claim;
  if (typeof claim !== 'string' || claim.trim() === '') {
    throw new AnalysisContractError('analysis contract.claim must be a non-empty string');
  }

  const context = validateContextList(value.context);
  const requiredEvidence = validateQuestionList(value.requiredEvidence, 'requiredEvidence');
  const optionalEvidence = validateQuestionList(value.optionalEvidence, 'optionalEvidence');
  const openQuestions = validateQuestionList(value.openQuestions, 'openQuestions');
  if (requiredEvidence.length === 0) {
    throw new AnalysisContractError('requiredEvidence must contain at least one question');
  }

  const questionIds = [...requiredEvidence, ...optionalEvidence, ...openQuestions].map(
    ({ id }) => id,
  );
  if (new Set(questionIds).size !== questionIds.length) {
    throw new AnalysisContractError('analysis contract question IDs must be unique');
  }

  return { claim, context, requiredEvidence, optionalEvidence, openQuestions };
}

export function analysisContractFromOpportunity(opportunity: AnalyzeOpportunity): AnalysisContract {
  if (
    typeof opportunity.claim !== 'string' ||
    opportunity.claim.trim() === '' ||
    !validReasons.has(opportunity.reason)
  ) {
    throw new AnalysisContractError('opportunity must contain a supported claim and reason');
  }

  return validateAnalysisContract({
    claim: opportunity.claim,
    context: opportunity.context,
    requiredEvidence: questionsByReason[opportunity.reason],
    optionalEvidence: optionalQuestionsByReason[opportunity.reason],
    openQuestions: [],
  });
}
