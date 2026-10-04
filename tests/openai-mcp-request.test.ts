import { describe, expect, it } from 'vitest';

import {
  buildOpenAiMcpToolConfiguration,
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

  it.each(['', ' ', '\n', '\t'])('fails closed for missing authorization: %j', (token) => {
    expect(() => buildOpenAiMcpToolConfiguration(token)).toThrow(
      'Missing Tableau MCP authorization token',
    );
  });
});
