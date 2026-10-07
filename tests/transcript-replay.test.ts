import { describe, expect, it } from 'vitest';
import {
  parseTranscriptFixture,
  replayTranscript,
  TranscriptFixtureError,
  type TranscriptUtterance,
} from '../src/replay/transcript.js';

const fixture = [
  { sequence: 2, speaker: 'B', text: 'Second' },
  { sequence: 0, speaker: 'A', text: 'First', timestamp: '2026-01-01T10:00:00Z' },
  { sequence: 1, speaker: 'A', text: 'Between' },
];

describe('transcript replay', () => {
  it('parses JSON and replays utterances in stable sequence order', () => {
    const result = parseTranscriptFixture(JSON.stringify(fixture), 'json');

    expect(result.map(({ sequence, text }) => ({ sequence, text }))).toEqual([
      { sequence: 0, text: 'First' },
      { sequence: 1, text: 'Between' },
      { sequence: 2, text: 'Second' },
    ]);
  });

  it('parses the same fixture as JSONL and produces the same logical sequence', () => {
    const jsonl = fixture.map((utterance) => JSON.stringify(utterance)).join('\n');

    expect(parseTranscriptFixture(jsonl, 'jsonl')).toEqual(
      parseTranscriptFixture(JSON.stringify(fixture)),
    );
  });

  it('rejects malformed JSON and malformed JSONL records with clear errors', () => {
    expect(() => parseTranscriptFixture('{', 'json')).toThrow(TranscriptFixtureError);
    expect(() => parseTranscriptFixture('{"sequence":0}\nnot-json', 'jsonl')).toThrow(
      'JSONL line 2 is not valid JSON',
    );
  });

  it.each([
    ['missing sequence', [{ speaker: 'A', text: 'Hello' }]],
    ['missing speaker', [{ sequence: 0, text: 'Hello' }]],
    ['missing text', [{ sequence: 0, speaker: 'A' }]],
    [
      'duplicate sequence',
      [
        { sequence: 0, speaker: 'A', text: 'One' },
        { sequence: 0, speaker: 'B', text: 'Two' },
      ],
    ],
  ])('rejects %s required fields', (_description, value) => {
    expect(() => parseTranscriptFixture(JSON.stringify(value), 'json')).toThrow(
      TranscriptFixtureError,
    );
  });

  it('rejects unknown fields and invalid timestamps', () => {
    expect(() =>
      parseTranscriptFixture(
        JSON.stringify([{ sequence: 0, speaker: 'A', text: 'Hi', extra: true }]),
      ),
    ).toThrow('extra is not a supported field');
    expect(() =>
      parseTranscriptFixture(
        JSON.stringify([{ sequence: 0, speaker: 'A', text: 'Hi', timestamp: 'soon' }]),
      ),
    ).toThrow('timestamp must be a valid date-time string');
  });

  it('does not mutate input and produces the same result on repeated replay', () => {
    const input: TranscriptUtterance[] = [
      { sequence: 1, speaker: 'B', text: 'Second' },
      { sequence: 0, speaker: 'A', text: 'First' },
    ];
    const first = replayTranscript(input);
    const second = replayTranscript(input);

    expect(input[0]?.sequence).toBe(1);
    expect(first).toEqual(second);
  });
});
