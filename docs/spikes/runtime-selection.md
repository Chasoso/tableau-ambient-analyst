# Runtime selection spike

## Question

Which initial application runtime and toolchain best fit the Tableau Ambient
Analyst PoC without prematurely constraining later audio, cloud, or provider
choices?

## Hypothesis

TypeScript / Node.js may be the smallest broadly aligned core runtime because
the future Dashboard Extension is JavaScript-based and the PoC needs async
agentic API, MCP, streaming, and structured-data handling. Windows-specific
audio may be better isolated behind a later helper rather than deciding the
whole application runtime.

This remains provisional. The purpose of the spike is to test the hypothesis
against alternatives, not to prove it.

## Method and scope

This was a documentation-first comparison. I inspected the repository policies,
confirmed that no runtime has been initialized, and reviewed current official
documentation for representative provider, MCP, and Tableau Extension
capabilities. No live API call, credential, paid request, hosted Tableau MCP
connection, package installation, or disposable runtime experiment was needed
to answer the current comparison question.

The alternatives were intentionally kept at four levels:

1. TypeScript / Node.js
2. Python
3. C# / .NET
4. Hybrid

The comparison is about the initial application boundary, not a final provider,
MCP transport, persistence layer, cloud deployment, or audio architecture.

## Observations

### Provider and agentic API surface

The current official documentation indicates that all three provider families
can support the core interaction patterns needed for later spikes, but through
different abstractions:

- OpenAI documents Responses API connections to remote MCP servers and local
  servers through Secure MCP Tunnel, along with streaming and structured model
  outputs.
- Anthropic documents a Messages API MCP connector that can connect directly to
  remote servers and configure individual tools. Its current connector has
  important boundaries: tool calls are the supported MCP feature, and the
  connector expects a publicly reachable HTTP endpoint rather than local STDIO.
- Bedrock documents a unified Converse API with streaming and client-side tool
  use, plus Responses API server-side tool use for supported configurations.

This supports keeping the application runtime provider-neutral at the decision
level. It does not establish that every provider offers the same MCP, state,
streaming, or tool execution behavior.

### MCP ecosystem

The official TypeScript and Python SDKs both document client and server support
and common transports including stdio, Streamable HTTP, and SSE. This reduces
the risk that either language would block a local-first MCP spike. The choice
between them therefore depends more on the surrounding Extension and
application boundary than on basic MCP availability alone.

The official SDK pages should be rechecked before implementation because MCP
specification versions and SDK release lines are moving quickly.

### Tableau Extension boundary

Tableau documents Extensions as web applications using a JavaScript library.
The Extension API installation guidance uses Node.js and npm for local samples
and development. Extensions may run against Tableau Desktop, Server, and Cloud,
with separate security and allow-list considerations for network-enabled
extensions.

That makes TypeScript / Node.js the lowest-friction initial pairing for the
browser-facing edge, while leaving a Python or .NET backend possible behind a
deliberate contract.

### Windows audio

Windows-native capture such as WASAPI loopback or microphone integration is a
stronger fit for a Windows-native implementation than for a browser-oriented
Node.js core. C# / .NET is therefore a credible helper choice if audio becomes
central. Python may also be useful for audio analysis, but neither observation
changes the current separation between the application runtime and a possible
native capture helper.

### Developer experience and operations

TypeScript / Node.js offers one primary language for the future Extension edge
and the first local server, reducing early contract and setup overhead. Python
is attractive when analysis, notebooks, local ML, or scientific processing
dominates. C# / .NET is attractive for Windows-native integration and a
Microsoft-centered operational target. Hybrid has the broadest capability
coverage but the highest coordination and operational cost.

## Recommendation

Recommend TypeScript / Node.js for the initial core runtime and toolchain,
pending human review of this Proposed ADR.

Keep Windows-specific audio behind a module or process boundary and revisit a
C# helper only if native capture is demonstrated to be a core requirement.
Keep the provider, MCP transport, persistence, cloud, and final audio choices
open for later Technical Spikes.

## Learning state

Evidence and recommendation are complete for this spike. The learning cycle is
not closed: a human must review the evidence and record `Accept`, `Revise`,
`Reject`, or `Defer` before the runtime direction is treated as an accepted
architecture decision.

See [ADR-0001](../adr/0001-initial-application-runtime.md) for the concise,
decision-oriented record.
