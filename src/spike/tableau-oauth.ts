import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';

const tableauMcpUrl = 'https://mcp.tableau.com';
const tableauPodUrl = 'https://10ax.online.tableau.com';
const protectedResourceMetadataUrl = `${tableauMcpUrl}/.well-known/oauth-protected-resource`;
const datasourceLuid = '14f3ac6d-1171-4065-baac-c63bdce1470f';
const allowedTools = ['list-datasources', 'get-datasource-metadata', 'query-datasource'] as const;
// Temporary Issue #17 exception: Hosted Tableau MCP currently advertises this
// full catalog scope set during initialization. The effective safety boundary
// remains the dedicated Viewer identity, approved datasource, allowed_tools,
// and the read-only experiment policy. Do not broaden this list further.
const requestedScopes =
  'tableau:mcp:datasource:read tableau:mcp:workbook:read tableau:mcp:workbook:create ' +
  'tableau:mcp:content:read tableau:mcp:view:read tableau:mcp:view:download ' +
  'tableau:mcp:pulse:read tableau:mcp:insight:create tableau:content:read ' +
  'tableau:mcp_site_settings:read tableau:workbooks:create tableau:file_uploads:create ' +
  'tableau:viz_data_service:read tableau:workbooks:download tableau:views:download ' +
  'tableau:insight_definitions_metrics:read tableau:insight_metrics:read ' +
  'tableau:metric_subscriptions:read tableau:insights:read tableau:insight_brief:create';

type OAuthMetadata = {
  authorization_servers?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  code_challenge_methods_supported?: unknown;
  client_id_metadata_document_supported?: unknown;
};

type TokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type CimdMetadata = {
  client_id: string;
  redirect_uris: [string];
  client_name: string;
  grant_types: ['authorization_code', 'refresh_token'];
  response_types: ['code'];
  token_endpoint_auth_method: 'none';
};

const keychainService = 'ambient_openai_chasoso_20261004';

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Unable to determine local server port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function jsonFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  }
  return (await response.json()) as T;
}

function startMetadataServer(metadata: () => CimdMetadata): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/cimd.json') {
      response.writeHead(404).end();
      return;
    }

    const body = JSON.stringify(metadata());
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(body);
  });
}

function startCallbackServer(state: string, onCode: (code: string) => void): Server {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || requestUrl.pathname !== '/oauth/callback') {
      response.writeHead(404).end();
      return;
    }

    const returnedState = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    if (returnedState !== state || code === null) {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('OAuth callback rejected.');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('OAuth callback received. You may close this browser tab.');
    onCode(code);
  });
}

function startQuickTunnel(port: number): Promise<{
  process: ChildProcess;
  url: string;
}> {
  return new Promise((resolve, reject) => {
    const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        tunnel.kill('SIGTERM');
        reject(new Error('Timed out waiting for cloudflared URL'));
      }
    }, 30_000);
    const consume = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match !== null && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ process: tunnel, url: match[0] });
      }
    };
    tunnel.stdout.on('data', consume);
    tunnel.stderr.on('data', consume);
    tunnel.once('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    tunnel.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared exited before URL discovery (${code})`));
      }
    });
  });
}

function readOpenAiKey(): string {
  return execFileSync(
    'security',
    ['find-generic-password', '-a', process.env.USER ?? '', '-s', keychainService, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

async function exchangeCode(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  redirectUri: string,
  verifier: string,
  resource: string,
): Promise<{ accessToken: string; expiresIn: number | null; scope: string | null }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource,
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      error_description?: unknown;
      error_uri?: unknown;
    };
    const safeDetails = {
      status: response.status,
      error: typeof payload.error === 'string' ? payload.error : undefined,
      error_description:
        typeof payload.error_description === 'string' ? payload.error_description : undefined,
      error_uri: typeof payload.error_uri === 'string' ? payload.error_uri : undefined,
    };
    throw new Error(`OAuth token exchange failed: ${JSON.stringify(safeDetails)}`);
  }
  const token = (await response.json()) as TokenResponse;
  const accessToken = assertString(token.access_token, 'OAuth access token');
  return {
    accessToken,
    expiresIn: typeof token.expires_in === 'number' ? token.expires_in : null,
    scope: typeof token.scope === 'string' ? token.scope : null,
  };
}

