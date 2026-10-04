import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';

const tableauMcpUrl = 'https://mcp.tableau.com';
const protectedResourceMetadataUrl = `${tableauMcpUrl}/.well-known/oauth-protected-resource`;
const datasourceLuid = '14f3ac6d-1171-4065-baac-c63bdce1470f';
const allowedTools = ['list-datasources', 'get-datasource-metadata', 'query-datasource'] as const;
const requestedScopes = 'tableau:mcp:datasource:read tableau:viz_data_service:read';

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
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }
  const token = (await response.json()) as TokenResponse;
  return assertString(token.access_token, 'OAuth access token');
}

async function verifyWithOpenAi(accessToken: string): Promise<void> {
  const apiKey = readOpenAiKey();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input: `Use ${allowedTools[1]} for datasource ${datasourceLuid}. Return a short confirmation only.`,
      max_output_tokens: 32,
      tools: [
        {
          type: 'mcp',
          server_label: 'tableau-hosted',
          server_url: tableauMcpUrl,
          authorization: accessToken,
          allowed_tools: [allowedTools[1]],
          require_approval: 'never',
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI MCP verification failed (${response.status})`);
  }
  const result = (await response.json()) as {
    output?: Array<{ type?: unknown; name?: unknown; error?: unknown }>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown };
  };
  const calls = (result.output ?? [])
    .filter((item) => item.type === 'mcp_call')
    .map((item) => ({ name: item.name, error: item.error ?? null }));
  console.log(
    JSON.stringify({
      status: 'openai_mcp_verification_succeeded',
      calls,
      usage: result.usage ?? null,
    }),
  );
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
    const accessToken = await exchangeCode(tokenEndpoint, code, redirectUri, verifier);
    await verifyWithOpenAi(accessToken);
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
