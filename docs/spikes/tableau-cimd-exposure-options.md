# Tableau MCP CIMD exposure options

## Scope

This note compares temporary ways to make the local harness's CIMD metadata
document reachable over HTTPS by Hosted Tableau MCP. It does not publish a
document, start a tunnel, perform OAuth, or create Tableau configuration.

The CIMD document contains no secret. It is public client metadata. OAuth
tokens, authorization codes, OpenAI credentials, and cookies remain outside the
document and must never be logged or persisted.

## Hosted Tableau MCP CIMD schema

The live authorization-server metadata advertises:

```json
{
  "client_id_metadata_document_supported": true,
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"]
}
```

The official Tableau MCP implementation validates the CIMD document with the
following effective schema:

- required `client_id`: string; it must equal the CIMD document URL;
- required `redirect_uris`: one or more URL strings;
- optional `client_name`: string;
- optional URL fields: `logo_uri`, `client_uri`, `tos_uri`, `policy_uri`;
- optional `grant_types`: string array;
- optional `response_types`: values `code` or `token`;
- optional `post_logout_redirect_uris`: URL array;
- optional `scope`: string;
- optional `token_endpoint_auth_method`: `none`, `client_secret_basic`, or
  `client_secret_post`.

The minimum metadata for this public PKCE client can therefore be:

```json
{
  "client_id": "https://PUBLIC-CIMD-HOST.example/cimd.json",
  "redirect_uris": ["http://127.0.0.1:PORT/oauth/callback"],
  "client_name": "Tableau Ambient Analyst local spike",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

`PUBLIC-CIMD-HOST.example` and `PORT` are placeholders. The harness must
generate the actual ephemeral callback port and ensure that `client_id` in the
document exactly matches the URL passed to the authorization endpoint. The
authorization request should request only the already approved read scopes;
the CIMD document itself must not broaden the tool or datasource boundary.

References: [Tableau MCP OAuth implementation](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/schemas.ts),
[CIMD validation path](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/authorize.ts),
[Hosted Tableau MCP](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp),
and [live authorization-server metadata](https://sso.online.tableau.com/.well-known/oauth-authorization-server).

## Options

| Option | Setup | Stable URL | Local port exposed | Secrets | Cleanup | Cost | Spike complexity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare Quick Tunnel | Install `cloudflared`; serve only `cimd.json` locally; run `cloudflared tunnel --url http://127.0.0.1:PORT` | Random `trycloudflare.com`; changes per run | Yes, only the metadata server | No account/token required | Stop `cloudflared` and the metadata server | Free for Quick Tunnels | Low |
| Temporary static HTTPS host | Publish one static JSON file to an existing HTTPS static host, then remove it after the spike | Stable while published | No | No CIMD secret; deployment credentials may exist outside the document | Delete the file and disable/remove the temporary publication | Depends on existing host | Medium |
| Authenticated tunnel service | Install a tunnel client and expose only the metadata server | Usually ephemeral; provider-dependent | Yes | Commonly requires an account token; keep it outside the repository | Stop tunnel and remove local credentials/config | Free tier or provider-dependent | Medium |

### Cloudflare Quick Tunnel

This is the smallest disposable option. [Cloudflare documents](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
that Quick Tunnels
need no account or domain, issue a temporary random hostname, and stop serving
when the process stops. Anyone with the URL can reach the local service, so the
local server must expose only the single static CIMD document and no callback,
token, or harness control endpoint. Quick Tunnels have no uptime guarantee;
that is acceptable for a one-session metadata fetch.

The documented lack of SSE support is not a blocker for this use because the
tunnel would carry only a normal HTTPS GET for CIMD, not the Tableau MCP
transport.

### Temporary static HTTPS host

This avoids exposing a local port, but creates a public repository or hosting
artifact and a deployment/cleanup step. It is more durable than needed and can
leave cached copies or stale client metadata after the spike. It should only be
used if an already-approved static HTTPS host exists; creating new cloud
infrastructure is outside this spike.

### Authenticated tunnel service

This is technically workable, but adds a provider account and an authentication
token unrelated to Tableau OAuth. It increases secret-handling and cleanup
surface without improving the CIMD experiment. It is not preferred unless the
accountless tunnel is unavailable and a human explicitly approves the service.

## Recommendation

Use an accountless, short-lived HTTPS tunnel for a dedicated metadata-only local
HTTP server, with Cloudflare Quick Tunnel as the current candidate. Do not start
it until the human approves this external service boundary. The harness should:

1. create an ephemeral loopback callback port;
2. serve only the generated `cimd.json` on a separate local metadata port;
3. start the temporary tunnel and obtain its random HTTPS URL;
4. set that exact URL as `client_id` in the CIMD document;
5. perform browser OAuth; and
6. stop both processes and delete all temporary in-memory state after the run.

The loopback callback remains local to the human's browser and does not need to
be exposed through the tunnel. No Tableau Connected App, DCR registration, or
permanent cloud resource is part of this proposal.

## Human decision gate

No external service has been registered, installed, or started by this spike.
The remaining decision is whether an accountless temporary HTTPS tunnel is an
acceptable one-session dependency. If approved, the next human action during
execution is only Tableau browser sign-in/consent; no client secret, token, or
authorization code should be pasted into chat.