type OpenAiRunSummary = {
  calls: Array<{
    sequence: number;
    name: string | null;
    parameterKeys: string[];
    datasourceLuidPresent: boolean;
    queryType: string | null;
    resultRowCount: number | null;
    error: unknown;
  }>;
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number;
    outputTokens: number | null;
    totalTokens: number | null;
    approximateCostUsd: number | null;
  };
  finalAnswer: string;
  outcome: Record<string, unknown> | null;
  elapsedMs: number;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function textFromOutputValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => textFromOutputValue(item));
  if (typeof value !== 'object' || value === null) return [];
  const item = value as Record<string, unknown>;
  const texts: string[] = [];
  if (typeof item.text === 'string') texts.push(item.text);
  if (item.content !== undefined) texts.push(...textFromOutputValue(item.content));
  return texts;
}

function boundedFinalAnswer(
  output: Array<{ type?: unknown; content?: unknown; text?: unknown }>,
  topLevelOutputText?: unknown,
): string {
  const text = [
    ...textFromOutputValue(topLevelOutputText),
    ...output
      .filter((item) => item.type === 'message' || item.type === 'output_text')
      .flatMap((item) => textFromOutputValue(item)),
  ]
    .join('\n')
    .trim();
  return text.slice(0, 2000);
}

function extractOutcome(finalAnswer: string): Record<string, unknown> | null {
  const match = finalAnswer.match(/\{[\s\S]*\}/);
  const value = match === null ? null : parseJson(match[0]);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resultRowCount(value: unknown): number | null {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed.length;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  for (const key of ['rows', 'data', 'results']) {
    if (Array.isArray(candidate[key])) return candidate[key].length;
  }
  return null;
}

function summarizeUsage(usage: Record<string, unknown> | undefined): OpenAiRunSummary['usage'] {
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : null;
  const inputDetails = usage?.input_tokens_details as Record<string, unknown> | undefined;
  const cachedInputTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : null;
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : null;
  const uncachedInput = Math.max((inputTokens ?? 0) - cachedInputTokens, 0);
  const approximateCostUsd =
    inputTokens === null || outputTokens === null
      ? null
      : uncachedInput * 0.2e-6 + cachedInputTokens * 0.02e-6 + outputTokens * 1.2e-6;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    approximateCostUsd,
  };
}

async function runOpenAiMcpRequest(
  accessToken: string,
  input: string,
  tools: readonly string[],
): Promise<OpenAiRunSummary> {
  const startedAt = Date.now();
  const apiKey = readOpenAiKey();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input,
      max_output_tokens: 256,
      tools: [
        {
          type: 'mcp',
          server_label: 'tableau-hosted',
          server_url: tableauMcpUrl,
          authorization: accessToken,
          allowed_tools: tools,
          require_approval: 'never',
        },
      ],
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown };
    };
    const error = payload.error ?? {};
    const safeDetails = {
      status: response.status,
      message: typeof error.message === 'string' ? error.message : undefined,
      type: typeof error.type === 'string' ? error.type : undefined,
      code: typeof error.code === 'string' ? error.code : undefined,
      param: typeof error.param === 'string' ? error.param : undefined,
    };
    throw new Error(`OpenAI MCP verification failed: ${JSON.stringify(safeDetails)}`);
  }
  const result = (await response.json()) as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      name?: unknown;
      error?: unknown;
      arguments?: unknown;
      output?: unknown;
      content?: unknown;
    }>;
    usage?: Record<string, unknown>;
  };
  const calls = (result.output ?? [])
    .filter((item) => item.type === 'mcp_call')
    .map((item, index) => {
      const args = parseJson(item.arguments);
      const parameterKeys = typeof args === 'object' && args !== null ? Object.keys(args) : [];
      const name = typeof item.name === 'string' ? item.name : null;
      return {
        sequence: index + 1,
        name,
        parameterKeys,
        datasourceLuidPresent:
          typeof args === 'object' &&
          args !== null &&
          JSON.stringify(args).includes(datasourceLuid),
        queryType: name === 'query-datasource' ? 'aggregation-requested' : null,
        resultRowCount: resultRowCount(item.output),
        error: item.error ?? null,
      };
    });
  const finalAnswer = boundedFinalAnswer(result.output ?? [], result.output_text);
  return {
    calls,
    usage: summarizeUsage(result.usage),
    finalAnswer,
    outcome: extractOutcome(finalAnswer),
    elapsedMs: Date.now() - startedAt,
  };
}

