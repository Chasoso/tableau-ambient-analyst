import { stdioDatasourceLuid } from './stdio-bridge-policy.js';
import { TableauStdioBridge } from './tableau-stdio-bridge.js';

const expectedTopWorkbook = '#MoM 2024 Week 34 | SNS Popularity in the U.S.';

function textPayload(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (typeof item !== 'object' || item === null) continue;
    const text = (item as { type?: unknown; text?: unknown }).text;
    if (typeof text !== 'string') continue;
    try {
      return JSON.parse(text);
    } catch {
      continue;
    }
  }
  return null;
}

function rows(result: unknown): Record<string, unknown>[] {
  const payload = textPayload(result);
  if (typeof payload !== 'object' || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    : [];
}

function fieldCaptionCandidates(result: unknown): string[] {
  const payload = textPayload(result);
  const captions: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.fieldCaption === 'string') captions.push(record.fieldCaption);
    if (typeof record.caption === 'string') captions.push(record.caption);
    if (typeof record.name === 'string') captions.push(record.name);
    Object.values(record).forEach(visit);
  };
  visit(payload);
  return [...new Set(captions)];
}

async function main(): Promise<void> {
  const bridge = new TableauStdioBridge();
  try {
    await bridge.connect();
    const metadataCall = await bridge.callTool('get_datasource_metadata', {
      datasourceLuid: stdioDatasourceLuid,
    });
    const captions = fieldCaptionCandidates(metadataCall.result);
    const dateCaption = captions.includes('Metric Date Time (JST)')
      ? 'Metric Date Time (JST)'
      : captions.find((caption) => /date|time/i.test(caption));
    if (dateCaption === undefined) {
      throw new Error(`DATE_FIELD_NOT_FOUND: captions=${captions.slice(0, 20).join('|')}`);
    }

    const emptyCall = await bridge.callTool('query_datasource', {
      datasourceLuid: stdioDatasourceLuid,
      query: {
        fields: [{ fieldCaption: 'Daily View Count', function: 'SUM' }],
        filters: [
          {
            field: { fieldCaption: dateCaption },
            filterType: 'QUANTITATIVE_DATE',
            quantitativeFilterType: 'MIN',
            minDate: '2099-01-01',
          },
        ],
      },
      limit: 100,
    });
    const emptyRows = rows(emptyCall.result);
    if (emptyCall.result.isError || emptyRows.length !== 0) {
      throw new Error(`EMPTY_CASE_SETUP_INVALID: rows=${emptyRows.length}`);
    }

    const rankingCall = await bridge.callTool('query_datasource', {
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
      limit: 100,
    });
    const rankingRows = rows(rankingCall.result);
    const topRow = rankingRows[0];
    const topWorkbook = topRow
      ? Object.values(topRow).find((value) => typeof value === 'string')
      : null;
    if (rankingCall.result.isError || topWorkbook !== expectedTopWorkbook) {
      throw new Error(`GROUND_TRUTH_CHANGED_OR_RANKING_INVALID: top=${String(topWorkbook)}`);
    }

    console.log(
      JSON.stringify({
        status: 'STDIO_CASE_SETUP_CHECKS',
        emptyCaseSetup: 'VALID',
        emptyRowCount: emptyRows.length,
        dateField: dateCaption,
        hypothesisGroundTruth: 'PASS',
        rank1: topWorkbook,
      }),
    );
  } finally {
    await bridge.close();
  }
}

main().catch((error: unknown) => {
  console.log(
    JSON.stringify({
      status: 'STDIO_CASE_SETUP_CHECKS',
      result: 'FAIL',
      error: error instanceof Error ? error.message : 'UNKNOWN',
    }),
  );
  process.exitCode = 1;
});
