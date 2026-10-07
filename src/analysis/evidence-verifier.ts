import type { AnalysisContract } from './contract.js';
import type { AgenticEvidenceRecord } from './agentic-analysis.js';
import { stdioDatasourceLuid } from '../spike/stdio-bridge-policy.js';

const tableauToolNames = new Set([
  'list_datasources',
  'get_datasource_metadata',
  'query_datasource',
]);
const maxEvidenceTextLength = 2_000;

export type EvidenceStatus = 'supported' | 'contradicted' | 'unresolved';

export type EvidenceProvenance =
  | {
      kind: 'tableau';
      sequence: number;
      toolName: string;
      datasourceLuid: typeof stdioDatasourceLuid;
    }
  | {
      kind: 'non-tableau';
      source: string;
    }
  | {
      kind: 'unavailable';
      reason: string;
    };

/**
 * A bounded interpretation of one observation. It references Tableau evidence
 * without copying raw MCP payloads into the Evidence model.
 */
export type Evidence = {
  questionId: string;
  status: EvidenceStatus;
  provenance: EvidenceProvenance;
  observation: string;
};

export type EvidenceQuestionStatus = {
  questionId: string;
  status: EvidenceStatus;
};

export type EvidenceVerificationResult = {
  completion: 'COMPLETE' | 'INSUFFICIENT';
  questionStatus: readonly EvidenceQuestionStatus[];
  unresolvedRequiredEvidence: readonly string[];
  reasons: readonly string[];
};

export type AgenticEvidenceInterpretation = {
  sequence: number;
  questionId: string;
  status: EvidenceStatus;
  observation: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validateProvenance(value: unknown): value is EvidenceProvenance {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'tableau') {
    return (
      hasOnlyKeys(value, ['kind', 'sequence', 'toolName', 'datasourceLuid']) &&
      typeof value.sequence === 'number' &&
      Number.isSafeInteger(value.sequence) &&
      value.sequence > 0 &&
      typeof value.toolName === 'string' &&
      tableauToolNames.has(value.toolName) &&
      value.datasourceLuid === stdioDatasourceLuid
    );
  }
  if (value.kind === 'non-tableau') {
    return hasOnlyKeys(value, ['kind', 'source']) && validBoundedText(value.source, 256);
  }
  if (value.kind === 'unavailable') {
    return hasOnlyKeys(value, ['kind', 'reason']) && validBoundedText(value.reason, 512);
  }
  return false;
}

function validateEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['questionId', 'status', 'provenance', 'observation']) &&
    validBoundedText(value.questionId, 256) &&
    (value.status === 'supported' ||
      value.status === 'contradicted' ||
      value.status === 'unresolved') &&
    validateProvenance(value.provenance) &&
    validBoundedText(value.observation, maxEvidenceTextLength)
  );
}

function statusForQuestion(
  questionId: string,
  entries: readonly Evidence[],
  reasons: string[],
): EvidenceStatus {
  if (entries.length === 0) return 'unresolved';
  if (
    entries.some(
      ({ provenance }) =>
        provenance.kind !== 'tableau' || provenance.toolName === 'list_datasources',
    )
  ) {
    reasons.push(`required evidence ${questionId} is not Tableau-backed`);
    return 'unresolved';
  }
  const statuses = new Set(entries.map(({ status }) => status));
  if (statuses.has('unresolved')) return 'unresolved';
  if (statuses.has('supported') && statuses.has('contradicted')) {
    reasons.push(`conflicting evidence for required question ${questionId}`);
    return 'unresolved';
  }
  return statuses.has('contradicted') ? 'contradicted' : 'supported';
}

/**
 * Deterministically verifies an Evidence collection against an Analysis
 * Contract. It interprets already-produced evidence; it never chooses tools,
 * creates queries, or infers a new hypothesis.
 */
export function verifyEvidence(
  contract: AnalysisContract,
  input: unknown,
): EvidenceVerificationResult {
  const requiredIds = contract.requiredEvidence.map(({ id }) => id);
  const allQuestionIds = new Set([
    ...requiredIds,
    ...contract.optionalEvidence.map(({ id }) => id),
    ...contract.openQuestions.map(({ id }) => id),
  ]);
  const reasons: string[] = [];
  const unresolvedFromInvalidEvidence = new Set<string>();
  const markInvalidEvidence = (item: unknown): void => {
    if (
      isRecord(item) &&
      typeof item.questionId === 'string' &&
      requiredIds.includes(item.questionId)
    ) {
      unresolvedFromInvalidEvidence.add(item.questionId);
      return;
    }
    for (const questionId of requiredIds) unresolvedFromInvalidEvidence.add(questionId);
  };
  if (!Array.isArray(input)) {
    return {
      completion: 'INSUFFICIENT',
      questionStatus: requiredIds.map((questionId) => ({ questionId, status: 'unresolved' })),
      unresolvedRequiredEvidence: requiredIds,
      reasons: ['evidence must be an array'],
    };
  }

  const evidence: Evidence[] = [];
  for (const item of input) {
    if (!validateEvidence(item)) {
      reasons.push('evidence contains a malformed item');
      markInvalidEvidence(item);
      continue;
    }
    if (!allQuestionIds.has(item.questionId)) {
      reasons.push(`evidence references unknown question ${item.questionId}`);
      markInvalidEvidence(item);
      continue;
    }
    evidence.push(item);
  }

  const grouped = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const entries = grouped.get(item.questionId) ?? [];
    entries.push(item);
    grouped.set(item.questionId, entries);
  }
  const questionStatus = requiredIds.map((questionId) => ({
    questionId,
    status: statusForQuestion(questionId, grouped.get(questionId) ?? [], reasons),
  }));
  const unresolvedRequiredEvidence = requiredIds.filter(
    (questionId) =>
      unresolvedFromInvalidEvidence.has(questionId) ||
      questionStatus.find((status) => status.questionId === questionId)?.status === 'unresolved',
  );
  return {
    completion:
      reasons.length === 0 && unresolvedRequiredEvidence.length === 0 ? 'COMPLETE' : 'INSUFFICIENT',
    questionStatus,
    unresolvedRequiredEvidence,
    reasons,
  };
}

/**
 * Interprets records only after they exist. The sequence is resolved against
 * an actual normalized record, and list-only provenance cannot carry a
 * substantive supported/contradicted interpretation.
 */
export function interpretAgenticEvidence(
  records: readonly AgenticEvidenceRecord[],
  interpretations: readonly AgenticEvidenceInterpretation[],
): readonly Evidence[] {
  const recordsBySequence = new Map(records.map((record) => [record.sequence, record]));
  return interpretations.map((interpretation) => {
    const record = recordsBySequence.get(interpretation.sequence);
    if (
      record === undefined ||
      !('tool' in record.evidence) ||
      record.toolName !== record.evidence.tool
    ) {
      throw new Error('EVIDENCE_MAPPING_PROVENANCE_INVALID');
    }
    if (record.evidence.tool === 'list_datasources' && interpretation.status !== 'unresolved') {
      throw new Error('EVIDENCE_INTERPRETATION_PROVENANCE_INVALID');
    }
    return {
      questionId: interpretation.questionId,
      status: interpretation.status,
      observation: interpretation.observation,
      provenance: {
        kind: 'tableau' as const,
        sequence: record.sequence,
        toolName: record.toolName,
        datasourceLuid: record.evidence.datasourceLuid,
      },
    };
  });
}
