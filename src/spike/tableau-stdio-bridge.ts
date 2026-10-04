import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

import {
  mapOpenAiToolToMcp,
  stdioDatasourceLuid,
  validateStdioToolArguments,
} from './stdio-bridge-policy.js';
import { readKeychainSecret } from './keychain-secrets.js';

const tableauServer = 'https://10ax.online.tableau.com';
const tableauSiteName = 'chasoso_202603';
const tableauPatName = 'ambient-analyst-issue17';
const tableauPatKeychainService = 'tableau_ambient_analyst_pat_20261005';
const tableauMcpCommand = 'npx';
const tableauMcpArgs = ['-y', '@tableau/mcp-server@latest'];

export type StdioCallSummary = {
  openAiTool: string;
  mcpTool: string;
  datasourceLuid: string | null;
  rowCount: number | null;
  empty: boolean | null;
  resultBytes: number;
  latencyMs: number;
  error: string | null;
};

function countRows(result: CallToolResult): number | null {
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text) as { data?: unknown };
      if (Array.isArray(value.data)) return value.data.length;
    } catch {
      // Non-JSON tool text is still returned to the model as evidence.
    }
  }
  return null;
}

function resultBytes(result: CallToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

export class TableauStdioBridge {
  private readonly client = new Client(
    { name: 'tableau-ambient-analyst-stdio-bridge', version: '0.1.0' },
    { capabilities: {} },
  );

  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    const patValue = readKeychainSecret(tableauPatKeychainService);
    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    this.transport = new StdioClientTransport({
      command: tableauMcpCommand,
      args: tableauMcpArgs,
      env: {
        ...inheritedEnvironment,
        SERVER: tableauServer,
        SITE_NAME: tableauSiteName,
        AUTH: 'pat',
        PAT_NAME: tableauPatName,
        PAT_VALUE: patValue,
        TRANSPORT: 'stdio',
      },
      stderr: 'pipe',
    });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<ListToolsResult> {
    return this.client.listTools();
  }

  async callTool(
    openAiTool: string,
    args: unknown,
  ): Promise<{ result: CallToolResult; summary: StdioCallSummary }> {
    const mcpTool = mapOpenAiToolToMcp(openAiTool);
    if (mcpTool === null) throw new Error('TOOL_NOT_ALLOWED');
    const validation = validateStdioToolArguments(openAiTool, args);
    if (!validation.ok) throw new Error(validation.error);
    const startedAt = Date.now();
    const result = (await this.client.callTool(
      { name: mcpTool, arguments: validation.arguments },
      CallToolResultSchema,
    )) as CallToolResult;
    const bytes = resultBytes(result);
    if (bytes > 200_000) throw new Error('MCP result exceeded the bounded result size.');
    const rowCount = countRows(result);
    return {
      result,
      summary: {
        openAiTool,
        mcpTool,
        datasourceLuid: openAiTool === 'list_datasources' ? null : stdioDatasourceLuid,
        rowCount,
        empty: rowCount === null ? null : rowCount === 0,
        resultBytes: bytes,
        latencyMs: Date.now() - startedAt,
        error: result.isError ? 'MCP tool returned an error.' : null,
      },
    };
  }

  async close(): Promise<void> {
    await this.client.close();
    this.transport = null;
  }
}
