export const stdioDatasourceLuid = '14f3ac6d-1171-4065-baac-c63bdce1470f';
export const stdioMaxToolCalls = 6;

export const stdioToolNames = {
  list_datasources: 'list-datasources',
  get_datasource_metadata: 'get-datasource-metadata',
  query_datasource: 'query-datasource',
} as const;

export type StdioToolName = keyof typeof stdioToolNames;

export type StdioToolArguments = Record<string, unknown>;

const aggregationFunctions = [
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
] as const;

const mcpFieldFunctions = [
  ...aggregationFunctions,
  'YEAR',
  'QUARTER',
  'MONTH',
  'WEEK',
  'DAY',
  'TRUNC_YEAR',
  'TRUNC_QUARTER',
  'TRUNC_MONTH',
  'TRUNC_WEEK',
  'TRUNC_DAY',
  'NONE',
  'UNSPECIFIED',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mapOpenAiToolToMcp(toolName: string): string | null {
  return Object.hasOwn(stdioToolNames, toolName) ? stdioToolNames[toolName as StdioToolName] : null;
}

export function summarizeStdioToolArguments(
  toolName: string,
  argumentsValue: unknown,
): Record<string, unknown> {
  if (!isRecord(argumentsValue)) return { tool: toolName, argumentShape: 'non-object' };
  const summary: Record<string, unknown> = {
    tool: toolName,
    topLevelKeys: Object.keys(argumentsValue).sort(),
    datasourceLuidPresent: typeof argumentsValue.datasourceLuid === 'string',
  };
  if (toolName === 'query_datasource' && isRecord(argumentsValue.query)) {
    const fields = Array.isArray(argumentsValue.query.fields) ? argumentsValue.query.fields : [];
    summary.queryKeys = Object.keys(argumentsValue.query).sort();
    summary.fieldCount = fields.length;
    summary.fieldKinds = fields.map((field) => {
      if (!isRecord(field)) return 'invalid';
      if (typeof field.function === 'string') return 'function';
      if (typeof field.binSize === 'number') return 'bin';
      return 'dimension';
    });
    summary.hasAggregationFunction = fields.some(
      (field) =>
        isRecord(field) &&
        aggregationFunctions.includes(
          String(field.function ?? '').toUpperCase() as (typeof aggregationFunctions)[number],
        ),
    );
    summary.limit = typeof argumentsValue.limit === 'number' ? argumentsValue.limit : null;
  }
  return summary;
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
    if (!isRecord(query)) {
      return { ok: false, error: 'Query must be an object.' };
    }
    const fields = query.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return { ok: false, error: 'Query must declare at least one field.' };
    }

    if (query.filters !== undefined) {
      if (!Array.isArray(query.filters) || query.filters.some((filter) => !isRecord(filter))) {
        return { ok: false, error: 'Query filters must be an array of objects.' };
      }
      for (const filter of query.filters) {
        const allowedFilterKeys = new Set([
          'field',
          'filterType',
          'quantitativeFilterType',
          'minDate',
          'maxDate',
          'minValue',
          'maxValue',
          'values',
          'value',
        ]);
        if (Object.keys(filter).some((key) => !allowedFilterKeys.has(key))) {
          return { ok: false, error: 'Query filter contains unsupported properties.' };
        }
        if (filter.field !== undefined) {
          if (!isRecord(filter.field) || typeof filter.field.fieldCaption !== 'string') {
            return {
              ok: false,
              error: 'Query filter field must follow the Tableau MCP field shape.',
            };
          }
        }
        if (filter.filterType !== undefined && typeof filter.filterType !== 'string') {
          return { ok: false, error: 'Query filterType must be a string.' };
        }
      }
    }
    if (query.parameters !== undefined) {
      if (
        !Array.isArray(query.parameters) ||
        query.parameters.some(
          (parameter) =>
            !isRecord(parameter) ||
            typeof parameter.parameterCaption !== 'string' ||
            !Object.hasOwn(parameter, 'value'),
        )
      ) {
        return {
          ok: false,
          error: 'Query parameters must follow the Tableau MCP parameter shape.',
        };
      }
    }

    const sortPriorities = new Set<number>();
    for (const field of fields) {
      if (!isRecord(field) || typeof field.fieldCaption !== 'string') {
        return { ok: false, error: 'Query fields must follow the Tableau MCP field shape.' };
      }
      if (
        field.sortDirection !== undefined &&
        !['ASC', 'DESC'].includes(String(field.sortDirection))
      ) {
        return { ok: false, error: 'Query sortDirection must be ASC or DESC.' };
      }
      if (field.sortPriority !== undefined) {
        if (
          typeof field.sortPriority !== 'number' ||
          !Number.isInteger(field.sortPriority) ||
          field.sortPriority < 1 ||
          sortPriorities.has(field.sortPriority)
        ) {
          return { ok: false, error: 'Query sort priorities must be unique positive integers.' };
        }
        sortPriorities.add(field.sortPriority);
      }
      if (field.function !== undefined) {
        const functionName = String(field.function).toUpperCase();
        if (!mcpFieldFunctions.includes(functionName as (typeof mcpFieldFunctions)[number])) {
          return { ok: false, error: 'Query field function is not supported by Tableau MCP.' };
        }
      } else if (field.calculation !== undefined) {
        return { ok: false, error: 'Query calculations are not allowed by the read-only policy.' };
      } else if (field.binSize !== undefined) {
        if (typeof field.binSize !== 'number' || field.binSize <= 0) {
          return { ok: false, error: 'Query binSize must be greater than zero.' };
        }
      }
    }

    const hasAggregation = fields.some(
      (field) =>
        isRecord(field) &&
        aggregationFunctions.includes(
          String(field.function ?? '').toUpperCase() as (typeof aggregationFunctions)[number],
        ),
    );
    if (!hasAggregation) return { ok: false, error: 'Query must be aggregation-first.' };
  }
  return { ok: true, arguments: args };
}

