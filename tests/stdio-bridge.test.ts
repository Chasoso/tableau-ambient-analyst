import { describe, expect, it } from 'vitest';

import {
  mapOpenAiToolToMcp,
  openAiStdioTools,
  summarizeStdioToolArguments,
  stdioMaxToolCalls,
  stdioDatasourceLuid,
  validateStdioToolArguments,
} from '../src/spike/stdio-bridge-policy.js';
import {
  approvedDatasourceName,
  buildTableauMcpChildEnvironment,
  filterApprovedDatasourceListResult,
  normalizeMcpResultForModel,
  resolveTableauMcpLocalExecutable,
} from '../src/spike/tableau-stdio-bridge.js';
import {
  buildFunctionCallOutput,
  canContinueWithToolCalls,
} from '../src/spike/openai-stdio-loop.js';

describe('application-managed stdio bridge policy', () => {
  it('maps only the approved OpenAI tools', () => {
    expect(mapOpenAiToolToMcp('list_datasources')).toBe('list-datasources');
    expect(mapOpenAiToolToMcp('get_datasource_metadata')).toBe('get-datasource-metadata');
    expect(mapOpenAiToolToMcp('query_datasource')).toBe('query-datasource');
    expect(mapOpenAiToolToMcp('publish_workbook')).toBeNull();
    expect(openAiStdioTools).toHaveLength(3);
  });

  it('rejects a datasource outside the fixed boundary', () => {
    expect(
      validateStdioToolArguments('get_datasource_metadata', { datasourceLuid: 'other' }),
    ).toEqual({ ok: false, error: 'Datasource is outside the approved boundary.' });
  });

  it('accepts the actual Tableau MCP aggregate field shape', () => {
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ fieldCaption: 'Daily View Count' }] },
        limit: 100,
      }),
    ).toEqual({ ok: false, error: 'Query must be aggregation-first.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
        limit: 100,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: {
          fields: [
            { fieldCaption: 'Month' },
            { fieldCaption: 'Daily View Count', function: 'SUM' },
          ],
        },
        limit: 100,
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects malformed actual MCP query fields and unsafe limits', () => {
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ function: 'SUM' }] },
        limit: 100,
      }),
    ).toEqual({ ok: false, error: 'Query fields must follow the Tableau MCP field shape.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
        limit: 101,
      }),
    ).toEqual({ ok: false, error: 'Query row limit must be an integer between 1 and 100.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: {
          fields: [
            { fieldCaption: 'Workbook Title', sortPriority: 1 },
            { fieldCaption: 'Daily View Count', function: 'SUM', sortPriority: 1 },
          ],
        },
        limit: 1,
      }),
    ).toEqual({ ok: false, error: 'Query sort priorities must be unique positive integers.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: {
          fields: [
            { fieldCaption: 'Workbook Title' },
            {
              fieldCaption: 'Daily View Count',
              function: 'SUM',
              sortDirection: 'DESC',
              sortPriority: 1,
            },
          ],
        },
        limit: 1,
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects malformed filters and parameters without rewriting valid queries', () => {
    const base = {
      datasourceLuid: stdioDatasourceLuid,
      query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
      limit: 100,
    };
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { ...base.query, filters: ['bad'] },
      }),
    ).toEqual({
      ok: false,
      error: 'Query filters must be an array of objects.',
    });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { ...base.query, filters: [{ field: { fieldCaption: 'Metric Date Time (JST)' } }] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { ...base.query, parameters: [{ parameterCaption: 'x' }] },
      }),
    ).toEqual({
      ok: false,
      error: 'Query parameters must follow the Tableau MCP parameter shape.',
    });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { fields: [{ fieldCaption: 'Daily View Count', calculation: 'SUM([x])' }] },
      }),
    ).toEqual({
      ok: false,
      error: 'Query calculations are not allowed by the read-only policy.',
    });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: {
          ...base.query,
          filters: [{ field: { fieldCaption: 'Metric Date Time (JST)' }, unsafeCode: 'x' }],
        },
      }),
    ).toEqual({
      ok: false,
      error: 'Query filter contains unsupported properties.',
    });
  });

  it('fails closed for unknown or ambiguous query schema properties', () => {
    const base = {
      datasourceLuid: stdioDatasourceLuid,
      query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
      limit: 100,
    };
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { ...base.query, unexpectedQueryProperty: true },
      }),
    ).toEqual({ ok: false, error: 'Query contains unsupported properties.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: { fields: [{ ...base.query.fields[0], unexpectedFieldProperty: true }] },
      }),
    ).toEqual({ ok: false, error: 'Query field contains unsupported properties.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: {
          ...base.query,
          filters: [{ field: { fieldCaption: 'Metric Date Time (JST)', unexpected: true } }],
        },
      }),
    ).toEqual({ ok: false, error: 'Query filter field must follow the Tableau MCP field shape.' });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: {
          ...base.query,
          parameters: [{ parameterCaption: 'Date', value: '2026-01-01', unexpected: true }],
        },
      }),
    ).toEqual({
      ok: false,
      error: 'Query parameters must follow the Tableau MCP parameter shape.',
    });
    expect(
      validateStdioToolArguments('query_datasource', {
        ...base,
        query: {
          fields: [
            { fieldCaption: 'Daily View Count', function: 'SUM', calculation: 'SUM([Views])' },
          ],
        },
      }),
    ).toEqual({ ok: false, error: 'Query calculations are not allowed by the read-only policy.' });
  });

  it('accepts only supported filter and parameter shapes', () => {
    expect(
      validateStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: {
          fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }],
          filters: [
            {
              field: { fieldCaption: 'Metric Date Time (JST)' },
              filterType: 'quantitative',
              minDate: '2025-04-01',
              maxDate: '2026-10-01',
            },
          ],
          parameters: [{ parameterCaption: 'Example', value: true }],
        },
        limit: 100,
      }),
    ).toMatchObject({ ok: true });
  });

  it('summarizes query argument shape without exposing field values', () => {
    expect(
      summarizeStdioToolArguments('query_datasource', {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
        limit: 100,
      }),
    ).toEqual({
      tool: 'query_datasource',
      topLevelKeys: ['datasourceLuid', 'limit', 'query'],
      datasourceLuidPresent: true,
      queryKeys: ['fields'],
      fieldCount: 1,
      fieldKinds: ['function'],
      hasAggregationFunction: true,
      limit: 100,
    });
  });

  it('converts a tool result into a Responses function_call_output', () => {
    expect(buildFunctionCallOutput('call_1', { rows: [{ total: 3 }] })).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"rows":[{"total":3}]}',
    });
  });

  it('exposes only the approved datasource from list-datasources results', () => {
    const filtered = filterApprovedDatasourceListResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: [
              { luid: 'unrelated-luid', name: 'Unrelated datasource' },
              { luid: stdioDatasourceLuid, name: approvedDatasourceName },
            ],
          }),
        },
      ],
      isError: false,
    });

    expect(filtered).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: [{ datasourceLuid: stdioDatasourceLuid, name: approvedDatasourceName }],
          }),
        },
      ],
      isError: false,
    });
    expect(JSON.stringify(filtered)).not.toContain('unrelated-luid');
    expect(JSON.stringify(filtered)).not.toContain('Unrelated datasource');
  });

  it('fails closed when list-datasources does not include the approved datasource', () => {
    expect(() =>
      filterApprovedDatasourceListResult({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ data: [{ luid: 'unrelated-luid', name: 'Other' }] }),
          },
        ],
        isError: false,
      }),
    ).toThrow('APPROVED_DATASOURCE_NOT_FOUND');
  });

  it('accepts an approved-only list-datasources result', () => {
    expect(
      filterApprovedDatasourceListResult({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: [{ datasourceLuid: stdioDatasourceLuid, name: approvedDatasourceName }],
            }),
          },
        ],
        isError: false,
      }),
    ).toMatchObject({ isError: false });
  });

  it('normalizes valid approved MCP evidence before it can reach the model', () => {
    expect(
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ data: [{ 'Daily View Count': 42 }] }),
            },
          ],
          isError: false,
        },
        {
          datasourceLuid: stdioDatasourceLuid,
          query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
          limit: 100,
        },
      ),
    ).toEqual({
      tool: 'query_datasource',
      datasourceLuid: stdioDatasourceLuid,
      rows: [{ 'Daily View Count': 42 }],
    });
    expect(
      normalizeMcpResultForModel(
        'get_datasource_metadata',
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ data: [{ fieldCaption: 'Daily View Count' }] }),
            },
          ],
          isError: false,
        },
        { datasourceLuid: stdioDatasourceLuid },
      ),
    ).toEqual({
      tool: 'get_datasource_metadata',
      datasourceLuid: stdioDatasourceLuid,
      fieldCaptions: ['Daily View Count'],
    });
  });

  it('rejects MCP evidence with the wrong datasource provenance or result shape', () => {
    const queryResult = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ data: [{ 'Daily View Count': 42 }] }),
        },
      ],
      isError: false,
    };
    const queryArguments = {
      datasourceLuid: stdioDatasourceLuid,
      query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
      limit: 100,
    };
    expect(() =>
      normalizeMcpResultForModel('query_datasource', queryResult, {
        ...queryArguments,
        datasourceLuid: 'other',
      }),
    ).toThrow('outside the approved datasource');
    expect(() =>
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [{ type: 'text', text: JSON.stringify({ data: [], unexpected: 'untrusted' }) }],
          isError: false,
        },
        queryArguments,
      ),
    ).toThrow('must be an object with data');
    expect(() =>
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ data: [{ unexpected_column: 42 }] }),
            },
          ],
          isError: false,
        },
        queryArguments,
      ),
    ).toThrow('unexpected field unexpected_column');
  });

  it('returns only a bounded, sanitized envelope for recoverable approved tool errors', () => {
    const rawError = 'Tableau backend rejected the requested filter.';
    const envelope = normalizeMcpResultForModel(
      'query_datasource',
      { content: [{ type: 'text', text: rawError }], isError: true },
      {
        datasourceLuid: stdioDatasourceLuid,
        query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
        limit: 100,
      },
    );
    expect(envelope).toEqual({
      status: 'tool_error',
      category: 'query_error',
      message: 'The Tableau query could not be executed.',
      recoverable: true,
    });
    expect(JSON.stringify(envelope)).not.toContain(rawError);
  });

  it('fails closed for authentication or secret-bearing tool errors', () => {
    const queryArguments = {
      datasourceLuid: stdioDatasourceLuid,
      query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
      limit: 100,
    };
    expect(() =>
      normalizeMcpResultForModel(
        'query_datasource',
        { content: [{ type: 'text', text: '403 permission denied' }], isError: true },
        queryArguments,
      ),
    ).toThrow('authentication, permission, or secret-bearing');
    try {
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [{ type: 'text', text: 'Authorization: Bearer synthetic-secret' }],
          isError: true,
        },
        queryArguments,
      );
      throw new Error('expected secret-bearing tool error to fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('authentication, permission, or secret-bearing');
      expect((error as Error).message).not.toContain('synthetic-secret');
    }
  });

  it('rejects oversized and non-scalar MCP results instead of reusing them as evidence', () => {
    const queryArguments = {
      datasourceLuid: stdioDatasourceLuid,
      query: { fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }] },
      limit: 100,
    };
    expect(() =>
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                data: Array.from({ length: 101 }, () => ({ 'Daily View Count': 1 })),
              }),
            },
          ],
          isError: false,
        },
        queryArguments,
      ),
    ).toThrow('bounded row limit');
    expect(() =>
      normalizeMcpResultForModel(
        'query_datasource',
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ data: [{ 'Daily View Count': { nested: 42 } }] }),
            },
          ],
          isError: false,
        },
        queryArguments,
      ),
    ).toThrow('is not a scalar');
  });

  it('stops at the application tool-call budget', () => {
    expect(canContinueWithToolCalls(stdioMaxToolCalls - 1, 1)).toBe(true);
    expect(canContinueWithToolCalls(stdioMaxToolCalls, 1)).toBe(false);
    expect(canContinueWithToolCalls(stdioMaxToolCalls - 2, 2)).toBe(true);
    expect(canContinueWithToolCalls(stdioMaxToolCalls - 1, 2)).toBe(false);
  });

  it('does not include synthetic PAT data in bridge telemetry', () => {
    const syntheticPat = 'synthetic-pat-value';
    const telemetry = JSON.stringify({ tool: 'query_datasource', resultBytes: 42 });
    expect(telemetry).not.toContain(syntheticPat);
  });

  it('passes only the explicit runtime and Tableau environment to the child', () => {
    const childEnvironment = buildTableauMcpChildEnvironment(
      {
        PATH: '/bin',
        HOME: '/tmp/home',
        OPENAI_API_KEY: 'openai-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        CUSTOM_SECRET: 'custom-secret',
      },
      'synthetic-pat',
    );

    expect(childEnvironment).toMatchObject({
      PATH: '/bin',
      HOME: '/tmp/home',
      SERVER: 'https://10ax.online.tableau.com',
      SITE_NAME: 'chasoso_202603',
      AUTH: 'pat',
      PAT_NAME: 'ambient-analyst-issue17',
      PAT_VALUE: 'synthetic-pat',
      TRANSPORT: 'stdio',
    });
    expect(childEnvironment).not.toHaveProperty('OPENAI_API_KEY');
    expect(childEnvironment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(childEnvironment).not.toHaveProperty('CUSTOM_SECRET');
  });

  it('resolves the exact locally installed Tableau MCP binary without npx', () => {
    expect(resolveTableauMcpLocalExecutable()).toMatch(/@tableau\/mcp-server\/build\/index\.js$/);
    expect(() =>
      resolveTableauMcpLocalExecutable(() => {
        throw new Error('not installed');
      }),
    ).toThrow('TABLEAU_MCP_BINARY_NOT_AVAILABLE');
  });
});
