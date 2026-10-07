import { describe, expect, it } from 'vitest';
import type { AnalysisContract } from '../src/analysis/contract.js';
import type { AgenticEvidenceRecord } from '../src/analysis/agentic-analysis.js';
import { interpretAgenticEvidence, verifyEvidence } from '../src/analysis/evidence-verifier.js';
import { stdioDatasourceLuid } from '../src/spike/stdio-bridge-policy.js';

const contract: AnalysisContract = {
  claim: 'We should launch next week.',
  context: [{ sequence: 0, speaker: 'A', text: 'Demand is high.' }],
  requiredEvidence: [
    { id: 'assumption-support', question: 'Is the assumption supported?' },
    { id: 'launch-timing', question: 'Is the launch timing supported?' },
  ],
  optionalEvidence: [{ id: 'market-context', question: 'What is the market context?' }],
  openQuestions: [],
};

function tableauEvidence(
  questionId: string,
  status: 'supported' | 'contradicted' | 'unresolved' = 'supported',
) {
  return {
    questionId,
    status,
    provenance: {
      kind: 'tableau' as const,
      sequence: 1,
      toolName: 'query_datasource',
      datasourceLuid: stdioDatasourceLuid,
    },
    observation: 'Bounded Tableau-backed observation.',
  };
}

