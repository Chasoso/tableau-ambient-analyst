import { describe, expect, it } from 'vitest';

import {
  extractFinalAnswer,
  extractStructuredOutcome,
  extractToolCalls,
  resultRowCount,
  summarizeResponseEnvelope,
} from '../src/spike/response-telemetry.js';

const validOutcome = {
  outcome: 'rejected',
  summary: 'The comparison contradicted the initial hypothesis.',
  evidence_complete: true,
  missing_evidence: [],
  hypothesis_state: 'rejected',
  stop_reason: 'sufficient-evidence',
  reported_rank_1: '#MoM 2024 Week 34 | SNS Popularity in the U.S.',
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

  it('classifies a completed MCP response with a final message', () => {
    expect(
      summarizeResponseEnvelope({
        status: 'completed',
        incomplete_details: null,
        max_output_tokens: 256,
        output_text: 'done',
        output: [
          { type: 'mcp_list_tools', status: 'completed' },
          { type: 'mcp_call', status: 'completed' },
          {
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: { output_tokens_details: { reasoning_tokens: 12 } },
      }),
    ).toEqual({
      status: 'completed',
      incompleteReason: null,
      responseErrorPresent: false,
      maxOutputTokens: 256,
      outputItemTypes: ['mcp_list_tools', 'mcp_call', 'message'],
      outputItemStatuses: ['completed', 'completed', 'completed'],
      messagePresent: true,
      outputTextPresent: true,
      topLevelOutputTextPresent: true,
      reasoningTokens: 12,
    });
  });

  it('classifies an incomplete max-token response with no message', () => {
    expect(
      summarizeResponseEnvelope({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        max_output_tokens: 256,
        output: [{ type: 'mcp_call', status: 'completed' }],
        usage: { output_tokens_details: { reasoning_tokens: 256 } },
      }),
    ).toMatchObject({
      status: 'incomplete',
      incompleteReason: 'max_output_tokens',
      maxOutputTokens: 256,
      messagePresent: false,
      outputTextPresent: false,
      reasoningTokens: 256,
    });
  });

  it('distinguishes completed MCP-only output from a parser miss', () => {
    const telemetry = summarizeResponseEnvelope({
      status: 'completed',
      output: [{ type: 'mcp_list_tools', status: 'completed' }],
    });

    expect(telemetry.status).toBe('completed');
    expect(telemetry.messagePresent).toBe(false);
    expect(telemetry.outputTextPresent).toBe(false);
  });
});
