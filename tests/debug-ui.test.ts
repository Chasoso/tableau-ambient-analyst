import { describe, expect, it } from 'vitest';
import {
  FixtureAnalysisClient,
  recordMockInterventionEvent,
  scenarioById,
  scenarios,
} from '../src/debug-ui/model.js';

describe('debug UI fixture client', () => {
  it('exposes representative replay outcomes without external services', async () => {
    const client = new FixtureAnalysisClient();
    const results = await Promise.all(scenarios.map((scenario) => client.replay(scenario)));

    expect(results.map(({ status }) => status)).toEqual([
      'completed',
      'insufficient-evidence',
      'ignored',
      'failed',
    ]);
    expect(results[0]?.scenario.intervention?.decision).toBe('INTERVENE');
    expect(results[1]?.scenario.intervention?.decision).toBe('HOLD');
    expect(results[3]?.scenario.error).toContain('FIXTURE_INVALID');
  });

  it('keeps scenario lookup deterministic and safely defaults unknown ids', () => {
    expect(scenarioById('ignored').id).toBe('ignored');
    expect(scenarioById('missing').id).toBe(scenarios[0]?.id);
  });

  it('records the mock intervention event through the reusable boundary', async () => {
    const state = await new FixtureAnalysisClient().replay(scenarioById('verified-intervention'));
    recordMockInterventionEvent(state);
    expect(state.audit.at(-1)).toBe('mock.intervention.details-opened');
  });
});
