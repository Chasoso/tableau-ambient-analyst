import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';

import {
  extractFinalAnswer,
  extractStructuredOutcome,
  extractToolCalls,
  summarizeUsage,
  type StructuredOutcome,
  type ToolCallTelemetry,
  type UsageTelemetry,
} from './response-telemetry.js';
import { measuredCaseSetups } from './measured-case-setup.js';

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
  calls: ToolCallTelemetry[];
  usage: UsageTelemetry;
  finalAnswer: string;
  outcome: StructuredOutcome | null;
  elapsedMs: number;
};

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
  const calls = extractToolCalls(result.output ?? [], datasourceLuid);
  const finalAnswer = extractFinalAnswer(result.output ?? [], result.output_text);
  return {
    calls,
    usage: summarizeUsage(result.usage),
    finalAnswer,
    outcome: extractStructuredOutcome(finalAnswer),
    elapsedMs: Date.now() - startedAt,
  };
}

function safeRequestId(response: Response): string | null {
  for (const header of ['x-request-id', 'request-id', 'openai-request-id', 'trace-id']) {
    const value = response.headers.get(header);
    if (value !== null && value.length > 0) return value;
  }
  return null;
}

async function runRelayDiagnostic(
  accessToken: string,
  tokenObtainedAt: number,
  expiresIn: number | null,
  issuedScope: string | null,
): Promise<void> {
  const startedAt = Date.now();
  const apiKey = readOpenAiKey();
  const toolConfiguration = {
    type: 'mcp',
    server_label: 'tableau-hosted',
    server_url: tableauMcpUrl,
    authorization: '<redacted>',
    allowed_tools: allowedTools,
    require_approval: 'never',
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input: `Use list-datasources only to confirm that datasource ${datasourceLuid} is visible. Return a short confirmation.`,
      max_output_tokens: 64,
      tools: [
        {
          ...toolConfiguration,
          authorization: accessToken,
        },
      ],
    }),
  });
  const requestId = safeRequestId(response);
  const tokenAgeSeconds = Math.round((Date.now() - tokenObtainedAt) / 1000);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown };
    };
    const error = payload.error ?? {};
    console.log(
      JSON.stringify({
        status: 'relay_diagnostic_attempt',
        attempt: 1,
        result: 'failed',
        tokenAgeSeconds,
        expiresIn,
        issuedScope,
        directAuthorizationScheme: 'Bearer token used for direct MCP HTTP requests',
        openAiAuthorizationField: 'raw OAuth access token, redacted; no explicit Bearer prefix',
        requestConfiguration: toolConfiguration,
        httpStatus: response.status,
        errorType: typeof error.type === 'string' ? error.type : null,
        errorCode: typeof error.code === 'string' ? error.code : null,
        errorMessage: typeof error.message === 'string' ? error.message : null,
        errorParam: typeof error.param === 'string' ? error.param : null,
        requestId,
        latencyMs: Date.now() - startedAt,
      }),
    );
    return;
  }
  const result = (await response.json()) as { output?: unknown[]; usage?: Record<string, unknown> };
  const outputTypes = Array.isArray(result.output)
    ? result.output.flatMap((item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { type?: unknown }).type === 'string'
          ? [(item as { type: string }).type]
          : [],
      )
    : [];
  console.log(
    JSON.stringify({
      status: 'relay_diagnostic_attempt',
      attempt: 1,
      result: 'success',
      tokenAgeSeconds,
      expiresIn,
      issuedScope,
      requestConfiguration: toolConfiguration,
      httpStatus: response.status,
      outputTypes,
      mcpListToolsPresent: outputTypes.includes('mcp_list_tools'),
      requestId,
      usage: summarizeUsage(result.usage),
      latencyMs: Date.now() - startedAt,
    }),
  );
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
  for (const evaluationCase of measuredCaseSetups) {
    const input = `Case ${evaluationCase.id}. ${evaluationCase.initialPrompt} Datasource is fixed to ${datasourceLuid}. Use only the approved read-only tools: list-datasources, get-datasource-metadata, query-datasource. Maximum 6 MCP calls, maximum 1 recoverable retry, aggregation-first, maximum 100 result rows, no writes, no other datasource. Return a concise answer followed by exactly one JSON object with keys outcome, summary, evidence_complete, missing_evidence, hypothesis_state, and stop_reason. Use outcome values supported, revised, rejected, or insufficient-evidence; use hypothesis_state values maintained, revised, rejected, or not-applicable; use stop_reason values sufficient-evidence, insufficient-evidence, tool-error, limit-reached, or other. Do not reproduce raw rows, tokens, headers, or credentials.`;
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

type VdsField = {
  fieldCaption?: unknown;
  dataType?: unknown;
  defaultAggregation?: unknown;
};

type VdsQuerySummary = {
  httpStatus: number;
  rowCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  data: unknown[];
};

function vdsError(payload: unknown): { code: string | null; message: string | null } {
  if (typeof payload !== 'object' || payload === null) {
    return { code: null, message: null };
  }
  const candidate = payload as Record<string, unknown>;
  return {
    code: typeof candidate.errorCode === 'string' ? candidate.errorCode : null,
    message: typeof candidate.message === 'string' ? candidate.message : null,
  };
}

async function queryVds(
  accessToken: string,
  query: Record<string, unknown>,
): Promise<VdsQuerySummary> {
  const response = await fetch(`${tableauPodUrl}/api/v1/vizql-data-service/query-datasource`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      datasource: { datasourceLuid },
      query,
      options: { returnFormat: 'OBJECTS', rowLimit: 100 },
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  const error = vdsError(payload);
  const data =
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data ?? [])
      : [];
  return {
    httpStatus: response.status,
    rowCount: data.length,
    errorCode: error.code,
    errorMessage: error.message,
    data,
  };
}

async function validateLiveCaseSetup(accessToken: string): Promise<boolean> {
  const metadataResponse = await fetch(`${tableauPodUrl}/api/v1/vizql-data-service/read-metadata`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ datasource: { datasourceLuid } }),
  });
  const metadata = (await metadataResponse.json().catch(() => ({}))) as {
    data?: unknown;
  };
  const fields = Array.isArray(metadata.data)
    ? (metadata.data as VdsField[]).filter((field) => typeof field.fieldCaption === 'string')
    : [];
  const numericField =
    fields.find((field) => field.fieldCaption === 'Daily View Count') ??
    fields.find((field) => {
      const type = typeof field.dataType === 'string' ? field.dataType.toUpperCase() : '';
      return (
        /INT|REAL|FLOAT|DOUBLE|NUMBER|DECIMAL/.test(type) || field.defaultAggregation !== undefined
      );
    });
  const dateField = fields.find((field) => {
    const type = typeof field.dataType === 'string' ? field.dataType.toUpperCase() : '';
    return /DATE|DATETIME/.test(type);
  });
  const dimensionField = fields.find((field) => field.fieldCaption === 'Workbook Title');
  if (numericField === undefined || dateField === undefined || dimensionField === undefined) {
    console.log(
      JSON.stringify({
        status: 'case_setup_redesign_validation',
        passed: false,
        reason: 'required numeric, date, or Workbook Title field is unavailable',
      }),
    );
    return false;
  }
  const numericCaption = numericField.fieldCaption as string;
  const dateCaption = dateField.fieldCaption as string;
  const dimensionCaption = dimensionField.fieldCaption as string;
  const monthlyTrend = await queryVds(accessToken, {
    fields: [
      { fieldCaption: dateCaption, function: 'MONTH', sortPriority: 1 },
      { fieldCaption: numericCaption, function: 'SUM' },
    ],
  });
  const workbookBreakdown = await queryVds(accessToken, {
    fields: [
      { fieldCaption: dimensionCaption, sortPriority: 1 },
      { fieldCaption: numericCaption, function: 'SUM' },
    ],
  });
  const emptyDate = await queryVds(accessToken, {
    fields: [{ fieldCaption: numericCaption, function: 'SUM' }],
    filters: [
      {
        field: { fieldCaption: dateCaption },
        filterType: 'QUANTITATIVE_DATE',
        quantitativeFilterType: 'MIN',
        minDate: '2099-01-01',
      },
    ],
  });
  const relaxedQuery = await queryVds(accessToken, {
    fields: [{ fieldCaption: numericCaption, function: 'SUM' }],
  });
  const ranking = workbookBreakdown.data
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => {
      const value = Object.entries(row).find(
        ([key, candidate]) => key.includes('SUM(') && typeof candidate === 'number',
      );
      return { title: row[dimensionCaption], value: value?.[1] };
    })
    .filter((row): row is { title: unknown; value: number } => typeof row.value === 'number')
    .sort((left, right) => right.value - left.value);
  const topWorkbook = ranking[0]?.title;
  const secondWorkbook = ranking[1]?.title;
  const passed =
    metadataResponse.ok &&
    monthlyTrend.httpStatus === 200 &&
    (monthlyTrend.rowCount ?? 0) > 1 &&
    workbookBreakdown.httpStatus === 200 &&
    (workbookBreakdown.rowCount ?? 0) > 1 &&
    emptyDate.httpStatus === 200 &&
    emptyDate.rowCount === 0 &&
    relaxedQuery.httpStatus === 200 &&
    (relaxedQuery.rowCount ?? 0) > 0 &&
    topWorkbook !== undefined &&
    secondWorkbook !== undefined;
  console.log(
    JSON.stringify({
      status: 'case_setup_redesign_validation',
      passed,
      metadataHttpStatus: metadataResponse.status,
      fields: { numeric: numericCaption, date: dateCaption, dimension: dimensionCaption },
      incompleteFirstResult: {
        initialQuery: 'month(date) + SUM(view-count)',
        httpStatus: monthlyTrend.httpStatus,
        rowCount: monthlyTrend.rowCount,
        followUpQuery: 'Workbook Title + SUM(view-count)',
        followUpHttpStatus: workbookBreakdown.httpStatus,
        followUpRowCount: workbookBreakdown.rowCount,
        setupValid:
          monthlyTrend.httpStatus === 200 &&
          (monthlyTrend.rowCount ?? 0) > 1 &&
          workbookBreakdown.httpStatus === 200 &&
          (workbookBreakdown.rowCount ?? 0) > 1,
      },
      emptyResultRecovery: {
        firstQuery: 'valid future-date quantitative filter',
        httpStatus: emptyDate.httpStatus,
        rowCount: emptyDate.rowCount,
        errorCode: emptyDate.errorCode,
        errorMessage: emptyDate.errorMessage,
        recoveryHttpStatus: relaxedQuery.httpStatus,
        recoveryRowCount: relaxedQuery.rowCount,
        setupValid:
          emptyDate.httpStatus === 200 &&
          emptyDate.rowCount === 0 &&
          relaxedQuery.httpStatus === 200 &&
          (relaxedQuery.rowCount ?? 0) > 0,
      },
      hypothesisDisproved: {
        initialHypothesis: 'the selected non-leading workbook has the highest view count',
        groundTruthAvailable: topWorkbook !== undefined && secondWorkbook !== undefined,
        groundTruthTopWorkbook: topWorkbook ?? null,
        selectedFalseHypothesisWorkbook: secondWorkbook ?? null,
        setupValid: topWorkbook !== undefined && secondWorkbook !== undefined,
      },
      insufficientEvidence: {
        observedEvidenceQueryHttpStatus: workbookBreakdown.httpStatus,
        observedEvidenceRows: workbookBreakdown.rowCount,
        externalCauseFieldPresent: false,
        setupValid: workbookBreakdown.httpStatus === 200 && (workbookBreakdown.rowCount ?? 0) > 0,
      },
    }),
  );
  return passed;
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

