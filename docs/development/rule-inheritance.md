# Development rule inheritance

## Purpose

This document records which development rules from `Chasoso/sake-sense` and
`Chasoso/tableau-chat-extension` should be carried into
`tableau-ambient-analyst`.

It is a decision record, not the final `AGENTS.md`, CI configuration, hook
implementation, or runtime policy. Issue #2 and later issues should use this
document as the source of truth when turning these decisions into executable
repository rules.

The target is an early Tableau × AI Ambient Analysis PoC. The project values
explainable architecture and explicit trade-offs, while keeping the initial
development loop local-first and small enough to evolve with the runtime.

## Principles

- Preserve rules that protect reviewability, human decision ownership, and
  credential/data-access boundaries.
- Prefer the smallest rule that is useful for the current PoC; do not import a
  mature repository's complete operating model by default.
- Keep deterministic local validation independent of AWS, Hosted Tableau MCP,
  and paid LLM services unless an issue explicitly opts in to them.
- Treat external tool and model output as untrusted input, while preserving the
  approved agentic MCP flow. Raw protocol/transport artifacts must not be
  exposed directly to logs, user-facing output, or arbitrary application
  prompts. An explicitly approved agentic flow may pass validated MCP tool
  results back to the LLM for tool selection and analysis.
- Record hypotheses, measurements, decisions, and rejected alternatives so the
  PoC explains not only what works but why it was selected.
- A deferred rule is not rejected. It becomes active when the relevant runtime,
  integration, team size, or operational risk exists.

## Rule decisions

