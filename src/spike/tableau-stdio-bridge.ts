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
// This child receives PAT_VALUE. Keep its package exact-version pinned and
// lockfile-resolved; changing it requires explicit review and revalidation.
const tableauMcpPackageVersion = '4.13.3';
const tableauMcpArgs = ['-y', `@tableau/mcp-server@${tableauMcpPackageVersion}`];
const inheritedRuntimeEnvironmentKeys = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR'] as const;
const aggregationFunctions = new Set([
  'SUM',
  'AVG',
  'MEDIAN',
  'COUNT',
  'COUNTD',
  'MIN',
  'MAX',
  'STDEV',
  'VAR',
  'COLLECT',
  'AGG',
]);
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
  hasAggregateEvidence: boolean;
  hasWorkbookLevelEvidence: boolean;
  hasFixtureRankingContract: boolean;
};

type ScalarEvidenceValue = string | number | boolean | null;

export type ModelVisibleMcpEvidence =
  | {
      tool: 'list_datasources';
      datasourceLuid: typeof stdioDatasourceLuid;
      datasources: Array<{
        datasourceLuid: typeof stdioDatasourceLuid;
        name: typeof approvedDatasourceName;
      }>;
    }
  | {
      tool: 'get_datasource_metadata';
      datasourceLuid: typeof stdioDatasourceLuid;
      fieldCaptions: string[];
    }
  | {
      tool: 'query_datasource';
      datasourceLuid: typeof stdioDatasourceLuid;
      rows: Array<Record<string, ScalarEvidenceValue>>;
    }
  | {
      status: 'tool_error';
      category: 'query_error' | 'tool_error';
      message: string;
      recoverable: true;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultRejection(reason: string): never {
  throw new Error(`MCP_RESULT_REJECTED: ${reason}`);
}

function errorText(result: CallToolResult): string {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    resultRejection('tool error has no text payload');
  }
  const text = result.content
    .map((item) => (item.type === 'text' && typeof item.text === 'string' ? item.text : null))
    .filter((item): item is string => item !== null)
    .join('\n');
  if (text.length === 0 || text.length > 8_000) {
    resultRejection('tool error has an invalid text payload');
  }
  return text;
}

function normalizeRecoverableToolError(
  openAiTool: string,
  result: CallToolResult,
): Extract<ModelVisibleMcpEvidence, { status: 'tool_error' }> {
  const rawError = errorText(result);
  if (
    /\bauth(?:entication|orization)?\b|\bunauthori[sz]ed\b|\bforbidden\b|\bpermission\b|\bcredential\b|\boauth\b|\btoken\b|\bbearer\b|\bpat[_ -]?value\b|\bapi[ _-]?key\b|\bsecret\b|\bpassword\b|\b(?:401|403)\b/i.test(
      rawError,
    )
  ) {
    resultRejection('tool error is authentication, permission, or secret-bearing');
  }
  return {
    status: 'tool_error',
    category: openAiTool === 'query_datasource' ? 'query_error' : 'tool_error',
    message:
      openAiTool === 'query_datasource'
        ? 'The Tableau query could not be executed.'
        : 'The approved Tableau tool could not be executed.',
    recoverable: true,
  };
}

function parseSingleJsonDataPayload(result: CallToolResult): unknown {
  if (result.isError) resultRejection('tool returned an error result');
  if (!Array.isArray(result.content) || result.content.length !== 1) {
    resultRejection('expected exactly one text result payload');
  }
  const item = result.content[0];
  if (item?.type !== 'text' || typeof item.text !== 'string') {
    resultRejection('expected a JSON text result payload');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(item.text);
  } catch {
    resultRejection('result payload is not JSON');
  }
  if (
    !isRecord(payload) ||
    !Object.hasOwn(payload, 'data') ||
    Object.keys(payload).some((key) => key !== 'data')
  ) {
    resultRejection('result payload must be an object with data');
  }
  return payload.data;
}

function expectedQueryResultFields(args: Record<string, unknown>): Set<string> {
  const fields = isRecord(args.query) && Array.isArray(args.query.fields) ? args.query.fields : [];
  const expected = new Set<string>();
  for (const field of fields) {
    if (!isRecord(field) || typeof field.fieldCaption !== 'string') continue;
    const caption = field.fieldCaption;
    expected.add(caption);
    if (typeof field.fieldAlias === 'string') expected.add(field.fieldAlias);
    if (typeof field.function === 'string') {
      expected.add(`${field.function}(${caption})`);
      expected.add(`${field.function}([${caption}])`);
    }
  }
  return expected;
}

function normalizeQueryRows(
  data: unknown,
  args: Record<string, unknown>,
): Array<Record<string, ScalarEvidenceValue>> {
  if (!Array.isArray(data)) resultRejection('query result data must be an array');
  if (data.length > 100) resultRejection('query result exceeded the bounded row limit');
  const expectedFields = expectedQueryResultFields(args);
  if (expectedFields.size === 0) resultRejection('query result has no expected fields');
  return data.map((row) => {
    if (!isRecord(row) || Object.keys(row).length === 0) {
      resultRejection('query result rows must be non-empty objects');
    }
    const normalized: Record<string, ScalarEvidenceValue> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!expectedFields.has(key))
        resultRejection(`query result contains unexpected field ${key}`);
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        resultRejection(`query result field ${key} is not a scalar`);
      }
      normalized[key] = value;
    }
    return normalized;
  });
}

