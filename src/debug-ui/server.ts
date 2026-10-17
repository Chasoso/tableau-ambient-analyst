import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasValidReplayTraceInvariants,
  scenarioById,
  scenarios,
  type AnalysisClient,
  type AnalysisRunEnvelope,
} from './model.js';
import { ApplicationAnalysisClient } from './application.js';
import type { CandidateViewIntent } from './model.js';

const port = Number(process.env.PORT ?? 4173);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../ui');
const browserRoot = dirname(fileURLToPath(import.meta.url));
const maxBodyBytes = 16_384;
const maxStoredRuns = 32;
const maxActiveRuns = 2;
const runTimeoutMs = 3_000;
const browserBootstrapMarker = '<script type="module" src="/debug-ui/browser.js"></script>';

export type DebugUiRequestHandlerOptions = {
  viewActionConfig?: unknown;
};

function readLocalViewActionConfig(): unknown | undefined {
  const configPath = process.env.AMBIENT_ANALYST_VIEW_ACTION_CONFIG_FILE;
  if (!configPath || !isAbsolute(configPath)) return undefined;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function serializeBootstrapConfig(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return serialized
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e')
      .replaceAll('&', '\\u0026')
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029');
  } catch {
    return undefined;
  }
}

function injectLocalViewActionConfig(html: string, config: unknown): string {
  const serialized = serializeBootstrapConfig(config);
  if (!serialized) return html;
  const bootstrap = `<script>globalThis.__ambientAnalystViewAction = ${serialized};</script>`;
  return html.replace(browserBootstrapMarker, `${bootstrap}\n    ${browserBootstrapMarker}`);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (!host) return false;
  let originUrl: URL;
  let hostUrl: URL;
  try {
    originUrl = new URL(origin);
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const normalizedOriginHost = originUrl.hostname.toLowerCase();
  const normalizedRequestHost = hostUrl.hostname.toLowerCase();
  if (
    originUrl.protocol !== 'http:' ||
    !loopbackHosts.has(normalizedOriginHost) ||
    !loopbackHosts.has(normalizedRequestHost) ||
    originUrl.port !== hostUrl.port
  )
    return false;
  return true;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function isScenarioRequest(value: unknown): value is { scenarioId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { scenarioId?: unknown }).scenarioId === 'string' &&
    scenarios.some(({ id }) => id === (value as { scenarioId: string }).scenarioId)
  );
}

function createRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function boundedText(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value.length <= max ? value : fallback;
}

function isCandidateViewIntent(value: unknown): value is CandidateViewIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    candidate.id.length > 200 ||
    typeof candidate.evidenceRef !== 'string' ||
    candidate.evidenceRef.length === 0 ||
    candidate.evidenceRef.length > 200 ||
    typeof candidate.semanticKey !== 'string' ||
    candidate.semanticKey.length === 0 ||
    candidate.semanticKey.length > 200 ||
    !['set-filter', 'set-parameter'].includes(candidate.operation as string) ||
    !['string', 'number', 'boolean'].includes(candidate.valueType as string) ||
    !Array.isArray(candidate.values) ||
    candidate.values.length === 0 ||
    candidate.values.length > 16 ||
    (candidate.operation === 'set-parameter' && candidate.values.length !== 1)
  )
    return false;
  const valueType = candidate.valueType;
  return candidate.values.every(
    (item) =>
      (typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))) &&
      typeof item === valueType,
  );
}

function validClientResult(
  result: Awaited<ReturnType<AnalysisClient['replay']>>,
  requestedId: string,
): boolean {
  if (!['completed', 'failed', 'ignored', 'insufficient-evidence'].includes(result.status))
    return false;
  if (
    !Array.isArray(result.audit) ||
    result.audit.length > 64 ||
    result.audit.some((item) => typeof item !== 'string')
  )
    return false;
  const scenario = result.scenario;
  if (!scenario || scenario.id !== requestedId || !scenarios.some(({ id }) => id === scenario.id))
    return false;
  if (
    !Array.isArray(scenario.questions) ||
    scenario.questions.length > 32 ||
    scenario.questions.some((item) => typeof item !== 'string')
  )
    return false;
  if (!Array.isArray(scenario.evidence) || scenario.evidence.length > 64) return false;
  if (
    !Array.isArray(scenario.stages) ||
    scenario.stages.length > 16 ||
    scenario.stages.some(
      (stage) => !['pending', 'active', 'complete', 'failed', 'skipped'].includes(stage.status),
    )
  )
    return false;
  if (!['VERIFIED', 'INSUFFICIENT', 'NOT_RUN'].includes(scenario.verifier.status)) return false;
  if (
    scenario.intervention !== null &&
    !['HOLD', 'INTERVENE'].includes(scenario.intervention.decision)
  )
    return false;
  if (result.status === 'failed' && !scenario.error) return false;
  if (scenario.error !== undefined && result.status !== 'failed') return false;
  if (result.candidateIntent !== undefined && !isCandidateViewIntent(result.candidateIntent)) {
    return false;
  }
  return hasValidReplayTraceInvariants(result.status, scenario, result.audit);
}