| Topic | Source | Decision | Rationale | Adaptation / notes |
| --- | --- | --- | --- | --- |
| No direct push to `main` | `sake-sense` AGENTS.md; `tableau-chat-extension` AGENTS.md | inherit | Protects review and keeps the default branch releasable. | Target branch is `main` in this repository. |
| One Issue / one branch / one PR | Both repositories | inherit | Keeps scope, review, rollback, and issue status understandable. | This Issue is a single-issue change. |
| Issue number in branch name | Both repositories | inherit | Makes branch ownership and review context discoverable. | Use the requested `docs/issue-1-rule-inheritance`. |
| Conventional Commits | Both repositories | inherit | Gives the history a predictable, searchable shape. | Do not create artificial extra commits merely to mirror issue boundaries. |
| No `--no-verify` | Both repositories | inherit | Hook bypass can hide a real repository check. | If a hook is unavailable, report it; do not bypass it. |
| Codex does not merge its own PR | Both repositories | inherit | A human retains the final review and merge decision. | Codex may push and open the PR. |
| `Closes #...` handling | Both repositories | inherit | Issue closure should reflect completed scope, not merely a related change. | Add `Closes #1` only because this PR completes Issue #1. |
| Complete diff review before PR | Both repositories | inherit | Catches scope creep, secrets, debug files, and accidental changes. | Required for every PR, including docs-only PRs. |
| PR template content | Both repositories | adapt | Summary, issue, validation, safety, and reviewer notes are useful. | Issue #3 decides the repository's final template; do not add one here. |
| Repository-local Git hooks | `sake-sense` `.githooks/`; chat quality scripts/hooks | defer | Hooks can provide fast local feedback, but their commands must match the eventual runtime and must not become an undocumented bootstrap requirement. | Decide hook installation and staged/full-check split with the runtime in Issue #4/#5; never require hooks to validate this docs-only Issue. |
| Low-risk autonomous implementation | Both repositories | inherit | Allows Codex to make mechanical, in-scope progress without repeated approval. | Must follow the Issue, this record, and existing repository evidence. |
| Product decision | Both repositories | inherit | Product intent and acceptance of a hypothesis belong to a human. | Codex may document options and evidence but must not silently choose product direction. |
| Architecture decision | Both repositories | adapt | Architecture is central to this PoC and must remain explainable. | Codex may implement an explicitly decided architecture; material alternatives and trade-offs require human decision and an ADR or Issue record. |
| External service selection | Both repositories | inherit | Adding a hosted LLM, MCP, AWS, or other service changes cost, data flow, and failure modes. | Codex may spike an explicitly named service behind a gate, but may not select or add a production dependency autonomously. |
| Auth / authorization | `tableau-chat-extension` AGENTS.md and Hosted MCP issue docs | inherit | Auth changes can widen access and alter tenant/user boundaries. | Stop for human direction on identity, scopes, user context, token storage, refresh, or permission changes. |
| Credential / secret handling | Both repositories; chat secret-scanning docs | inherit | Credentials must never become implementation convenience or test data. | No production credentials in local files, logs, prompts, traces, fixtures, or PRs. |
| Destructive or irreversible operations | Both repositories | inherit | Destructive actions cannot be safely inferred from a short prompt. | Stop and request explicit authorization; preserve recoverable state where possible. |
| Scope expansion | Both repositories | inherit | Small Issues are the unit of review and learning. | Record follow-up work instead of silently implementing adjacent improvements. |
| Development lifecycle | `sake-sense` development loop | adapt | The source loop separates hypothesis, build, verification, experience, and learning. | Use `Question -> Hypothesize -> Specify -> Spike / Build -> Measure / Verify -> Decide -> Document`; add technical spikes and decision records because service and architecture choices are first-class PoC outputs. |
| Human experience gate | `sake-sense` AGENTS.md and development loop | adapt | Automated checks cannot establish whether an analysis is useful or understandable. | Apply when a UI, analysis explanation, or human-facing workflow exists; defer the concrete checklist until the relevant Issue. |
| Local-first development | Both repositories | inherit | Fast, reproducible local feedback is appropriate before external infrastructure exists. | The local runtime is the default target; external integrations are explicit exceptions. |
| AWS / cloud as normal development prerequisite | `sake-sense` local-first rule; chat workflows | omit | The initial PoC has no runtime or deployment to justify this dependency. | Cloud deployment rules belong to a later architecture/deployment Issue. |
| Default no-network validation | Both repositories | inherit | Prevents availability, cost, and credential state from determining ordinary CI results. | Default checks must use fakes, fixtures, or local transports. |
| External-network tests | Both repositories | adapt | Real integrations are valuable for compatibility but unsafe and non-reproducible as a default. | Make them explicitly opt-in, gated, documented, and safe to skip. |
| Hosted Tableau MCP integration tests | `tableau-chat-extension` v0.8 issue/docs | defer | Hosted MCP is a future integration, not current runtime. | When implemented, require an explicit gate, auth/context prerequisites, no-network default, safe skip/failure semantics, and no real secrets in default tests. |
| LLM API integration tests | Chat LLM safety boundary and no-network policy | defer | There is no LLM runtime yet and paid calls would make CI costly and flaky. | Add only after an adapter contract exists; keep deterministic tests default and live calls opt-in with budget, redaction, and timeout controls. |
| Paid API calls in normal CI | Chat no-network policy | inherit | Cost and external data transmission are not acceptable implicit CI behavior. | Never include paid calls in ordinary CI; a separately authorized integration job may be added later. |
| Format | `sake-sense` validation policy; chat validation policy | defer | A formatter is useful, but no runtime/toolchain is initialized. | Decide the command and CI parity after the runtime is selected; do not add tooling in Issue #1. |
| Lint | Both repositories | defer | Quality gates should match the eventual language and runtime. | Introduce with runtime initialization, not as a placeholder command. |
| Typecheck | Both repositories | defer | It depends on whether the PoC uses TypeScript or another typed boundary. | Establish after runtime selection. |
| Unit tests | Both repositories | defer | Tests are valuable once contracts and runtime code exist. | Prefer deterministic tests for normalization, safety boundaries, and decision logic when implementation begins. |
| Coverage | `sake-sense` thresholds; chat coverage policy | defer | Fixed thresholds from mature codebases would be arbitrary before a baseline exists. | Define meaningful thresholds after measuring the initial runtime and test surface; do not copy numeric thresholds. |
| Build | Both repositories | defer | There is currently no application build. | Add when a runtime artifact exists and define what “build” proves. |
| E2E | `sake-sense` and chat Playwright policies | defer | There is no UI/runtime to exercise. | Add only for a real user flow; keep external services mocked by default. |
| Secret scan | Both repositories | adapt | Secret detection must protect the first credential-bearing integration before it lands, without adding runtime tooling to this decision record. | Activation trigger: before the first Issue that introduces external API or MCP credentials, credential-bearing local configuration, or secret-dependent integration setup. Do not add a scanner, CI workflow, hook, or package in Issue #1. |
| Gitleaks | `tableau-chat-extension` validation policy | defer | It is a useful candidate for the pre-integration secret-scan gate, but no runtime or CI is being initialized here. | Revisit before the first credential-bearing external API/MCP Issue, alongside the chosen scanner approach; never silence findings to make validation pass. |
| Local validation and CI alignment | Both repositories | inherit | Developers need to know that local evidence predicts CI behavior. | Implement the mapping with the runtime in Issue #4/#5; docs-only Issues must not pretend runtime checks ran. |
| Validation evidence | `tableau-chat-extension` AGENTS.md | inherit | Exact commands, results, skipped checks, retries, and artifacts make a PR auditable. | Record docs-only scope and explicit non-runs; include integration gates and their reason when they exist. |
| Validation failure response | Both repositories | inherit | In-scope failures should be fixed, while unrelated or unsafe failures need human review. | Retry only transient/environment failures under a later explicit policy; never bypass security or permission failures. |
| `AGENTS.md` as executable repository rules | Both repositories | defer | The target needs a durable agent contract, but Issue #1 is only the decision record. | Issue #2 should derive the initial concise `AGENTS.md` from this document. |
| Issue authoring standard | `sake-sense` issue-authoring guide | adapt | Hypothesis, purpose, scope, acceptance, validation, and learning are useful for PoC work. | Add question, spike, measurement, decision, and documentation sections where applicable; Issue #3 defines the final templates/docs. |
| Read-only metadata / evidence boundary | `tableau-chat-extension` v0.7/v0.10 docs | adapt | The PoC needs analysis evidence without accidentally granting broad data access. | Start with explicitly scoped, read-only evidence; distinguish metadata from underlying row/field values and record the allowed boundary before implementation. |
| Hosted integration opt-in / gated | `tableau-chat-extension` AGENTS.md and v0.8 docs | inherit | Prevents a future hosted dependency from silently entering local development or CI. | Apply to Hosted Tableau MCP and any other external tool transport. |
| Raw MCP transport output | `tableau-chat-extension` safety boundary | inherit | Protocol artifacts, transport internals, unintentionally broad payloads, and secrets can leak implementation details or sensitive data. | Do not dump raw transport output into normal logs or user-facing output, expose it as an arbitrary application prompt, or treat protocol metadata as an application result. This does not prohibit an approved agentic flow from consuming an MCP tool result. |
| MCP tool result consumption | Agentic MCP hypothesis; generalized from chat MCP/LLM boundaries | adapt | The core PoC hypothesis requires the LLM to interpret Tableau MCP tool results and choose subsequent tools. | Permit tool-result consumption in an explicitly approved Hosted/Remote or local agentic MCP flow, including normal Responses API tool-result handling. When the application intermediates results, validate and bound schema, provenance, size, and allowed fields as appropriate before downstream use. |
| External tool output as untrusted input | Generalized from chat MCP/LLM boundaries | inherit | Tool results can be malformed, over-broad, adversarial, or contain prompt-injection content even when they are valid inputs to an agent loop. | Preserve the agentic loop, but apply context-appropriate validation/bounding before application-managed prompts, traces, logs, or user-facing output; never pass secrets or tokens downstream. |
| Persistent write-capable tools | `tableau-chat-extension` safety boundaries | inherit | Persistent or externally consequential writes can alter data, Tableau content, permissions, configuration, or external systems. | Require explicit Issue scope, human authorization, safety design, auditability, and rollback where applicable. This Issue does not define a write policy or implementation. |
| Ephemeral UI / view-state operations | Generalized from the chat safety boundary for this PoC | adapt | Filters, parameters, highlights, selections, and temporary view-state changes may be part of a future Dashboard Extension interaction without changing persistent data or content. | Govern separately from persistent writes; do not automatically classify these operations as persistent writes. A later Issue must define the concrete Extension control policy. |
| Broad data access | `tableau-chat-extension` safety boundaries | inherit | Broad access defeats least privilege and makes evidence provenance unclear. | Start with the narrowest Tableau context and data needed for the stated analysis question. |
| Bounded Tableau MCP query generation / execution | `tableau-chat-extension` safety boundaries, adapted for the Agentic MCP hypothesis | adapt | Agentic exploration may require the LLM to vary fields, filters, comparisons, dimensions, and follow-up analysis queries. | Allow query generation through approved Tableau MCP tools when it stays within the authorized datasource, tool schema, data-access boundary, and configured cost/result limits. Unrestricted arbitrary SQL, code, query-language execution, tool-schema bypass, unauthorized data access, and unbounded query/result expansion remain prohibited by default. |
| Authentication changes | `tableau-chat-extension` safety boundaries | inherit | Auth is a human-owned security and product decision. | No OAuth, PAT, JWT, token refresh, or Tableau permission changes in this Issue. |
| Permission expansion | `tableau-chat-extension` safety boundaries | inherit | Permission changes alter who can see or change data. | Require explicit policy, threat review, and human approval in a later Issue. |
| Production credentials | Both repositories | inherit | Production access is never needed to write a documentation decision record. | No production credential access or configuration in local validation or CI. |
| Work-package mode | `tableau-chat-extension` AGENTS.md | adapt | Grouping related Issues can help once shared contracts and dependencies exist. | Single-issue mode is the default now; permit work packages only when a human explicitly groups related Issues and review remains coherent. |
| Multiple Issues in one PR | Chat work-package policy | adapt | It can reduce coordination cost but can also hide scope and weaken rollback. | Do not combine Issues by default; allow only an explicitly authorized work package with complete issue mapping and separate acceptance evidence. |
| Nightly execution | `tableau-chat-extension` nightly workflow | defer | The repository is too young to benefit from mature overnight batching. | Revisit after repeatable runtime validation and enough independent Issues exist. Never let nightly mode authorize new product, auth, or external-service decisions. |
| Time budget | Chat nightly policy | defer | A fixed nightly budget would be artificial for the current single docs Issue. | Define only if scheduled/batched automation is adopted; preserve time for validation, review, and accurate reporting. |
| Automatic CI follow-up | Chat post-PR/nightly policy | defer | There is no CI yet to monitor. | Later automation may inspect and fix clearly in-scope failures, but must stop at configured retry limits and report unresolved failures. |
| Retry policy | Chat AGENTS.md | adapt | A bounded retry prevents transient failures from causing needless stops without hiding real failures. | Later policy: retry transient/environment failures once unchanged, inspect and fix in scope, retry once, then stop; never auto-retry auth, permission, secret, or destructive failures. |
| Draft PR | Chat AGENTS.md | defer | A draft is useful for partial work packages but unnecessary for this complete docs-only Issue. | Revisit when incomplete but reviewable work needs early feedback; never use it to mask known unsafe or broken changes. |
| Domain-specific sake rules | `sake-sense` domain boundary | omit | Sake terminology and product data do not transfer to Tableau Ambient Analysis. | Preserve only the general rule that domain terminology must be human-owned and evidence-backed. |
| Existing UI-specific rules | Both repositories | omit | Their UI flows and UX constraints do not describe this PoC's future interaction. | Add UI rules only with the actual target flow and human experience criteria. |
| Existing AWS deployment rules | `sake-sense` and chat deployment assets | omit | Deployment topology is not established and would prematurely constrain architecture. | Revisit only after a cloud execution decision is made. |
| Chat-extension version/function-specific rules | `tableau-chat-extension` issue history | omit | Specific versions, AgentCore, Notion, or existing feature names are not transferable requirements. | Retain the underlying safety principles, not the implementation choices. |