function collectMetadataFieldCaptions(value: unknown, captions: Set<string>, depth = 0): void {
  if (depth > 8 || captions.size >= 500) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectMetadataFieldCaptions(item, captions, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ['fieldCaption', 'caption', 'name']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 256) {
      captions.add(candidate);
    }
  }
  Object.values(value).forEach((item) => collectMetadataFieldCaptions(item, captions, depth + 1));
}

/**
 * Converts an MCP result into the only shape that may cross the application to
 * the model. This is a safety boundary, not analysis orchestration: it checks
 * success, fixed provenance, result shape, and bounded scalar evidence.
 */
export function normalizeMcpResultForModel(
  openAiTool: string,
  result: CallToolResult,
  args: Record<string, unknown>,
): ModelVisibleMcpEvidence {
  if (result.isError) return normalizeRecoverableToolError(openAiTool, result);
  const data = parseSingleJsonDataPayload(result);
  if (openAiTool === 'list_datasources') {
    if (!Array.isArray(data) || !data.some(hasApprovedDatasource)) {
      resultRejection('approved datasource is absent');
    }
    return {
      tool: 'list_datasources',
      datasourceLuid: stdioDatasourceLuid,
      datasources: [{ datasourceLuid: stdioDatasourceLuid, name: approvedDatasourceName }],
    };
  }
  if (openAiTool === 'get_datasource_metadata') {
    if (args.datasourceLuid !== stdioDatasourceLuid) {
      resultRejection('metadata result is outside the approved datasource');
    }
    const captions = new Set<string>();
    collectMetadataFieldCaptions(data, captions);
    if (captions.size === 0) resultRejection('metadata result contains no field captions');
    return {
      tool: 'get_datasource_metadata',
      datasourceLuid: stdioDatasourceLuid,
      fieldCaptions: [...captions].sort(),
    };
  }
  if (openAiTool === 'query_datasource') {
    if (args.datasourceLuid !== stdioDatasourceLuid) {
      resultRejection('query result is outside the approved datasource');
    }
    return {
      tool: 'query_datasource',
      datasourceLuid: stdioDatasourceLuid,
      rows: normalizeQueryRows(data, args),
    };
  }
  resultRejection('tool is not approved');
}

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

function queryContractEvidence(args: Record<string, unknown>): {
  hasAggregateEvidence: boolean;
  hasWorkbookLevelEvidence: boolean;
  hasFixtureRankingContract: boolean;
} {
  const query = args.query;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return {
      hasAggregateEvidence: false,
      hasWorkbookLevelEvidence: false,
      hasFixtureRankingContract: false,
    };
  }
  const fields = (query as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) {
    return {
      hasAggregateEvidence: false,
      hasWorkbookLevelEvidence: false,
      hasFixtureRankingContract: false,
    };
  }
  const records = fields.filter(
    (field): field is Record<string, unknown> =>
      typeof field === 'object' && field !== null && !Array.isArray(field),
  );
  const hasWorkbookLevelEvidence = records.some((field) => field.fieldCaption === 'Workbook Title');
  const hasDailyViewCountSum = records.some(
    (field) => field.fieldCaption === 'Daily View Count' && field.function === 'SUM',
  );
  const hasDescendingMetricSort = records.some(
    (field) =>
      field.fieldCaption === 'Daily View Count' &&
      field.function === 'SUM' &&
      field.sortDirection === 'DESC',
  );
  return {
    hasAggregateEvidence: records.some(
      (field) =>
        typeof field.function === 'string' &&
        aggregationFunctions.has(field.function.toUpperCase()),
    ),
    hasWorkbookLevelEvidence,
    hasFixtureRankingContract:
      hasWorkbookLevelEvidence && hasDailyViewCountSum && hasDescendingMetricSort,
  };
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
  ): Promise<{
    result: CallToolResult;
    modelEvidence: ModelVisibleMcpEvidence;
    summary: StdioCallSummary;
  }> {
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
      openAiTool === 'list_datasources' && !mcpResult.isError
        ? filterApprovedDatasourceListResult(mcpResult)
        : mcpResult;
    const bytes = resultBytes(result);
    if (bytes > 200_000) throw new Error('MCP result exceeded the bounded result size.');
    const modelEvidence = normalizeMcpResultForModel(openAiTool, result, validation.arguments);
    const rowCount = result.isError ? null : countRows(result);
    if (rowCount !== null && rowCount > 100) {
      throw new Error('MCP result exceeded the bounded row limit.');
    }
    const firstRow = result.isError ? null : firstDataRow(result);
    const queryEvidence =
      openAiTool === 'query_datasource'
        ? queryContractEvidence(validation.arguments)
        : {
            hasAggregateEvidence: false,
            hasWorkbookLevelEvidence: false,
            hasFixtureRankingContract: false,
          };
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
      modelEvidence,
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
        ...queryEvidence,
      },
    };
  }

  async close(): Promise<void> {
    await this.client.close();
    this.transport = null;
  }
}
