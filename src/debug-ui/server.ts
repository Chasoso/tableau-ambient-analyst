import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FixtureAnalysisClient,
  scenarioById,
  scenarios,
  type AnalysisClient,
  type AnalysisRunEnvelope,
} from './model.js';

const port = Number(process.env.PORT ?? 4173);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../ui');
const browserRoot = dirname(fileURLToPath(import.meta.url));
const maxBodyBytes = 16_384;
const maxStoredRuns = 32;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
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

export function createDebugUiRequestHandler(client: AnalysisClient = new FixtureAnalysisClient()) {
  const runs = new Map<string, AnalysisRunEnvelope>();

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/api/analysis-runs' && request.method === 'POST') {
      try {
        const body = await readJson(request);
        if (!isScenarioRequest(body)) {
          send(response, 400, { error: 'Invalid analysis run request.' });
          return;
        }
        const runResult = await client.replay(scenarioById(body.scenarioId));
        const run: AnalysisRunEnvelope = { runId: createRunId(), ...runResult };
        runs.set(run.runId, run);
        while (runs.size > maxStoredRuns) runs.delete(runs.keys().next().value as string);
        send(response, 200, run);
      } catch {
        send(response, 502, { error: 'Analysis run failed safely.' });
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
      response.end(await readFile(join(root, 'index.html')));
      return;
    }
    response.statusCode = 404;
    response.end('Not found');
  };
}

export function startDebugUiServer(): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void createDebugUiRequestHandler()(request, response);
  });
  server.listen(port, 'localhost', () => {
    console.log(`Ambient Analyst debug UI: http://localhost:${port}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startDebugUiServer();