async function probeMcpInitialize(
  accessToken: string,
  tokenObtainedAt: number,
  attempt: string,
): Promise<{ ok: boolean; sessionId: string | null }> {
  const startedAt = Date.now();
  const headers = {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
  };
  const response = await fetch(tableauMcpUrl, {
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
  const body = await readJsonRpc(response);
  console.log(
    JSON.stringify({
      status: 'same_token_initialize_attempt',
      attempt,
      tokenAgeSeconds: Math.round((Date.now() - tokenObtainedAt) / 1000),
      elapsedMs: Date.now() - tokenObtainedAt,
      httpStatus: response.status,
      errorCode:
        typeof body.error?.code === 'string' ? body.error.code : (body.error?.code ?? null),
      errorMessage:
        typeof body.error?.message === 'string'
          ? body.error.message
          : (body.error?.message ?? null),
      sessionPresent: response.headers.get('mcp-session-id') !== null,
      latencyMs: Date.now() - startedAt,
    }),
  );
  return { ok: response.ok, sessionId: response.headers.get('mcp-session-id') };
}

async function runTokenTimingDiagnostic(
  accessToken: string,
  tokenObtainedAt: number,
): Promise<boolean> {
  const targetTimes = [0, 2000, 5000];
  for (const targetTime of targetTimes) {
    const waitMs = targetTime - (Date.now() - tokenObtainedAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const result = await probeMcpInitialize(
      accessToken,
      tokenObtainedAt,
      `T+${targetTime / 1000}s`,
    );
    if (result.ok) {
      const headers = {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        ...(result.sessionId === null ? {} : { 'mcp-session-id': result.sessionId }),
      };
      const toolsResponse = await fetch(tableauMcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      const toolsBody = await readJsonRpc(toolsResponse);
      const toolNames = (toolsBody.result?.tools ?? [])
        .map((tool) => (typeof tool.name === 'string' ? tool.name : null))
        .filter((name): name is string => name !== null);
      console.log(
        JSON.stringify({
          status: 'same_token_tools_list_after_initialize',
          tokenAgeSeconds: Math.round((Date.now() - tokenObtainedAt) / 1000),
          httpStatus: toolsResponse.status,
          approvedToolsAvailable: allowedTools.every((name) => toolNames.includes(name)),
          approvedTools: allowedTools,
          toolCount: toolNames.length,
          errorCode:
            typeof toolsBody.error?.code === 'string'
              ? toolsBody.error.code
              : (toolsBody.error?.code ?? null),
          errorMessage:
            typeof toolsBody.error?.message === 'string'
              ? toolsBody.error.message
              : (toolsBody.error?.message ?? null),
        }),
      );
      return toolsResponse.ok;
    }
  }
  console.log(
    JSON.stringify({
      status: 'same_token_timing_diagnostic_complete',
      result: 'failed',
      conclusion:
        'No HTTP 200 initialize observed by T+5s; short propagation delay not established',
    }),
  );
  return false;
}

async function runFreshTokenTimingDiagnostic(
  accessToken: string,
  tokenObtainedAt: number,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const first = await probeMcpInitialize(accessToken, tokenObtainedAt, 'fresh-T+2s');
  if (first.ok) {
    console.log(
      JSON.stringify({ status: 'fresh_token_timing_diagnostic', result: 'initialize_succeeded' }),
    );
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const second = await probeMcpInitialize(accessToken, tokenObtainedAt, 'fresh-T+5s');
  if (second.ok) {
    console.log(
      JSON.stringify({ status: 'fresh_token_timing_diagnostic', result: 'initialize_succeeded' }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      status: 'fresh_token_timing_diagnostic',
      result: 'failed',
      conclusion: 'Fresh token remained invalid through T+5s',
    }),
  );
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
    const tokenObtainedAt = Date.now();
    console.log(
      JSON.stringify({
        status: 'oauth_token_obtained',
        expiresIn: token.expiresIn,
        scope: token.scope,
      }),
    );
    if (process.argv.includes('--timing-diagnostic')) {
      await runTokenTimingDiagnostic(token.accessToken, tokenObtainedAt);
      return;
    }
    if (process.argv.includes('--fresh-timing-diagnostic')) {
      await runFreshTokenTimingDiagnostic(token.accessToken, tokenObtainedAt);
      return;
    }
    await probeUnderlyingApis(token.accessToken);
    const caseSetupReady = await validateLiveCaseSetup(token.accessToken);
    if (process.argv.includes('--setup-only')) {
      console.log(
        JSON.stringify({
          status: 'setup_only_complete',
          measuredRunsStarted: false,
          setupReady: caseSetupReady,
        }),
      );
      return;
    }
    const directMcpReady = caseSetupReady && (await probeMcpToolList(token.accessToken));
    if (directMcpReady) {
      if (process.argv.includes('--relay-diagnostic')) {
        await runRelayDiagnostic(token.accessToken, tokenObtainedAt, token.expiresIn, token.scope);
        return;
      }
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