function sanitizeRun(
  runId: string,
  requestedId: string,
  result: Awaited<ReturnType<AnalysisClient['replay']>>,
): AnalysisRunEnvelope {
  const source = result.scenario;
  const scenario = {
    id: requestedId,
    name: boundedText(source.name, 200, 'Analysis run'),
    description: boundedText(source.description, 500, 'Deterministic analysis run.'),
    utterances: source.utterances.slice(0, 100).map((item) => ({
      speaker: boundedText(item.speaker, 100, 'speaker'),
      text: boundedText(item.text, 500, 'utterance unavailable'),
    })),
    trigger: {
      decision: source.trigger.decision === 'ANALYZE' ? ('ANALYZE' as const) : ('IGNORE' as const),
      reason: boundedText(source.trigger.reason, 100, 'trigger-result'),
      ...(source.trigger.claim
        ? { claim: boundedText(source.trigger.claim, 300, 'claim unavailable') }
        : {}),
    },
    questions: source.questions
      .slice(0, 8)
      .map((item) => boundedText(item, 300, 'Bounded analysis question.')),
    evidence: source.evidence.slice(0, 20).map((item, index) => ({
      source: 'local-analysis',
      detail: boundedText(item.detail, 500, 'Evidence detail unavailable.'),
      provenance: boundedText(item.provenance, 100, `evidence-${index + 1}`),
    })),
    verifier: {
      status: ['VERIFIED', 'INSUFFICIENT', 'NOT_RUN'].includes(source.verifier.status)
        ? source.verifier.status
        : 'NOT_RUN',
      detail: boundedText(source.verifier.detail, 500, 'Verification detail unavailable.'),
    },
    stages: source.stages.slice(0, 16).map((item) => ({
      name: boundedText(item.name, 100, 'stage'),
      status: ['pending', 'active', 'complete', 'failed', 'skipped'].includes(item.status)
        ? item.status
        : ('failed' as const),
      detail: boundedText(item.detail, 500, 'Stage detail unavailable.'),
    })),
    intervention:
      source.intervention && ['HOLD', 'INTERVENE'].includes(source.intervention.decision)
        ? {
            decision: source.intervention.decision,
            reason: boundedText(
              source.intervention.reason,
              500,
              'Intervention detail unavailable.',
            ),
          }
        : null,
    ...(result.status === 'failed' ? { error: 'The application flow failed closed.' } : {}),
  };
  const audit = result.audit.slice(0, 64).map((item) => boundedText(item, 200, 'audit.event'));
  return {
    runId,
    status: result.status,
    scenario,
    audit,
    ...(result.candidateIntent ? { viewIntent: { ...result.candidateIntent, runId } } : {}),
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RUN_TIMEOUT')), runTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createDebugUiRequestHandler(
  client: AnalysisClient = new ApplicationAnalysisClient(),
  options: DebugUiRequestHandlerOptions = {},
) {
  const runs = new Map<string, AnalysisRunEnvelope>();
  let activeRuns = 0;
  const viewActionConfig = Object.prototype.hasOwnProperty.call(options, 'viewActionConfig')
    ? options.viewActionConfig
    : readLocalViewActionConfig();

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      response.setHeader('vary', 'Origin');
      if (!isAllowedOrigin(request)) {
        send(response, 403, { error: 'Origin is not allowed.' });
        return;
      }
      const origin = request.headers.origin;
      if (origin) response.setHeader('access-control-allow-origin', origin);
    }
    if (pathname === '/api/analysis-runs' && request.method === 'POST') {
      try {
        const body = await readJson(request);
        if (!isScenarioRequest(body)) {
          send(response, 400, { error: 'Invalid analysis run request.' });
          return;
        }
        if (activeRuns >= maxActiveRuns) {
          send(response, 429, { error: 'Analysis run capacity is temporarily full.' });
          return;
        }
        activeRuns += 1;
        let released = false;
        const release = () => {
          if (!released) {
            released = true;
            activeRuns -= 1;
          }
        };
        const runPromise = Promise.resolve().then(() =>
          client.replay(scenarioById(body.scenarioId)),
        );
        void runPromise.then(release, release);
        const runResult = await withTimeout(runPromise);
        if (!validClientResult(runResult, body.scenarioId)) {
          send(response, 502, { error: 'Analysis run failed safely.' });
          return;
        }
        const run = sanitizeRun(createRunId(), body.scenarioId, runResult);
        runs.set(run.runId, run);
        while (runs.size > maxStoredRuns) runs.delete(runs.keys().next().value as string);
        send(response, 200, run);
      } catch (error) {
        if (
          error instanceof Error &&
          ['INVALID_JSON', 'REQUEST_TOO_LARGE'].includes(error.message)
        ) {
          send(response, 400, { error: 'Invalid analysis run request.' });
        } else {
          send(response, 502, { error: 'Analysis run failed safely.' });
        }
      }
      return;
    }
    const match = pathname.match(/^\/api\/analysis-runs\/([^/]+)$/);
    if (match && request.method === 'GET') {
      const run = runs.get(match[1]!);
      if (!run) send(response, 404, { error: 'Analysis run not found.' });
      else send(response, 200, run);
      return;
    }
    if (pathname.startsWith('/debug-ui/') && pathname.endsWith('.js')) {
      const filename = pathname.slice('/debug-ui/'.length);
      if (filename.includes('/') || filename.includes('\\')) {
        response.statusCode = 404;
        response.end('Not found');
        return;
      }
      response.setHeader('content-type', 'text/javascript; charset=utf-8');
      response.end(await readFile(join(browserRoot, filename)));
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      const html = await readFile(join(root, 'index.html'), 'utf8');
      response.end(
        viewActionConfig === undefined ? html : injectLocalViewActionConfig(html, viewActionConfig),
      );
      return;
    }
    response.statusCode = 404;
    response.end('Not found');
  };
}

export function startDebugUiServer(): ReturnType<typeof createServer> {
  const handler = createDebugUiRequestHandler();
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Ambient Analyst debug UI: http://localhost:${port}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startDebugUiServer();