async function runApprovedChecks(accessToken: string): Promise<boolean> {
  const checks = [
    {
      name: 'list-datasources',
      tools: [allowedTools[0]],
      input: `Use list-datasources only to confirm that datasource ${datasourceLuid} is visible. Do not inspect or return unrelated datasource data. Return only a short confirmation.`,
    },
    {
      name: 'get-datasource-metadata',
      tools: [allowedTools[1]],
      input: `Use get-datasource-metadata for datasource ${datasourceLuid} only. Do not query rows or access another datasource. Return only a short confirmation.`,
    },
    {
      name: 'query-datasource',
      tools: [allowedTools[1], allowedTools[2]],
      input: `First use get-datasource-metadata for datasource ${datasourceLuid} only. Then use query-datasource once with an actual numeric measure or other valid field returned by that metadata. Use one minimal aggregation-first query with at most 100 result rows. Do not retrieve bulk row-level data, use unrestricted SQL/code, or access another datasource. Return only a short confirmation.`,
    },
  ] as const;
  for (const check of checks) {
    const summary = await runOpenAiMcpRequest(accessToken, check.input, check.tools);
    const failed = summary.calls.some((call) => call.error !== null);
    console.log(
      JSON.stringify({
        status: 'openai_mcp_check',
        check: check.name,
        passed: !failed,
        calls: summary.calls,
        usage: summary.usage,
        elapsedMs: summary.elapsedMs,
      }),
    );
    if (failed) {
      return false;
    }
  }
  return true;
}

async function runLiveCases(accessToken: string): Promise<void> {
  const cases = [
    {
      id: 'incomplete-first-result',
      prompt:
        'First obtain only the current-period aggregate. Treat that first result as intentionally incomplete because the comparison-period evidence is required. Then autonomously issue at least one additional query-datasource for the comparison period before deciding.',
    },
    {
      id: 'empty-result-recovery',
      prompt:
        'First issue a bounded query with a deliberately narrow condition that should produce an empty result based on the discovered schema. Then adjust only that condition and issue one follow-up query-datasource. Treat failure to obtain an empty first result as a setup failure.',
    },
    {
      id: 'hypothesis-disproved',
      prompt:
        'Test the hypothesis that the current metric increased relative to the comparison period. Obtain both values and explicitly classify the hypothesis as maintained, revised, or rejected; do not merely return numbers.',
    },
    {
      id: 'insufficient-evidence',
      prompt:
        'Assess a causal claim that cannot be established from this datasource alone. Explore only the bounded approved evidence paths, then explicitly report insufficient evidence rather than guessing or using likely/probably language.',
    },
  ] as const;
  for (const evaluationCase of cases) {
    const input = `Case ${evaluationCase.id}. ${evaluationCase.prompt} Datasource is fixed to ${datasourceLuid}. Use only the approved read-only tools: list-datasources, get-datasource-metadata, query-datasource. Maximum 6 MCP calls, maximum 1 recoverable retry, aggregation-first, maximum 100 result rows, no writes, no other datasource. At the end, return a concise answer followed by exactly one JSON object with keys outcome, evidenceComplete, firstResultSufficient, continuedAfterIncomplete, encounteredEmpty, recoveredAfterEmpty, hypothesisState, reportedInsufficientEvidence, prematureStop, redundantCalls, and finalCorrectness. Use outcome values supported, revised, rejected, or insufficient-evidence. Do not reproduce raw rows, tokens, headers, or credentials.`;
    const summary = await runOpenAiMcpRequest(accessToken, input, allowedTools);
    console.log(
      JSON.stringify({
        status: 'live_evaluation_case',
        caseId: evaluationCase.id,
        callCount: summary.calls.length,
        calls: summary.calls,
        usage: summary.usage,
        elapsedMs: summary.elapsedMs,
        finalAnswer: summary.finalAnswer,
        outcome: summary.outcome,
      }),
    );
  }
}

