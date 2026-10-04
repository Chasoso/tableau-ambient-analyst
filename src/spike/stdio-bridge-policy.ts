export const stdioDatasourceLuid = '14f3ac6d-1171-4065-baac-c63bdce1470f';

export const stdioToolNames = {
  list_datasources: 'list-datasources',
  get_datasource_metadata: 'get-datasource-metadata',
  query_datasource: 'query-datasource',
} as const;

export type StdioToolName = keyof typeof stdioToolNames;

export type StdioToolArguments = Record<string, unknown>;

export function mapOpenAiToolToMcp(toolName: string): string | null {
  return Object.hasOwn(stdioToolNames, toolName) ? stdioToolNames[toolName as StdioToolName] : null;
}

export function validateStdioToolArguments(
  toolName: string,
  argumentsValue: unknown,
): { ok: true; arguments: StdioToolArguments } | { ok: false; error: string } {
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    return { ok: false, error: 'Tool arguments must be an object.' };
  }
  const args = argumentsValue as StdioToolArguments;
  if (toolName === 'list_datasources') return { ok: true, arguments: args };
  if (toolName === 'get_datasource_metadata' || toolName === 'query_datasource') {
    if (args.datasourceLuid !== stdioDatasourceLuid) {
      return { ok: false, error: 'Datasource is outside the approved boundary.' };
    }
  }
  if (toolName === 'query_datasource') {
    const limit = args.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, error: 'Query row limit must be an integer between 1 and 100.' };
    }
    const query = args.query;
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
      return { ok: false, error: 'Query must be an object.' };
    }
    const fields = (query as { fields?: unknown }).fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return { ok: false, error: 'Query must declare at least one aggregation field.' };
    }
    const hasAggregation = fields.some(
      (field) =>
        typeof field === 'object' &&
        field !== null &&
        ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTD'].includes(
          String((field as { function?: unknown }).function ?? '').toUpperCase(),
        ),
    );
    if (!hasAggregation) return { ok: false, error: 'Query must be aggregation-first.' };
  }
  return { ok: true, arguments: args };
}

export const openAiStdioTools = [
  {
    type: 'function',
    name: 'list_datasources',
    description: 'List datasources only to verify the approved Tableau datasource is visible.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_datasource_metadata',
    description: 'Get metadata for the single approved Tableau datasource.',
    parameters: {
      type: 'object',
      properties: { datasourceLuid: { type: 'string' } },
      required: ['datasourceLuid'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'query_datasource',
    description:
      'Run one bounded, read-only, aggregation-first query against the approved Tableau datasource.',
    parameters: {
      type: 'object',
      properties: {
        datasourceLuid: { type: 'string' },
        query: { type: 'object', additionalProperties: true },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['datasourceLuid', 'query', 'limit'],
      additionalProperties: false,
    },
    strict: false,
  },
] as const;
