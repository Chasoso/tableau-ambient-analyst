# Agentic provider capability reconnaissance

## Scope and date

This note records current official documentation relevant to Issue #17. It is
capability reconnaissance, not a production-provider decision and not live
experiment evidence. The review was performed on 2026-10-03.

| Capability | OpenAI Responses API | Anthropic Messages / MCP connector | Amazon Bedrock |
| --- | --- | --- | --- |
| Remote MCP | Documented remote MCP servers and Secure MCP Tunnel | MCP connector connects directly to remote HTTP MCP servers | AgentCore Gateway can expose MCP targets; generic Converse is separate |
| Provider-managed tool execution | Remote MCP calls are integrated by the Responses API; approval can remain application-controlled | MCP connector is a server-side tool integration; ordinary client tools remain application-executed | AgentCore Gateway is a current server-side integration path, but requires an AWS gateway and IAM; Converse tool use remains application-mediated |
| Client-managed loop | Still required for application-defined tools and application-owned guards | Required for ordinary `tool_use` tools; connector does not remove application safety/accounting | Required for generic Converse tool use |
| Structured output | Responses API supports JSON Schema structured outputs | Tool input schemas and structured content are documented; final-result contract still needs provider-specific validation | Converse supports tool configuration and model-specific response fields; final-result contract needs model/config validation |
| Stateful run | Responses API supports response chaining/state mechanisms | Messages history is supplied by the client; managed-agent sessions are a separate product surface | Converse supports multi-turn messages; application/session state remains a design concern |
| Private/local MCP | Secure MCP Tunnel is documented for private servers | Connector requires a publicly exposed HTTP server; local stdio is not directly supported | AgentCore Gateway requires provisioned AWS infrastructure; no local/private path was approved here |
| Observability / limits | Response and MCP lifecycle events are available; approvals, result size, cost, and retention need explicit policy | Tool-use blocks, errors, and MCP connector configuration are observable; limits and billing remain configuration-specific | Converse and AgentCore provide API/gateway metadata; model, gateway, IAM, quota, and cost details require a configured account |

## Interpretation

The current documentation supports a meaningful capability comparison without
pretending that the providers expose the same mechanism:

- OpenAI is the clearest candidate for a hosted remote-MCP experiment in this
  repository because the Responses API documents MCP tools, approval policy,
  private-server tunneling, structured outputs, and MCP lifecycle events.
- Anthropic has a credible direct MCP connector, but the current connector
  requires a publicly reachable HTTP server and supports MCP tool calls rather
  than the complete MCP feature set. Ordinary Messages API tool use remains a
  client-mediated loop.
- Bedrock has two different paths that must not be conflated. Converse tool use
  is a client-managed application loop. AgentCore Gateway is a newer
  server-side tool integration, but it requires a provisioned gateway, IAM
  permissions, and a configured MCP target. It was not available in this local
  repository environment.

These facts do not select a production provider. They only identify which
provider-specific prerequisites and orchestration boundaries a later live run
must make visible.

## Sources

- [OpenAI MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Amazon Bedrock Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [Amazon Bedrock server-side tool use with AgentCore Gateway](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-server-side.html)
- [Tableau MCP introduction](https://tableau.github.io/tableau-mcp/docs/intro)
- [Hosted Tableau MCP](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp)
- [Tableau MCP getting started](https://tableau.github.io/tableau-mcp/docs/getting-started)

## Current evidence status

No provider call or Tableau MCP call was made for Issue #17. No credential,
approved datasource, approved MCP endpoint, approved tool allowlist, or spend
authorization is present in this repository or local environment. Capability
documentation is therefore `observed from official documentation`; live
behavior is `NOT RUN — prerequisite missing`.
