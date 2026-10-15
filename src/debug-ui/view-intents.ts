import {
  validateViewActionProposal,
  type ViewActionEligibility,
  type ViewActionPolicy,
  type ViewActionProposal,
  type ViewActionScalar,
  type ViewActionValueType,
} from './view-actions.js';

const maxNameLength = 200;
const maxValues = 16;
const maxEvidenceIds = 64;
const maxMappings = 32;

export type ViewIntentOperation = 'set-filter' | 'set-parameter';

export type ViewIntent = {
  id: string;
  runId: string;
  evidenceRef: string;
  operation: ViewIntentOperation;
  semanticKey: string;
  valueType: ViewActionValueType;
  values: readonly ViewActionScalar[];
};

export type VerifiedViewIntentContext = {
  runId: string;
  verification: 'VERIFIED';
  intervention: 'INTERVENE';
  verifiedEvidenceIds: readonly string[];
};

export type ViewIntentValueMapping = {
  from: ViewActionScalar;
  to: ViewActionScalar;
};

export type FilterViewIntentMapping = {
  semanticKey: string;
  operation: 'set-filter';
  valueType: ViewActionValueType;
  target: { kind: 'worksheet-field'; worksheet: string; field: string };
  values: readonly ViewIntentValueMapping[];
};

export type ParameterViewIntentMapping = {
  semanticKey: string;
  operation: 'set-parameter';
  valueType: ViewActionValueType;
  target: { kind: 'parameter'; name: string };
  values: readonly ViewIntentValueMapping[];
};

export type ViewIntentMapping = FilterViewIntentMapping | ParameterViewIntentMapping;

export type ViewIntentResolutionInput = {
  intent: unknown;
  context: unknown;
  mappings: unknown;
  policy: ViewActionPolicy;
};

export type ViewIntentResolution =
  | { status: 'READY'; proposal: ViewActionProposal }
  | { status: 'NO_ACTION'; reason: string }
  | { status: 'REJECTED'; reason: string };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is ViewActionScalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isValueType(value: unknown): value is ViewActionValueType {
  return value === 'string' || value === 'number' || value === 'boolean';
}

function isBoundedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxNameLength;
}

function sameValue(left: ViewActionScalar, right: ViewActionScalar): boolean {
  return Object.is(left, right);
}

function isTypedValue(value: unknown, valueType: ViewActionValueType): value is ViewActionScalar {
  return isScalar(value) && typeof value === valueType;
}

function parseIntent(value: unknown): ViewIntent | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isBoundedName(value.id) ||
    !isBoundedName(value.runId) ||
    !isBoundedName(value.evidenceRef) ||
    !isBoundedName(value.semanticKey) ||
    !isValueType(value.valueType) ||
    (value.operation !== 'set-filter' && value.operation !== 'set-parameter') ||
    !Array.isArray(value.values) ||
    value.values.length === 0 ||
    value.values.length > maxValues
  ) {
    return undefined;
  }
  const valueType = value.valueType;
  const values = value.values;
  if (!values.every((item) => isTypedValue(item, valueType))) return undefined;
  if (value.operation === 'set-parameter' && values.length !== 1) return undefined;
  return {
    id: value.id,
    runId: value.runId,
    evidenceRef: value.evidenceRef,
    operation: value.operation,
    semanticKey: value.semanticKey,
    valueType,
    values: [...values],
  };
}

function parseContext(value: unknown): VerifiedViewIntentContext | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isBoundedName(value.runId) ||
    value.verification !== 'VERIFIED' ||
    value.intervention !== 'INTERVENE' ||
    !Array.isArray(value.verifiedEvidenceIds) ||
    value.verifiedEvidenceIds.length === 0 ||
    value.verifiedEvidenceIds.length > maxEvidenceIds ||
    !value.verifiedEvidenceIds.every(isBoundedName)
  ) {
    return undefined;
  }
  return {
    runId: value.runId,
    verification: 'VERIFIED',
    intervention: 'INTERVENE',
    verifiedEvidenceIds: [...value.verifiedEvidenceIds],
  };
}

function parseValueMappings(
  value: unknown,
  valueType: ViewActionValueType,
): ViewIntentValueMapping[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return undefined;
  const mappings: ViewIntentValueMapping[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isTypedValue(item.from, valueType) ||
      !isTypedValue(item.to, valueType)
    ) {
      return undefined;
    }
    const from = item.from;
    const to = item.to;
    if (mappings.some((entry) => sameValue(entry.from, from))) return undefined;
    mappings.push({ from, to });
  }
  return mappings;
}

