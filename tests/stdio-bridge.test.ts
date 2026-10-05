import { describe, expect, it } from 'vitest';

import {
  mapOpenAiToolToMcp,
  openAiStdioTools,
  summarizeStdioToolArguments,
  stdioMaxToolCalls,
  stdioDatasourceLuid,
  validateStdioToolArguments,
} from '../src/spike/stdio-bridge-policy.js';
import { buildTableauMcpChildEnvironment } from '../src/spike/tableau-stdio-bridge.js';
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
});
