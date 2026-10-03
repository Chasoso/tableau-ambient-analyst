# ADR-0001: Initial application runtime and toolchain

## Status

Accepted

This ADR was accepted after the runtime technical spike and human review.
TypeScript / Node.js is the initial core runtime for the PoC. The decision can
be revisited if requirements or measured evidence change.

## Context

The Tableau Ambient Analyst is a local-first Tableau × AI Ambient Analysis PoC.
Its early uncertainty is not only how to call an LLM, but how an application
runtime should host an agentic loop, consume approved Tableau MCP results, and
later connect to a Dashboard Extension. The project may also need external LLM
providers, cloud execution, and native desktop audio capture on Windows or
macOS, but none of those future choices should be fixed prematurely.

The selected initial direction is TypeScript / Node.js for the core
application, with a platform-specific capture helper if native audio becomes
necessary. The spike compared this direction with Python, C# / .NET, and a
deliberately small Hybrid approach.

The comparison is domain-neutral. It does not depend on a particular Tableau
workbook, datasource, or demo dataset.

Tableau Desktop is not treated as Windows-only in this spike: Tableau's
deployment guidance covers both Windows and Mac computers. The portable core
therefore remains useful even when the future desktop capture boundary differs
by operating system.

## Decision

### Accepted direction

Use TypeScript / Node.js as the initial core runtime and toolchain for the PoC.

The accepted toolchain direction is TypeScript on Node.js with a
browser-facing TypeScript/JavaScript Extension boundary. Exact Node.js,
TypeScript, package manager, framework, and test-library versions remain
implementation choices for a later bootstrap Issue; this ADR does not add
them.

Keep the core runtime cross-platform. If native desktop audio capture becomes
necessary, introduce a platform-specific capture boundary rather than changing
the core runtime solely for one operating system. Candidate implementations
could include Windows/WASAPI with a C#/.NET helper or macOS/ScreenCaptureKit
with a Swift/native helper, but neither is selected here.

This decision does not select an LLM provider, MCP transport, persistence
technology, WebSocket architecture, cloud provider, deployment topology, or
final audio architecture.

## Comparison

| Dimension | TypeScript / Node.js | Python | C# / .NET | Hybrid |
| --- | --- | --- | --- | --- |
| LLM / agentic APIs | Strong official SDK and current agent/tool/MCP examples; good fit for streaming and structured schemas | Strong official SDK coverage and broad model/agent ecosystem; natural for data and ML experiments | Strong general HTTP/async/tooling foundation; provider-specific SDK fit must be checked per provider | Can select the strongest provider-specific runtime, but every boundary becomes part of the design |
| MCP | Official TypeScript SDK supports clients/servers and stdio, Streamable HTTP, and SSE | Official Python SDK supports clients/servers and the same common transports | Official Tier 1 MCP SDK support exists; provider-specific integration still needs validation per provider | Can isolate a specialized MCP client, but adds cross-language contracts and operations |
| Tableau Extension affinity | Direct fit: the official Extension API is a JavaScript web application and its local examples use Node.js/npm | Requires a separate web-facing TypeScript/JavaScript boundary | Requires a separate web-facing TypeScript/JavaScript boundary | Naturally separates Extension and backend, at the cost of more integration work |
| Streaming / event-driven server | Mature async and web-streaming ecosystem; one language can cover web and server concerns | Mature async options, but web and data stacks may be split across conventions | Mature async/server stack and strong Windows integration | Potentially strongest per component, but cross-process events and contracts are additional work |
| Structured schemas / testing | TypeScript types plus schema libraries support shared contracts and deterministic tests | Excellent validation/testing ecosystem and data fixtures | Strong compile-time types, testing, and tooling | Shared schemas must be kept consistent across language boundaries |
| Platform-specific native audio | Cross-platform core; native desktop capture may need an OS-specific helper or binding | Cross-platform analysis/audio ecosystem is strong; native system capture may need OS-specific libraries or bindings | Strong for Windows/WASAPI, but macOS capture needs different native technology | Can use OS-specific helpers, such as a C# candidate on Windows and Swift candidate on macOS, at the cost of more boundaries |
| Cross-platform local development | Strong alignment with browser/extension development and local server workflows | Strong and portable, especially for analysis experiments | Strong, though the team must maintain .NET tooling alongside browser tooling | Lowest common denominator is the operational contract across runtimes |
| Operational simplicity | One primary language can cover Extension-adjacent code and the initial server | Simple if analysis is central; less simple if Extension contracts are first-class | Simple for a .NET-centered app, but less aligned with the browser-facing edge | Highest startup, packaging, debugging, and deployment overhead |

These are qualitative observations, not a scorecard. Provider and MCP
capabilities change quickly, so the specific provider and transport should be
revalidated in their own spikes before implementation.

## Alternatives considered

### TypeScript / Node.js

This has the best initial fit for a PoC whose likely edge is a Tableau web
extension and whose core needs agentic API calls, streaming, schemas, and local
server behavior. It permits one primary language across browser-facing code and
the first application runtime. The official MCP TypeScript SDK also provides a
direct local and remote transport path.

Its main weakness is native desktop audio capture: it may need an OS-specific
helper or binding. That weakness is meaningful, but it does not automatically
outweigh the Extension and MCP alignment while capture remains a future
requirement.