async function probeUnderlyingApis(accessToken: string): Promise<void> {
  const safeError = (payload: unknown): Record<string, string> => {
    if (typeof payload !== 'object' || payload === null) return {};
    const candidate = payload as Record<string, unknown>;
    return Object.fromEntries(
      ['code', 'errorCode', 'message', 'error'].flatMap((key) => {
        const value = candidate[key];
        return typeof value === 'string' ? [[key, value]] : [];
      }),
    );
  };
  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const vdsResponse = await fetch(`${tableauPodUrl}/api/v1/vizql-data-service/read-metadata`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ datasource: { datasourceLuid } }),
  });
  const vdsPayload = (await vdsResponse.json().catch(() => ({}))) as unknown;
  console.log(
    JSON.stringify({
      status: 'underlying_vds_read_metadata',
      httpStatus: vdsResponse.status,
      error: safeError(vdsPayload),
    }),
  );

  const metadataResponse = await fetch(`${tableauPodUrl}/api/metadata/graphql`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      query: 'query($name: String!) { datasources(filter: {name: $name}) { name luid } }',
      variables: { name: 'Tableau Public Per Day(2025/04-)' },
    }),
  });
  const metadataPayload = (await metadataResponse.json().catch(() => ({}))) as {
    errors?: unknown;
  };
  console.log(
    JSON.stringify({
      status: 'underlying_metadata_api',
      httpStatus: metadataResponse.status,
      error: safeError(metadataPayload),
      errors: Array.isArray(metadataPayload.errors)
        ? metadataPayload.errors.map((error) => safeError(error))
        : [],
    }),
  );
}

type JsonRpcEnvelope = {
  result?: {
    protocolVersion?: unknown;
    serverInfo?: { name?: unknown; version?: unknown };
    tools?: Array<{ name?: unknown }>;
  };
  error?: { code?: unknown; message?: unknown };
};

async function readJsonRpc(response: Response): Promise<JsonRpcEnvelope> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonRpcEnvelope;
  } catch {
    const dataLine = text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (dataLine === undefined) {
      return {};
    }
    return JSON.parse(dataLine.slice('data:'.length).trim()) as JsonRpcEnvelope;
  }
}

