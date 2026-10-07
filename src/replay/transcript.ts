export type TranscriptUtterance = {
  sequence: number;
  speaker: string;
  text: string;
  timestamp?: string;
};

export type TranscriptFixtureFormat = 'json' | 'jsonl';

export class TranscriptFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptFixtureError';
  }
}

const allowedFields = new Set(['sequence', 'speaker', 'text', 'timestamp']);

function assertRecord(value: unknown, location: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TranscriptFixtureError(`${location} must be a JSON object`);
  }
}

function normalizeUtterance(value: unknown, location: string): TranscriptUtterance {
  assertRecord(value, location);

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new TranscriptFixtureError(`${location}.${field} is not a supported field`);
    }
  }

  const sequence = value.sequence;
  const speaker = value.speaker;
  const text = value.text;
  const timestamp = value.timestamp;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TranscriptFixtureError(`${location}.sequence must be a non-negative integer`);
  }
  if (typeof speaker !== 'string' || speaker.trim() === '') {
    throw new TranscriptFixtureError(`${location}.speaker must be a non-empty string`);
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TranscriptFixtureError(`${location}.text must be a non-empty string`);
  }
  if (
    timestamp !== undefined &&
    (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp)))
  ) {
    throw new TranscriptFixtureError(`${location}.timestamp must be a valid date-time string`);
  }

  return timestamp === undefined
    ? { sequence, speaker, text }
    : { sequence, speaker, text, timestamp };
}

function validateSequence(utterances: readonly TranscriptUtterance[]): void {
  const sequences = new Set<number>();
  for (const utterance of utterances) {
    if (sequences.has(utterance.sequence)) {
      throw new TranscriptFixtureError(`sequence ${utterance.sequence} is duplicated`);
    }
    sequences.add(utterance.sequence);
  }
}

function parseJsonFixture(source: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new TranscriptFixtureError(`fixture is not valid JSON: ${detail}`);
  }

  if (!Array.isArray(value)) {
    throw new TranscriptFixtureError('JSON fixture must contain an array of utterances');
  }
  return value;
}

function parseJsonLinesFixture(source: string): unknown[] {
  const values: unknown[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === '') {
      continue;
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid JSON';
      throw new TranscriptFixtureError(`JSONL line ${index + 1} is not valid JSON: ${detail}`);
    }
  }
  return values;
}

function inferFormat(source: string): TranscriptFixtureFormat {
  return source.trimStart().startsWith('[') ? 'json' : 'jsonl';
}

export function parseTranscriptFixture(
  source: string,
  format: TranscriptFixtureFormat = inferFormat(source),
): readonly TranscriptUtterance[] {
  const values = format === 'json' ? parseJsonFixture(source) : parseJsonLinesFixture(source);
  const utterances = values.map((value, index) =>
    normalizeUtterance(value, format === 'json' ? `utterances[${index}]` : `line ${index + 1}`),
  );
  validateSequence(utterances);
  return replayTranscript(utterances);
}

export function replayTranscript(
  utterances: readonly TranscriptUtterance[],
): readonly TranscriptUtterance[] {
  validateSequence(utterances);
  return [...utterances].sort((left, right) => left.sequence - right.sequence);
}