function parseMapping(value: unknown): ViewIntentMapping | undefined {
  if (!isRecord(value)) return undefined;
  if (!isBoundedName(value.semanticKey) || !isValueType(value.valueType)) return undefined;
  if (value.operation === 'set-filter') {
    if (!isRecord(value.target) || value.target.kind !== 'worksheet-field') return undefined;
    if (!isBoundedName(value.target.worksheet) || !isBoundedName(value.target.field))
      return undefined;
    const values = parseValueMappings(value.values, value.valueType);
    return values
      ? {
          semanticKey: value.semanticKey,
          operation: 'set-filter',
          valueType: value.valueType,
          target: {
            kind: 'worksheet-field',
            worksheet: value.target.worksheet,
            field: value.target.field,
          },
          values,
        }
      : undefined;
  }
  if (value.operation === 'set-parameter') {
    if (!isRecord(value.target) || value.target.kind !== 'parameter') return undefined;
    if (!isBoundedName(value.target.name)) return undefined;
    const values = parseValueMappings(value.values, value.valueType);
    return values
      ? {
          semanticKey: value.semanticKey,
          operation: 'set-parameter',
          valueType: value.valueType,
          target: { kind: 'parameter', name: value.target.name },
          values,
        }
      : undefined;
  }
  return undefined;
}

function parseMappings(value: unknown): ViewIntentMapping[] | undefined {
  if (!Array.isArray(value) || value.length > maxMappings) return undefined;
  const mappings: ViewIntentMapping[] = [];
  for (const item of value) {
    const mapping = parseMapping(item);
    if (!mapping) return undefined;
    mappings.push(mapping);
  }
  return mappings;
}

function trustedEligibility(): ViewActionEligibility {
  return {
    status: 'completed',
    scenario: {
      trigger: { decision: 'ANALYZE' },
      verifier: { status: 'VERIFIED' },
      intervention: { decision: 'INTERVENE' },
    },
    audit: [
      'trigger-detected',
      'analysis-contract-created',
      'tableau-analysis-started',
      'evidence-collected',
      'verification-complete',
      'intervention-recommended',
    ],
  };
}

function proposalFor(
  intent: ViewIntent,
  mapping: ViewIntentMapping,
  policy: ViewActionPolicy,
): ViewActionProposal {
  const values = intent.values.map((value) => {
    const translated = mapping.values.find((entry) => sameValue(entry.from, value));
    return translated!.to;
  });
  return {
    id: intent.id,
    evidenceRef: intent.evidenceRef,
    scope: { dashboard: policy.scope.dashboard },
    action:
      mapping.operation === 'set-filter'
        ? { type: 'set-filter', target: mapping.target, values }
        : { type: 'set-parameter', target: mapping.target, value: values[0]! },
  };
}

export function resolveViewIntent(input: ViewIntentResolutionInput): ViewIntentResolution {
  const intent = parseIntent(input.intent);
  const context = parseContext(input.context);
  const mappings = parseMappings(input.mappings);
  if (!intent || !context || !mappings) {
    return { status: 'REJECTED', reason: 'View intent input is malformed.' };
  }
  if (intent.runId !== context.runId) {
    return { status: 'REJECTED', reason: 'View intent run does not match verified context.' };
  }
  if (!context.verifiedEvidenceIds.some((id) => id === intent.evidenceRef)) {
    return { status: 'REJECTED', reason: 'View intent evidence is not verified for this run.' };
  }
  const matches = mappings.filter(
    (mapping) =>
      mapping.semanticKey === intent.semanticKey && mapping.operation === intent.operation,
  );
  if (matches.length === 0) {
    return { status: 'NO_ACTION', reason: 'No dashboard mapping matches this view intent.' };
  }
  if (matches.length !== 1) {
    return { status: 'REJECTED', reason: 'Multiple dashboard mappings match this view intent.' };
  }
  const mapping = matches[0]!;
  if (mapping.valueType !== intent.valueType) {
    return { status: 'REJECTED', reason: 'View intent value type is not approved.' };
  }
  if (
    intent.values.some((value) => !mapping.values.some((entry) => sameValue(entry.from, value)))
  ) {
    return { status: 'REJECTED', reason: 'View intent value is not approved by the mapping.' };
  }
  const proposal = proposalFor(intent, mapping, input.policy);
  const policyValidation = validateViewActionProposal(trustedEligibility(), proposal, input.policy);
  if (!policyValidation.ok) {
    return { status: 'REJECTED', reason: policyValidation.error };
  }
  return { status: 'READY', proposal: policyValidation.proposal };
}