async function probeMcpToolList(accessToken: string): Promise<boolean> {
  const headers = {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
  };
  const initializeResponse = await fetch(tableauMcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'tableau-ambient-analyst-spike', version: '0.1.0' },
      },
    }),
  });
  const sessionId = initializeResponse.headers.get('mcp-session-id');
  const initializeBody = await readJsonRpc(initializeResponse);
  console.log(
    JSON.stringify({
      status: 'direct_mcp_initialize',
      httpStatus: initializeResponse.status,
      sessionPresent: sessionId !== null,
      protocolVersion: initializeBody.result?.protocolVersion ?? null,
      serverInfo: initializeBody.result?.serverInfo ?? null,
      error: initializeBody.error ?? null,
      requiredScope:
        initializeResponse.headers.get('www-authenticate')?.match(/scope="([^"]+)"/)?.[1] ?? null,
    }),
  );
  if (!initializeResponse.ok) {
    return false;
  }

  const toolsResponse = await fetch(tableauMcpUrl, {
    method: 'POST',
    headers: sessionId === null ? headers : { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const toolsBody = await readJsonRpc(toolsResponse);
  const toolNames = (toolsBody.result?.tools ?? [])
    .map((tool) => (typeof tool.name === 'string' ? tool.name : null))
    .filter((name): name is string => name !== null);
  console.log(
    JSON.stringify({
      status: 'direct_mcp_tools_list',
      httpStatus: toolsResponse.status,
      approvedToolsAvailable: allowedTools.every((name) => toolNames.includes(name)),
      approvedTools: allowedTools,
      toolNames,
      error: toolsBody.error ?? null,
    }),
  );
  return toolsResponse.ok;
}

async function main(): Promise<void> {
  const resourceMetadata = await jsonFetch<OAuthMetadata>(protectedResourceMetadataUrl);
  if (
    !Array.isArray(resourceMetadata.authorization_servers) ||
    resourceMetadata.authorization_servers.length !== 1
  ) {
    throw new Error('Hosted Tableau resource metadata has no single authorization server');
  }
  const authorizationServer = assertString(
    resourceMetadata.authorization_servers[0],
    'authorization server',
  );
  const oauthMetadata = await jsonFetch<OAuthMetadata>(
    `${authorizationServer}/.well-known/oauth-authorization-server`,
  );
  const authorizationEndpoint = assertString(
    oauthMetadata.authorization_endpoint,
    'authorization endpoint',
  );
  const tokenEndpoint = assertString(oauthMetadata.token_endpoint, 'token endpoint');
  if (
    oauthMetadata.client_id_metadata_document_supported !== true ||
    !Array.isArray(oauthMetadata.code_challenge_methods_supported) ||
    !oauthMetadata.code_challenge_methods_supported.includes('S256')
  ) {
    throw new Error('Hosted Tableau OAuth metadata does not satisfy CIMD + PKCE S256');
  }

  const state = base64Url(randomBytes(32));
  const { verifier, challenge } = createPkce();
  const publicCimdUrl: { value?: string } = {};
  let callbackCode: string | undefined;
  let resolveCallback: (() => void) | undefined;
  const callbackReceived = new Promise<void>((resolve) => {
    resolveCallback = resolve;
  });

  const callbackServer = startCallbackServer(state, (code) => {
    callbackCode = code;
    resolveCallback?.();
  });
  const callbackPort = await listen(callbackServer, '127.0.0.1');
  const redirectUri = `http://127.0.0.1:${callbackPort}/oauth/callback`;

  const metadataServer = startMetadataServer(() => {
    if (publicCimdUrl.value === undefined) {
      throw new Error('CIMD URL is not ready');
    }
    const metadata: CimdMetadata = {
      client_id: `${publicCimdUrl.value}/cimd.json`,
      redirect_uris: [redirectUri],
      client_name: 'Tableau Ambient Analyst local spike',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    return metadata;
  });
  const metadataPort = await listen(metadataServer, '127.0.0.1');
  const tunnel = await startQuickTunnel(metadataPort);
  publicCimdUrl.value = tunnel.url;
  try {
    const clientId = `${publicCimdUrl.value}/cimd.json`;
    const authorizationUrl = new URL(authorizationEndpoint);
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('scope', requestedScopes);
    authorizationUrl.searchParams.set('resource', tableauMcpUrl);

    console.log(
      JSON.stringify({
        cimdReachable: true,
        cimdUrl: clientId,
        redirectUri,
        pkce: 'S256',
        stateGenerated: true,
        tableauAuthorizationUrl: authorizationUrl.toString(),
        requestedScopes,
        tunnelExposure: 'CIMD only',
        secretExposure: 'none',
        status: 'HUMAN_ACTION_REQUIRED',
      }),
    );

    await callbackReceived;
    const code = assertString(callbackCode, 'OAuth callback code');
    const token = await exchangeCode(
      tokenEndpoint,
      clientId,
      code,
      redirectUri,
      verifier,
      tableauMcpUrl,
    );
    console.log(
      JSON.stringify({
        status: 'oauth_token_obtained',
        expiresIn: token.expiresIn,
        scope: token.scope,
      }),
    );
    await probeUnderlyingApis(token.accessToken);
    const directMcpReady = await probeMcpToolList(token.accessToken);
    if (directMcpReady) {
      const approvedChecksPassed = await runApprovedChecks(token.accessToken);
      if (approvedChecksPassed) {
        await runLiveCases(token.accessToken);
      } else {
        console.log(
          JSON.stringify({ status: 'live_evaluation_stopped', reason: 'approved_check_failed' }),
        );
      }
    }
  } finally {
    tunnel.process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      metadataServer.close(() => resolve());
      callbackServer.close();
    });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'OAuth bootstrap failed');
  process.exitCode = 1;
});