## Lifecycle adaptation

The inherited loop is useful, but the target's primary output is a defensible
technical decision rather than only a working interaction. The working model is:

```text
Question
  -> Hypothesize
  -> Specify
  -> Spike / Build
  -> Measure / Verify
  -> Decide
  -> Document
```

- `Question` states the analysis or architecture question.
- `Hypothesize` states the provisional belief and competing alternatives.
- `Specify` defines scope, acceptance evidence, safety boundaries, and what is
  deliberately not being built.
- `Spike / Build` permits a narrow experiment or implementation without turning
  an experiment into a permanent architecture decision.
- `Measure / Verify` combines deterministic checks with integration measurements
  and, when relevant, a human experience check.
- `Decide` records keep, revise, reject, or defer, plus the accepted trade-off.
  For material product-direction, architecture, external-service, security,
  authorization, cost, or data-flow decisions, this step is human-owned.
  Agents may summarize evidence, compare alternatives, organize trade-offs, and
  recommend a course of action, but must not silently finalize those decisions.
- `Document` records the evidence, decision, limitations, and follow-up Issue.

## Runtime and validation gate

Issue #1 intentionally does not initialize a runtime, packages, hooks, CI, or
secret scanner. Until that happens, validation for this document is limited to
document review and scope checks. Future runtime work should define a small
default no-network suite and make its local commands and CI commands the same.

