import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebugUiRequestHandler } from '../src/debug-ui/server.js';
import {
  FixtureAnalysisClient,
  HttpAnalysisClient,
  scenarioById,
  type AnalysisClient,
} from '../src/debug-ui/model.js';
import {
  ApplicationAnalysisClient,
  deterministicDependencies,
} from '../src/debug-ui/application.js';

async function withServer(client?: AnalysisClient) {
  const server = createServer(createDebugUiRequestHandler(client));
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return { server, base: `http://localhost:${address.port}` };
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('debug UI analysis API', () => {
  it('runs a bounded scenario, returns the trace, and supports refresh', async () => {
    const { server, base } = await withServer();
    try {
      const created = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      expect(created.status).toBe(200);
      const run = (await created.json()) as { runId: string; status: string; audit: string[] };
      expect(run.status).toBe('completed');
      expect(run.audit).toContain('analysis-contract-created');
      const refreshed = await fetch(`${base}/api/analysis-runs/${run.runId}`);
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toEqual(run);
    } finally {
      await closeServer(server);
    }
  });

  it.each(['ignored', 'hold-insufficient', 'failed'])(
    'preserves the %s outcome',
    async (scenarioId) => {
      const { server, base } = await withServer(new FixtureAnalysisClient());
      try {
        const response = await fetch(`${base}/api/analysis-runs`, {
          method: 'POST',
          body: JSON.stringify({ scenarioId }),
        });
        expect(response.status).toBe(200);
        expect((await response.json()).scenario.id).toBe(scenarioId);
      } finally {
        await closeServer(server);
      }
    },
  );

  it('fails closed for malformed input and runner failure without exposing details', async () => {
    const failingClient: AnalysisClient = {
      replay: async () => {
        throw new Error('secret');
      },
    };
    const { server, base } = await withServer(failingClient);
    try {
      const malformed = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'unknown', secret: 'do-not-echo' }),
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain('secret');
      const failed = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(failed.status).toBe(502);
      expect(await failed.text()).not.toContain('secret');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects cross-origin API requests while allowing the same local origin', async () => {
    const { server, base } = await withServer();
    try {
      const blocked = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(blocked.status).toBe(403);
      expect(await blocked.text()).not.toContain('untrusted.example');

      const allowed = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(base);
    } finally {
      await closeServer(server);
    }
  });

  it('sanitizes replaceable client data and bounds hanging runs', async () => {
    const unsafeClient: AnalysisClient = {
      replay: async (scenario) => ({
        status: 'completed',
        scenario: {
          ...scenario,
          evidence: [
            { source: 'secret-provider-token', detail: 'x'.repeat(10_000), provenance: 'secret' },
          ],
          audit: ['secret-audit'],
        },
        audit: ['secret-audit'],
      }),
    };
    const unsafe = await withServer(unsafeClient);
    try {
      const response = await fetch(`${unsafe.base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      const body = await response.json();
      expect(body.scenario.evidence[0].source).toBe('local-analysis');
      expect(body.scenario.evidence[0].detail).toBe('Evidence detail unavailable.');
      expect(body.scenario.utterances).toEqual(scenarioById('ignored').utterances);
    } finally {
      await closeServer(unsafe.server);
    }

    const timeoutClient: AnalysisClient = { replay: () => new Promise(() => {}) };
    const timed = await withServer(timeoutClient);
    try {
      const response = await fetch(`${timed.base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(response.status).toBe(502);
    } finally {
      await closeServer(timed.server);
    }
  });

  it('fails closed when the real replay boundary receives malformed tool data', async () => {
    const malformed = new ApplicationAnalysisClient((scenarioId) => {
      const dependencies = deterministicDependencies(scenarioId);
      return {
        ...dependencies,
        tools: {
          ...dependencies.tools,
          callTool: async () => ({
            modelEvidence: null as never,
            summary: dependencies.tools.callTool
              ? await dependencies.tools
                  .callTool('query_datasource', {})
                  .then(({ summary }) => summary)
              : (null as never),
          }),
        },
      };
    });
    const { server, base } = await withServer(malformed);
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('failed');
      expect(
        body.scenario.stages.find((stage: { name: string }) => stage.name === 'Analysis').status,
      ).toBe('failed');
    } finally {
      await closeServer(server);
    }
  });

  it('fails closed when the real replay boundary receives malformed provider output', async () => {
    const malformed = new ApplicationAnalysisClient((scenarioId) => {
      const dependencies = deterministicDependencies(scenarioId);
      return {
        ...dependencies,
        model: {
          respond: async () => ({
            status: 'completed',
            output: [{ type: 'message', content: [] }],
          }),
        },
      };
    });
    const { server, base } = await withServer(malformed);
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('failed');
      expect(JSON.stringify(body)).not.toContain('provider');
    } finally {
      await closeServer(server);
    }
  });
});

describe('HttpAnalysisClient response boundary', () => {
  it.each([
    [
      'missing utterances',
      (value: Record<string, unknown>) =>
        delete (value.scenario as Record<string, unknown>).utterances,
    ],
    [
      'malformed trigger',
      (value: Record<string, unknown>) =>
        (((value.scenario as Record<string, unknown>).trigger as Record<string, unknown>).decision =
          'UNSAFE'),
    ],
    [
      'malformed stage detail',
      (value: Record<string, unknown>) =>
        ((
          ((value.scenario as Record<string, unknown>).stages as unknown[])[0] as Record<
            string,
            unknown
          >
        ).detail = 42),
    ],
    [
      'malformed intervention',
      (value: Record<string, unknown>) =>
        ((
          (value.scenario as Record<string, unknown>).intervention as Record<string, unknown>
        ).reason = 42),
    ],
    [
      'malformed error',
      (value: Record<string, unknown>) => ((value.scenario as Record<string, unknown>).error = 42),
    ],
  ])('fails closed for %s', async (_label, mutate) => {
    const scenario = scenarioById('verified-intervention');
    const payload: Record<string, unknown> = {
      runId: 'run-test',
      status: 'completed',
      scenario: structuredClone(scenario),
      audit: ['replay.started'],
    };
    mutate(payload);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    await expect(new HttpAnalysisClient().replay(scenario)).rejects.toThrow(
      'ANALYSIS_RUN_RESPONSE_INVALID',
    );
  });
});
