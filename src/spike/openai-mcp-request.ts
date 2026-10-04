export const tableauMcpServerUrl = 'https://mcp.tableau.com';
export const tableauMcpServerLabel = 'tableau-hosted';
export const tableauMcpAllowedTools = [
  'list-datasources',
  'get-datasource-metadata',
  'query-datasource',
] as const;

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