The eventual validation policy should distinguish:

1. deterministic local checks for ordinary development;
2. opt-in Hosted Tableau MCP checks with explicit auth/context prerequisites;
3. opt-in LLM API checks with cost, timeout, redaction, and data-boundary
   controls; and
4. human review of analysis usefulness and explanation quality where automation
   cannot decide.

No coverage percentage, E2E framework, Gitleaks invocation, or formatter/linter
command is selected by this document. Those choices belong to the runtime and
validation Issues and must be justified by the resulting architecture.

Secret scanning has a separate activation gate: it must be selected and
enabled before the first Issue that introduces external API or MCP credentials,
credential-bearing local configuration, or any secret-dependent integration
setup. This is a prerequisite for that Issue, not a reason to add a scanner to
Issue #1.

## Source material

- [`sake-sense/AGENTS.md`](https://github.com/Chasoso/sake-sense/blob/main/AGENTS.md)
- [`sake-sense development loop`](https://github.com/Chasoso/sake-sense/blob/main/docs/development/development-loop.md)
- [`sake-sense Issue authoring guide`](https://github.com/Chasoso/sake-sense/blob/main/docs/development/issue-authoring-guide.md)
- [`sake-sense validation policy`](https://github.com/Chasoso/sake-sense/blob/main/docs/development/validation-policy.md)
- [`sake-sense PR template`](https://github.com/Chasoso/sake-sense/blob/main/.github/PULL_REQUEST_TEMPLATE.md)
- [`tableau-chat-extension/AGENTS.md`](https://github.com/Chasoso/tableau-chat-extension/blob/main/AGENTS.md)
- [`tableau-chat-extension secret scanning`](https://github.com/Chasoso/tableau-chat-extension/blob/main/docs/secret-scanning.md)
- [`tableau-chat-extension Codex validation policy`](https://github.com/Chasoso/tableau-chat-extension/blob/main/docs/codex-validation-policy.md)
- [`tableau-chat-extension Hosted MCP gating Issue`](https://github.com/Chasoso/tableau-chat-extension/blob/main/docs/issues/v0.8/03-define-hosted-mcp-integration-test-gating.md)
- [`tableau-chat-extension LLM safety boundary`](https://github.com/Chasoso/tableau-chat-extension/blob/main/docs/v0.10-llm-response-composer-safety-boundary.md)
