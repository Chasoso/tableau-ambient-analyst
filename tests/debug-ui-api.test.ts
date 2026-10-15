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

async function withServer(
  client?: AnalysisClient,
  options?: Parameters<typeof createDebugUiRequestHandler>[1],
) {
  const server = createServer(createDebugUiRequestHandler(client, options));
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
  it('injects only an explicit local view-action config and escapes HTML-sensitive values', async () => {
    const { server, base } = await withServer(undefined, {
      viewActionConfig: {
        policy: {
          scope: { dashboard: 'Approved <Dashboard>' },
          filterTargets: [],
          parameterTargets: [],
        },
        proposal: {
          id: 'local-test',
          evidenceRef: 'human-approved-local-test',
          scope: { dashboard: 'Approved <Dashboard>' },
          action: {
            type: 'set-filter',
            target: { kind: 'worksheet-field', worksheet: 'Sheet', field: 'Region' },
            values: ['East'],
          },
        },
      },
    });
    try {
      const response = await fetch(`${base}/`);
      const html = await response.text();
      expect(html).toContain('globalThis.__ambientAnalystViewAction');
      expect(html).toContain('\\u003cDashboard\\u003e');
      expect(html).not.toContain('Approved <Dashboard>');
      expect(html.indexOf('globalThis.__ambientAnalystViewAction')).toBeLessThan(
        html.indexOf('/debug-ui/browser.js'),
      );
    } finally {
      await closeServer(server);
    }
  });

  it('does not inject a live configuration unless one is explicitly supplied', async () => {
    const { server, base } = await withServer();
    try {
      const response = await fetch(`${base}/`);
      expect(await response.text()).not.toContain('globalThis.__ambientAnalystViewAction');
    } finally {
      await closeServer(server);
    }
  });

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

  it('runs hold-insufficient through the application flow and preserves its audit trace', async () => {
    const { server, base } = await withServer();
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'hold-insufficient' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        audit: string[];
      };
      expect(body.status).toBe('insufficient-evidence');
      expect(body.audit).toEqual(
        expect.arrayContaining([
          'trigger-detected',
          'analysis-contract-created',
          'tableau-analysis-started',
          'evidence-collected',
          'verification-insufficient',
          'intervention-hold',
        ]),
      );
    } finally {
      await closeServer(server);
    }
  });

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

  it('fails closed when a replaceable client recommends intervention after failure', async () => {
    const unsafeClient: AnalysisClient = {
      replay: async () => ({
        status: 'failed',
        scenario: {
          ...scenarioById('failed'),
          intervention: { decision: 'INTERVENE' as const, reason: 'unsafe recommendation' },
        },
        audit: ['flow.failed'],
      }),
    };
    const { server, base } = await withServer(unsafeClient);
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'failed' }),
      });
      expect(response.status).toBe(502);
    } finally {
      await closeServer(server);
    }
  });

  it('fails closed when a completed client result suppresses intervention', async () => {
    const unsafeClient: AnalysisClient = {
      replay: async () => ({
        status: 'completed',
        scenario: {
          ...scenarioById('verified-intervention'),
          intervention: { decision: 'HOLD' as const, reason: 'unsafe substitution' },
        },
        audit: ['analysis.completed'],
      }),
    };
    const { server, base } = await withServer(unsafeClient);
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      expect(response.status).toBe(502);
    } finally {
      await closeServer(server);
    }
  });

  it('fails closed when a completed client result fabricates its trace', async () => {
    const unsafeClient: AnalysisClient = {
      replay: async () => ({
        status: 'completed',
        scenario: {
          ...scenarioById('verified-intervention'),
          stages: scenarioById('verified-intervention').stages.map((stage) => ({
            ...stage,
            status: 'skipped' as const,
          })),
        },
        audit: ['replay.started'],
      }),
    };
    const { server, base } = await withServer(unsafeClient);
    try {
      const response = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      expect(response.status).toBe(502);
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

      const attackerControlledHost = await fetch(`${base}/api/analysis-runs`, {
        method: 'POST',
        headers: {
          origin: 'http://evil.example',
          host: 'evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(attackerControlledHost.status).toBe(403);
    } finally {
      await closeServer(server);
    }
  });

  it('sanitizes replaceable client data and bounds hanging runs', async () => {
    const unsafeClient: AnalysisClient = {
      replay: async () => ({
        status: 'completed',
        scenario: {
          ...scenarioById('verified-intervention'),
          evidence: [
            { source: 'secret-provider-token', detail: 'x'.repeat(10_000), provenance: 'secret' },
          ],
          audit: ['secret-audit'],
        },
        audit: [
          'trigger-detected',
          'analysis-contract-created',
          'tableau-analysis-started',
          'evidence-collected',
          'verification-complete',
          'intervention-recommended',
          'secret-audit',
        ],
      }),
    };
    const unsafe = await withServer(unsafeClient);
    try {
      const response = await fetch(`${unsafe.base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'verified-intervention' }),
      });
      const body = await response.json();
      expect(body.scenario.evidence[0].source).toBe('local-analysis');
      expect(body.scenario.evidence[0].detail).toBe('Evidence detail unavailable.');
      expect(body.scenario.utterances).toEqual(scenarioById('verified-intervention').utterances);
    } finally {
      await closeServer(unsafe.server);
    }

    let timeoutCalls = 0;
    const pendingResolvers: Array<(state: Awaited<ReturnType<AnalysisClient['replay']>>) => void> =
      [];
    const timeoutClient: AnalysisClient = {
      replay: (scenario) => {
        timeoutCalls += 1;
        if (timeoutCalls <= 2) {
          return new Promise((resolve) => pendingResolvers.push(resolve));
        }
        return new FixtureAnalysisClient().replay(scenario);
      },
    };
    const timed = await withServer(timeoutClient);
    try {
      const timedOut = await Promise.all(
        [1, 2].map(() =>
          fetch(`${timed.base}/api/analysis-runs`, {
            method: 'POST',
            body: JSON.stringify({ scenarioId: 'ignored' }),
          }),
        ),
      );
      expect(timedOut.map((response) => response.status)).toEqual([502, 502]);
      expect(timeoutCalls).toBe(2);
      const rejected = await fetch(`${timed.base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(rejected.status).toBe(429);
      pendingResolvers[0]!(await new FixtureAnalysisClient().replay(scenarioById('ignored')));
      await Promise.resolve();
      const recovered = await fetch(`${timed.base}/api/analysis-runs`, {
        method: 'POST',
        body: JSON.stringify({ scenarioId: 'ignored' }),
      });
      expect(recovered.status).toBe(200);
      expect(timeoutCalls).toBe(3);
    } finally {
      await closeServer(timed.server);
    }
  }, 10_000);

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
      expect(body.scenario.verifier.status).toBe('NOT_RUN');
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
      expect(body.scenario.verifier.status).toBe('NOT_RUN');
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
    [
      'failed intervention',
      (value: Record<string, unknown>) => {
        value.status = 'failed';
        (value.scenario as Record<string, unknown>).error = 'The application flow failed closed.';
        (
          (value.scenario as Record<string, unknown>).intervention as Record<string, unknown>
        ).decision = 'INTERVENE';
      },
    ],
    [
      'completed hold intervention',
      (value: Record<string, unknown>) => {
        (
          (value.scenario as Record<string, unknown>).intervention as Record<string, unknown>
        ).decision = 'HOLD';
      },
    ],
    [
      'mismatched scenario identity',
      (value: Record<string, unknown>) => {
        value.status = 'ignored';
        value.scenario = structuredClone(scenarioById('ignored'));
      },
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
