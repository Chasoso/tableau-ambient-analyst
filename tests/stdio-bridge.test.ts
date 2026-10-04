import { describe, expect, it } from 'vitest';

import {
  mapOpenAiToolToMcp,
  openAiStdioTools,
  summarizeStdioToolArguments,
  stdioDatasourceLuid,
  validateStdioToolArguments,
} from '../src/spike/stdio-bridge-policy.js';
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
    expect(canContinueWithToolCalls(3, 1, 4)).toBe(true);
    expect(canContinueWithToolCalls(4, 1, 4)).toBe(false);
  });

  it('does not include synthetic PAT data in bridge telemetry', () => {
    const syntheticPat = 'synthetic-pat-value';
    const telemetry = JSON.stringify({ tool: 'query_datasource', resultBytes: 42 });
    expect(telemetry).not.toContain(syntheticPat);
  });
});
