import { describe, expect, it } from 'vitest';

import {
  buildOpenAiMcpToolConfiguration,
  structuredOutcomeTextFormat,
  redactOpenAiMcpToolConfiguration,
  tableauMcpAllowedTools,
  tableauMcpServerLabel,
  tableauMcpServerUrl,
} from '../src/spike/openai-mcp-request.js';

describe('OpenAI remote MCP request construction', () => {
  it.each([
    ['preflight', 'token-preflight'],
    ['case-1', 'token-case-1'],
    ['case-2', 'token-case-2'],
    ['case-3', 'token-case-3'],
    ['case-4', 'token-case-4'],
  ])('builds a complete %s configuration', (_purpose, token) => {
    const tool = buildOpenAiMcpToolConfiguration(token);

    expect(tool).toEqual({
      type: 'mcp',
      server_label: tableauMcpServerLabel,
      server_url: tableauMcpServerUrl,
      authorization: token,
      allowed_tools: [...tableauMcpAllowedTools],
      require_approval: 'never',
    });
  });

  it('uses a replacement token on the next independent request', () => {
    const first = buildOpenAiMcpToolConfiguration('token-a');
    const second = buildOpenAiMcpToolConfiguration('token-b');

    expect(first.authorization).toBe('token-a');
    expect(second.authorization).toBe('token-b');
  });

  it('redacts authorization before configuration is logged', () => {
    const configuration = buildOpenAiMcpToolConfiguration('secret-token');

    expect(redactOpenAiMcpToolConfiguration(configuration)).toEqual({
      ...configuration,
      authorization: '<redacted>',
    });
    expect(JSON.stringify(redactOpenAiMcpToolConfiguration(configuration))).not.toContain(
      'secret-token',
    );
  });

  it('defines the minimal strict structured outcome schema', () => {
    expect(structuredOutcomeTextFormat.type).toBe('json_schema');
    expect(structuredOutcomeTextFormat.strict).toBe(true);
    expect(structuredOutcomeTextFormat.schema.required).toEqual([
      'outcome',
      'summary',
      'evidence_complete',
      'missing_evidence',
      'hypothesis_state',
      'stop_reason',
      'reported_rank_1',
    ]);
    expect(structuredOutcomeTextFormat.schema.additionalProperties).toBe(false);
  });

  it.each(['', ' ', '\n', '\t'])('fails closed for missing authorization: %j', (token) => {
    expect(() => buildOpenAiMcpToolConfiguration(token)).toThrow(
      'Missing Tableau MCP authorization token',
    );
  });
});
