import { describe, expect, it } from 'vitest';

import {
  extractFinalAnswer,
  extractStructuredOutcome,
  extractToolCalls,
  resultRowCount,
} from '../src/spike/response-telemetry.js';

const validOutcome = {
  outcome: 'rejected',
  summary: 'The comparison contradicted the initial hypothesis.',
  evidence_complete: true,
  missing_evidence: [],
  hypothesis_state: 'rejected',
  stop_reason: 'sufficient-evidence',
};

describe('Responses telemetry extraction', () => {
  it('extracts text from top-level and nested final output', () => {
    expect(extractFinalAnswer([], 'final text')).toBe('final text');
    expect(
      extractFinalAnswer([
        { type: 'message', content: [{ type: 'output_text', text: 'nested text' }] },
      ]),
    ).toBe('nested text');
  });

  it('extracts structured JSON after MCP calls and normalizes the contract', () => {
    const answer = extractFinalAnswer([
      { type: 'mcp_call', name: 'query-datasource' },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validOutcome) }] },
    ]);

    expect(extractStructuredOutcome(answer)).toEqual(validOutcome);
  });

  it('accepts the camelCase prompt shape but returns the stable snake_case contract', () => {
    const answer = JSON.stringify({
      outcome: 'insufficient-evidence',
      summary: 'The datasource lacks causal evidence.',
      evidenceComplete: false,
      missingEvidence: ['external-cause'],
      hypothesisState: 'not-applicable',
      stopReason: 'insufficient-evidence',
    });

    expect(extractStructuredOutcome(answer)).toEqual({
      outcome: 'insufficient-evidence',
      summary: 'The datasource lacks causal evidence.',
      evidence_complete: false,
      missing_evidence: ['external-cause'],
      hypothesis_state: 'not-applicable',
      stop_reason: 'insufficient-evidence',
    });
  });

  it('fails closed for missing or malformed final output', () => {
    expect(extractFinalAnswer([{ type: 'mcp_call', name: 'query-datasource' }])).toBe('');
    expect(extractStructuredOutcome('not JSON')).toBeNull();
    expect(extractStructuredOutcome('{"outcome":"supported"}')).toBeNull();
    expect(
      extractStructuredOutcome(JSON.stringify({ ...validOutcome, evidence_complete: 'yes' })),
    ).toBeNull();
  });

  it('extracts ordered tool calls and distinguishes empty from non-empty results', () => {
    const calls = extractToolCalls(
      [
        {
          type: 'mcp_call',
          name: 'get-datasource-metadata',
          arguments: JSON.stringify({ datasourceLuid: 'ds-1' }),
          output: JSON.stringify({ rows: [{ field: 'value' }] }),
        },
        {
          type: 'mcp_call',
          name: 'query-datasource',
          arguments: JSON.stringify({ datasourceLuid: 'ds-1', query: 'bounded' }),
          output: JSON.stringify({ rows: [] }),
        },
        { type: 'mcp_call', name: 'query-datasource', error: { type: 'tool_error' } },
      ],
      'ds-1',
    );

    expect(calls.map(({ sequence, name }) => ({ sequence, name }))).toEqual([
      { sequence: 1, name: 'get-datasource-metadata' },
      { sequence: 2, name: 'query-datasource' },
      { sequence: 3, name: 'query-datasource' },
    ]);
    expect(calls[0]?.empty).toBe(false);
    expect(calls[1]?.empty).toBe(true);
    expect(calls[2]?.empty).toBeNull();
    expect(calls[1]?.datasourceLuidPresent).toBe(true);
  });

  it('does not invent a row count for unexpected result shapes', () => {
    expect(resultRowCount(JSON.stringify({ rows: [] }))).toBe(0);
    expect(resultRowCount(JSON.stringify({ unexpected: 'shape' }))).toBeNull();
    expect(resultRowCount('malformed')).toBeNull();
  });
});