describe('analysis evidence verifier', () => {
  it('returns COMPLETE when every required question is Tableau-backed and resolved', () => {
    const result = verifyEvidence(contract, [
      tableauEvidence('assumption-support'),
      tableauEvidence('launch-timing'),
    ]);

    expect(result).toEqual({
      completion: 'COMPLETE',
      questionStatus: [
        { questionId: 'assumption-support', status: 'supported' },
        { questionId: 'launch-timing', status: 'supported' },
      ],
      unresolvedRequiredEvidence: [],
      reasons: [],
    });
  });

  it('returns unresolved required questions when evidence is partial', () => {
    const result = verifyEvidence(contract, [tableauEvidence('assumption-support')]);

    expect(result.completion).toBe('INSUFFICIENT');
    expect(result.unresolvedRequiredEvidence).toEqual(['launch-timing']);
  });

  it('reports required questions when complete evidence includes malformed or unknown items', () => {
    const completeEvidence = [
      tableauEvidence('assumption-support'),
      tableauEvidence('launch-timing'),
    ];
    const malformed = verifyEvidence(contract, [
      ...completeEvidence,
      { questionId: 'launch-timing' },
    ]);
    const unknown = verifyEvidence(contract, [
      ...completeEvidence,
      {
        questionId: 'undeclared-question',
        status: 'supported',
        provenance: { kind: 'non-tableau', source: 'unknown question' },
        observation: 'This question is not in the contract.',
      },
    ]);

    expect(malformed.completion).toBe('INSUFFICIENT');
    expect(malformed.unresolvedRequiredEvidence).toEqual(['launch-timing']);
    expect(malformed.questionStatus).toEqual([
      { questionId: 'assumption-support', status: 'supported' },
      { questionId: 'launch-timing', status: 'unresolved' },
    ]);
    expect(unknown.completion).toBe('INSUFFICIENT');
    expect(unknown.unresolvedRequiredEvidence).toEqual(['assumption-support', 'launch-timing']);
  });

  it('represents a contradicted hypothesis as resolved negative evidence', () => {
    const result = verifyEvidence(contract, [
      tableauEvidence('assumption-support', 'contradicted'),
      tableauEvidence('launch-timing'),
    ]);

    expect(result.completion).toBe('COMPLETE');
    expect(result.questionStatus[0]).toEqual({
      questionId: 'assumption-support',
      status: 'contradicted',
    });
  });

  it('fails closed for non-Tableau evidence on a required question', () => {
    const result = verifyEvidence(contract, [
      {
        questionId: 'assumption-support',
        status: 'supported',
        provenance: { kind: 'non-tableau', source: 'model report' },
        observation: 'The model says it is supported.',
      },
      tableauEvidence('launch-timing'),
    ]);

    expect(result.completion).toBe('INSUFFICIENT');
    expect(result.unresolvedRequiredEvidence).toEqual(['assumption-support']);
  });

  it('fails closed for malformed, unavailable, unknown, and conflicting evidence', () => {
    expect(verifyEvidence(contract, [{ questionId: 'bad' }]).completion).toBe('INSUFFICIENT');
    expect(
      verifyEvidence(contract, [
        tableauEvidence('assumption-support'),
        {
          questionId: 'launch-timing',
          status: 'unresolved',
          provenance: { kind: 'unavailable', reason: 'Tableau result unavailable' },
          observation: 'No result was available.',
        },
      ]).completion,
    ).toBe('INSUFFICIENT');
    const conflicting = verifyEvidence(contract, [
      tableauEvidence('assumption-support', 'supported'),
      tableauEvidence('assumption-support', 'contradicted'),
      tableauEvidence('launch-timing'),
    ]);
    expect(conflicting.completion).toBe('INSUFFICIENT');
    expect(conflicting.unresolvedRequiredEvidence).toEqual(['assumption-support']);
    expect(conflicting.reasons).toContain(
      'conflicting evidence for required question assumption-support',
    );
  });

  it('interprets agentic records only after they exist', () => {
    const records: AgenticEvidenceRecord[] = [
      {
        sequence: 1,
        toolName: 'query_datasource',
        evidence: {
          tool: 'query_datasource' as const,
          datasourceLuid: stdioDatasourceLuid,
          rows: [{ value: 120 }],
        },
        summary: {} as never,
      },
    ];
    const evidence = interpretAgenticEvidence(records, [
      {
        sequence: 1,
        questionId: 'assumption-support',
        status: 'supported',
        observation: 'The Tableau value supports the assumption.',
      },
      {
        sequence: 1,
        questionId: 'launch-timing',
        status: 'contradicted',
        observation: 'The Tableau value contradicts the timing.',
      },
    ]);

    expect(verifyEvidence(contract, evidence).completion).toBe('COMPLETE');
  });

  it('maps an unavailable tool result to unresolved evidence and fails closed', () => {
    const records: AgenticEvidenceRecord[] = [
      {
        sequence: 1,
        toolName: 'query_datasource',
        evidence: {
          status: 'tool_error',
          category: 'query_error',
          message: 'The Tableau query could not be executed.',
          recoverable: true,
        },
        summary: {} as never,
      },
      {
        sequence: 2,
        toolName: 'query_datasource',
        evidence: {
          tool: 'query_datasource' as const,
          datasourceLuid: stdioDatasourceLuid,
          rows: [{ value: 120 }],
        },
        summary: {} as never,
      },
    ];

    const evidence = interpretAgenticEvidence(records, [
      {
        sequence: 1,
        questionId: 'assumption-support',
        status: 'unresolved',
        observation: 'The query result was unavailable.',
      },
      {
        sequence: 2,
        questionId: 'launch-timing',
        status: 'supported',
        observation: 'The Tableau value supports the timing.',
      },
    ]);

    expect(evidence[0]).toEqual({
      questionId: 'assumption-support',
      status: 'unresolved',
      observation: 'The Tableau query could not be executed.',
      provenance: {
        kind: 'unavailable',
        reason: 'The Tableau query could not be executed.',
      },
    });
    expect(verifyEvidence(contract, evidence)).toEqual({
      completion: 'INSUFFICIENT',
      questionStatus: [
        { questionId: 'assumption-support', status: 'unresolved' },
        { questionId: 'launch-timing', status: 'supported' },
      ],
      unresolvedRequiredEvidence: ['assumption-support'],
      reasons: ['required evidence assumption-support is not Tableau-backed'],
    });
  });

  it('rejects missing sequences and list-only semantic interpretation', () => {
    const records: AgenticEvidenceRecord[] = [
      {
        sequence: 1,
        toolName: 'list_datasources',
        evidence: {
          tool: 'list_datasources' as const,
          datasourceLuid: stdioDatasourceLuid,
          datasources: [],
        },
        summary: {} as never,
      },
    ];
    expect(() =>
      interpretAgenticEvidence(records, [
        {
          sequence: 2,
          questionId: 'assumption-support',
          status: 'supported',
          observation: 'Not available.',
        },
      ]),
    ).toThrow('EVIDENCE_MAPPING_PROVENANCE_INVALID');
    expect(() =>
      interpretAgenticEvidence(records, [
        {
          sequence: 1,
          questionId: 'assumption-support',
          status: 'supported',
          observation: 'Datasource exists.',
        },
      ]),
    ).toThrow('EVIDENCE_INTERPRETATION_PROVENANCE_INVALID');

    const directListEvidence = verifyEvidence(contract, [
      {
        questionId: 'assumption-support',
        status: 'supported',
        provenance: {
          kind: 'tableau',
          sequence: 1,
          toolName: 'list_datasources',
          datasourceLuid: stdioDatasourceLuid,
        },
        observation: 'Datasource is visible.',
      },
      tableauEvidence('launch-timing'),
    ]);
    expect(directListEvidence.completion).toBe('INSUFFICIENT');
  });

  it('rejects mismatched normalized tool provenance', () => {
    const records: AgenticEvidenceRecord[] = [
      {
        sequence: 1,
        toolName: 'query_datasource',
        evidence: {
          tool: 'get_datasource_metadata' as const,
          datasourceLuid: stdioDatasourceLuid,
          fieldCaptions: ['Daily View Count'],
        },
        summary: {} as never,
      },
    ];
    expect(() =>
      interpretAgenticEvidence(records, [
        {
          sequence: 1,
          questionId: 'assumption-support',
          status: 'supported',
          observation: 'The metadata supports the assumption.',
        },
      ]),
    ).toThrow('EVIDENCE_MAPPING_PROVENANCE_INVALID');
  });
});