const fieldProperties = {
  fieldCaption: { type: 'string' },
  fieldAlias: { type: 'string' },
  maxDecimalPlaces: { type: 'integer', minimum: 0 },
  sortDirection: { type: 'string', enum: ['ASC', 'DESC'] },
  sortPriority: { type: 'integer', exclusiveMinimum: 0 },
} as const;

const queryFieldSchema = {
  anyOf: [
    {
      type: 'object',
      properties: fieldProperties,
      required: ['fieldCaption'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        ...fieldProperties,
        function: { type: 'string', enum: mcpFieldFunctions },
      },
      required: ['fieldCaption', 'function'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { ...fieldProperties, binSize: { type: 'number', exclusiveMinimum: 0 } },
      required: ['fieldCaption', 'binSize'],
      additionalProperties: false,
    },
  ],
} as const;

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
      'Run one bounded, read-only, aggregation-first query against the approved Tableau datasource. For rankings, group by a dimension and sort the aggregated measure descending with unique sortPriority values.',
    parameters: {
      type: 'object',
      properties: {
        datasourceLuid: { type: 'string' },
        query: {
          type: 'object',
          properties: {
            fields: { type: 'array', items: queryFieldSchema },
            // Tableau MCP owns the detailed filter grammar. The bridge forwards it
            // unchanged after validating the fixed datasource and bounded limit.
            filters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'object',
                    properties: { fieldCaption: { type: 'string' } },
                    required: ['fieldCaption'],
                    additionalProperties: false,
                  },
                  filterType: { type: 'string' },
                  quantitativeFilterType: { type: 'string' },
                  minDate: { type: 'string' },
                  maxDate: { type: 'string' },
                  minValue: { type: 'number' },
                  maxValue: { type: 'number' },
                  values: {
                    type: 'array',
                    items: { type: ['string', 'number', 'boolean', 'null'] },
                  },
                  value: { type: ['string', 'number', 'boolean', 'null'] },
                },
                additionalProperties: false,
              },
            },
            parameters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  parameterCaption: { type: 'string' },
                  value: { type: ['number', 'string', 'boolean', 'null'] },
                },
                required: ['parameterCaption', 'value'],
                additionalProperties: false,
              },
            },
          },
          required: ['fields'],
          additionalProperties: false,
        },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['datasourceLuid', 'query', 'limit'],
      additionalProperties: false,
    },
    strict: false,
  },
] as const;