### Python

Python is a strong alternative for data analysis, evaluation notebooks, local
ML, and provider experimentation. Its official MCP SDK supports client and
server roles and common transports. Its cross-platform analysis/audio
ecosystem is useful, although native system capture may still require
OS-specific libraries or bindings. It may become preferable if the PoC's main
uncertainty shifts toward scientific processing, local models, or Python-first
analysis libraries.

The cost is a second web-facing language/runtime boundary for the Dashboard
Extension and potentially more contract work between browser and analysis
service.

### C# / .NET

C# / .NET is a strong alternative when Windows-native audio, Windows service
integration, or a Microsoft-centric deployment target is a first-order
requirement. It also provides mature async, testing, server capabilities, and
credible official MCP support: the MCP SDK is currently classified as Tier 1.
That does not make it equally strong for every platform; macOS-native capture
would require different native technology.

It is less directly aligned with the JavaScript-based Tableau Extension edge
and would make the initial MCP/provider comparison less uniform with the web
runtime. The current evidence does not justify making a platform-specific
native audio requirement the driver of the whole application choice.

### Hybrid

A hybrid can use TypeScript for the core and Extension with a C# capture helper
on Windows and a Swift/native helper on macOS, or Python for analysis with
TypeScript at the Extension boundary. This is a valid escape hatch when
evidence shows a capability cannot be handled well by one runtime.

It is not the default starting point because it introduces process lifecycle,
schema/versioning, local setup, debugging, packaging, and deployment costs
before those costs are known to be necessary.

## Rationale

The accepted TypeScript / Node.js direction optimizes for the current PoC's
highest-confidence needs:

- the future Dashboard Extension is a JavaScript web application;
- the initial server needs async I/O, streaming, structured data, and tool
  calling rather than heavy local scientific computation;
- official MCP tooling is available for local and remote client/server work;
- a single primary language reduces early contract and local-setup overhead;
- it remains compatible with later external providers and cloud deployment
  without selecting one now.

Current official documentation also shows that the provider landscape is not a
reason to lock the project to one vendor: OpenAI documents Responses API MCP
connections and streaming/structured outputs, Anthropic documents a remote MCP
connector, and Amazon Bedrock documents both client-side and server-side tool
use. These are capability inputs for later provider-specific spikes, not an
accepted provider decision.

The important architectural inference is that the portable core and native
audio capture are separable concerns. Windows or macOS capture should drive the
core runtime choice only if later evidence makes platform-specific capture a
central and dominant requirement. Otherwise, a helper/process boundary
preserves more options.

## Trade-offs / consequences

With this decision, the project gains a coherent first toolchain for
the Extension-adjacent application and MCP experiments. It also postpones a
multi-language boundary until a concrete capability requires it.

This decision accepts these costs:

- TypeScript is not the strongest option for platform-specific native audio
  capture.
- Python may be faster for some analysis, evaluation, or local-ML work.
- C#/.NET's Windows/WASAPI strength should not be treated as cross-platform
  native-capture strength; macOS requires different native APIs.
- A provider-neutral core still requires provider-specific validation later.
- Current remote MCP capabilities and SDK maturity may change, so this ADR
  cannot substitute for an integration spike.
- A later C# or Python helper would add process, schema, packaging, and
  observability complexity.

No production package, lockfile, runtime bootstrap, provider abstraction, or
audio implementation is introduced by this ADR.

## Revisit when

Revisit this decision when any of the following becomes true:

- native platform audio capture becomes a core acceptance criterion rather than
  a future possibility;
- Windows-native capture becomes central, macOS-native capture becomes central,
  or Windows/macOS parity becomes a core requirement;
- platform-specific helper complexity becomes too high, or native audio
  processing becomes performance-critical;
- heavy local ML, scientific, or audio processing becomes central to the PoC;
- provider SDK or agentic/MCP capabilities change materially;
- hosted or local MCP capabilities require a different runtime boundary;
- the Dashboard Extension contract changes materially;
- cloud, deployment, packaging, or operational requirements become primary;
- measured latency, cost, reliability, or developer productivity crosses a
  human-defined threshold.

## Evidence / references

The following official documentation was reviewed for this spike on 2026-10-03:

- [OpenAI MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Amazon Bedrock APIs](https://docs.aws.amazon.com/bedrock/latest/userguide/apis.html)
- [Amazon Bedrock tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
- [MCP Python SDK](https://py.sdk.modelcontextprotocol.io/)
- [MCP SDK tiering](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/sdk.mdx)
- [MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk)
- [Tableau Extensions API](https://tableau.github.io/extensions-api/docs/)
- [Tableau Extensions API installation](https://tableau.github.io/extensions-api/docs/installation/)
- [Tableau deployment guide: supported computers](https://help.tableau.com/current/desktopdeploy/en-us/desktop_deploy_intro.htm)
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
- [Apple Core Audio](https://developer.apple.com/documentation/coreaudio)
- [Microsoft WASAPI overview](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi)
- [Microsoft WASAPI loopback recording](https://learn.microsoft.com/windows/win32/coreaudio/loopback-recording)

The repository was also inspected to confirm that the runtime is not yet
initialized and that this spike can remain documentation-only.
