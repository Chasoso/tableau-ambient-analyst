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
import { withOperationTimeout } from './operation-timeout.js';

const tableauServer = 'https://10ax.online.tableau.com';
const tableauSiteName = 'chasoso_202603';
const tableauPatName = 'ambient-analyst-issue17';
const tableauPatKeychainService = 'tableau_ambient_analyst_pat_20261005';
const tableauMcpCommand = 'npx';
const tableauMcpArgs = ['-y', '@tableau/mcp-server@latest'];
const inheritedRuntimeEnvironmentKeys = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR'] as const;
export const approvedDatasourceName = 'Tableau Public Per Day(2025/04-)';

export function buildTableauMcpChildEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
  patValue: string,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of inheritedRuntimeEnvironmentKeys) {
    const value = parentEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    SERVER: tableauServer,
    SITE_NAME: tableauSiteName,
    AUTH: 'pat',
    PAT_NAME: tableauPatName,
    PAT_VALUE: patValue,
    TRANSPORT: 'stdio',
  };
}

export type StdioCallSummary = {
  openAiTool: string;
  mcpTool: string;
  datasourceLuid: string | null;
  rowCount: number | null;
  empty: boolean | null;
  resultBytes: number;
  latencyMs: number;
  error: string | null;
  topWorkbook: string | null;
  topMetric: number | null;
  fixedHypothesisScope: boolean;
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

function hasApprovedDatasource(row: unknown): boolean {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  return record.datasourceLuid === stdioDatasourceLuid || record.luid === stdioDatasourceLuid;
}

/**
 * list-datasources is target verification, not datasource discovery. Return a
 * normalized singleton so unrelated names, LUIDs, and metadata never enter a
 * model-visible function_call_output.
 */
export function filterApprovedDatasourceListResult(result: CallToolResult): CallToolResult {
  const approvedPresent = result.content.some((item) => {
    if (item.type !== 'text') return false;
    try {
      const value = JSON.parse(item.text) as { data?: unknown };
      return Array.isArray(value.data) && value.data.some(hasApprovedDatasource);
    } catch {
      return false;
    }
  });

  if (!approvedPresent) throw new Error('APPROVED_DATASOURCE_NOT_FOUND');

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          data: [{ datasourceLuid: stdioDatasourceLuid, name: approvedDatasourceName }],
        }),
      },
    ],
    isError: false,
  };
}

function firstDataRow(result: CallToolResult): Record<string, unknown> | null {
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text) as { data?: unknown };
      const row = Array.isArray(value.data) ? value.data[0] : null;
      if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
        return row as Record<string, unknown>;
      }
    } catch {
      // Non-JSON tool text is still returned to the model as evidence.
    }
  }
  return null;
}

function hasFixedHypothesisScope(args: Record<string, unknown>): boolean {
  const query = args.query;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return false;
  const filters = (query as Record<string, unknown>).filters;
  if (!Array.isArray(filters)) return false;
  return filters.some(
    (filter) =>
      typeof filter === 'object' &&
      filter !== null &&
      (filter as Record<string, unknown>).minDate === '2025-04-01' &&
      (filter as Record<string, unknown>).maxDate === '2026-10-01',
  );
}

export class TableauStdioBridge {
  private readonly client = new Client(
    { name: 'tableau-ambient-analyst-stdio-bridge', version: '0.1.0' },
    { capabilities: {} },
  );

  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    const patValue = readKeychainSecret(tableauPatKeychainService);
    this.transport = new StdioClientTransport({
      command: tableauMcpCommand,
      args: tableauMcpArgs,
      env: buildTableauMcpChildEnvironment(process.env, patValue),
      stderr: 'pipe',
    });
    await withOperationTimeout(this.client.connect(this.transport), 'MCP initialize');
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
    const mcpResult = (await withOperationTimeout(
      this.client.callTool(
        { name: mcpTool, arguments: validation.arguments },
        CallToolResultSchema,
      ),
      `MCP tool ${mcpTool}`,
    )) as CallToolResult;
    const result =
      openAiTool === 'list_datasources' ? filterApprovedDatasourceListResult(mcpResult) : mcpResult;
    const bytes = resultBytes(result);
    if (bytes > 200_000) throw new Error('MCP result exceeded the bounded result size.');
    const rowCount = countRows(result);
    if (rowCount !== null && rowCount > 100) {
      throw new Error('MCP result exceeded the bounded row limit.');
    }
    const firstRow = firstDataRow(result);
    const topWorkbook =
      typeof firstRow?.['Workbook Title'] === 'string'
        ? firstRow['Workbook Title']
        : typeof firstRow?.workbookTitle === 'string'
          ? firstRow.workbookTitle
          : null;
    const rawMetric = firstRow?.['Daily View Count'] ?? firstRow?.dailyViewCount;
    const topMetric = typeof rawMetric === 'number' ? rawMetric : null;
    return {
      result,
      summary: {
        openAiTool,
        mcpTool,
        datasourceLuid: stdioDatasourceLuid,
        rowCount,
        empty: rowCount === null ? null : rowCount === 0,
        resultBytes: bytes,
        latencyMs: Date.now() - startedAt,
        error: result.isError ? 'MCP tool returned an error.' : null,
        topWorkbook,
        topMetric,
        fixedHypothesisScope:
          openAiTool === 'query_datasource' && hasFixedHypothesisScope(validation.arguments),
      },
    };
  }

  async close(): Promise<void> {
    await this.client.close();
    this.transport = null;
  }
}
