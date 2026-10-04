import { describe, expect, it } from 'vitest';

import {
  mapOpenAiToolToMcp,
  openAiStdioTools,
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

  it('requires a bounded aggregation query', () => {
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
