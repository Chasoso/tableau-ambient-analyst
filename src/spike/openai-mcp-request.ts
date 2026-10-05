export const tableauMcpServerUrl = 'https://mcp.tableau.com';
export const tableauMcpServerLabel = 'tableau-hosted';
export const tableauMcpAllowedTools = [
  'list-datasources',
  'get-datasource-metadata',
  'query-datasource',
] as const;

// Experimental Hosted feasibility configuration only. Issue #17's selected
// evaluation path is the local PAT-authenticated stdio bridge; this remote
// configuration is retained for historical reproducibility and is not a
// production approval or authentication recommendation.

export const structuredOutcomeTextFormat = {
  type: 'json_schema',
  name: 'tableau_evaluation_outcome',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outcome: {
        type: 'string',
        enum: ['supported', 'revised', 'rejected', 'insufficient-evidence'],
      },
      summary: { type: 'string' },
      evidence_complete: { type: 'boolean' },
      missing_evidence: { type: 'array', items: { type: 'string' } },
      hypothesis_state: {
        type: 'string',
        enum: ['maintained', 'revised', 'rejected', 'not-applicable'],
      },
      stop_reason: {
        type: 'string',
        enum: [
          'sufficient-evidence',
          'insufficient-evidence',
          'tool-error',
          'limit-reached',
          'other',
        ],
      },
    },
    required: [
      'outcome',
      'summary',
      'evidence_complete',
      'missing_evidence',
      'hypothesis_state',
      'stop_reason',
    ],
  },
} as const;

export type OpenAiMcpToolConfiguration = {
  type: 'mcp';
  server_label: typeof tableauMcpServerLabel;
  server_url: typeof tableauMcpServerUrl;
  authorization: string;
  allowed_tools: readonly string[];
  require_approval: 'never';
};

export function buildOpenAiMcpToolConfiguration(accessToken: string): OpenAiMcpToolConfiguration {
  if (accessToken.trim().length === 0) {
    throw new Error('Missing Tableau MCP authorization token');
  }
  return {
    type: 'mcp',
    server_label: tableauMcpServerLabel,
    server_url: tableauMcpServerUrl,
    authorization: accessToken,
    allowed_tools: [...tableauMcpAllowedTools],
    require_approval: 'never',
  };
}

export function redactOpenAiMcpToolConfiguration(
  configuration: OpenAiMcpToolConfiguration,
): Omit<OpenAiMcpToolConfiguration, 'authorization'> & { authorization: '<redacted>' } {
  return { ...configuration, authorization: '<redacted>' };
}
