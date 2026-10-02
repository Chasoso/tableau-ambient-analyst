# Repository development rules

These rules are the concise execution contract for Codex and other coding
agents. Read this file before implementing an Issue. The detailed inheritance
decisions remain in
[`docs/development/rule-inheritance.md`](docs/development/rule-inheritance.md);
the rationale and lifecycle are in
[`docs/development/development-loop.md`](docs/development/development-loop.md).

## Default lifecycle

Use the smallest applicable path from:

```text
Question -> Hypothesize -> Specify -> Spike / Build -> Measure / Verify -> Decide -> Document
```

Give the full path particular attention for technical spikes, architecture or
service-selection work, and UX or analysis hypotheses. A straightforward fix
or implementation may use only the applicable subset, such as
`Specify -> Build -> Verify -> Document`.

## Human and agent ownership

Agents may make low-risk decisions that follow the Issue, this repository, and
existing patterns. They may inspect the repository, plan and implement,
perform deterministic validation and self-review, fix in-scope failures,
commit, push, create a PR, and organize alternatives, evidence, trade-offs,
and recommendations.

The following remain human-owned: product direction; material architecture or
external-service selection; security, authentication, authorization, or
permission expansion; material cost or data-flow decisions; final keep,
revise, or reject decisions about a hypothesis; destructive or irreversible
operations; and the final merge decision. Agents may recommend, but must not
silently finalize, these decisions.

## Git and pull requests

- Use `main` as the base branch and never push directly to it.
- Default to one Issue, one branch, and one PR; include the Issue number in the branch name.
- Use Conventional Commits. Never use `--no-verify`.
- Codex must not merge its own PR.
- Review the complete diff before creating a PR.
- Add `Closes #<issue>` only when the Issue is fully completed.
- Work-package mode is not the default. Use it only when a human explicitly groups Issues into a work package; otherwise keep Issues separate.

## Scope discipline

Before editing:

1. Read this file.
2. Read the complete Issue body.
3. Confirm scope, out of scope, acceptance criteria, and validation.
4. Inspect the repository and relevant files.
5. Identify dependencies and blockers.
6. Make an implementation plan.

During implementation, change only the requested scope, prefer existing
patterns, and report adjacent work as a follow-up Issue candidate. Do not
weaken rules or tests to make validation pass.

## Local-first and network boundary

Ordinary development is local-first. AWS and cloud infrastructure are not
normal prerequisites. Default validation is no-network. External LLM or Hosted
Tableau MCP access and live integration tests require an explicit Issue gate
and are opt-in. Paid API calls do not belong in normal CI. Do not invent
runtime commands or CI workflows until the runtime is established.

## MCP and external-tool safety

The approved agentic flow is allowed:

```text
LLM -> Tableau MCP -> tool result -> LLM -> next tool
```

An approved MCP tool result may be consumed by the LLM, and bounded query
generation is allowed within an approved Tableau MCP tool schema. Keep the
following boundaries:

- Do not expose raw protocol or transport artifacts, secrets, or tokens to ordinary logs, user-facing output, or arbitrary application prompts.
- Do not execute unrestricted arbitrary SQL, code, or query languages; bypass tool schemas; access unauthorized data; or allow unbounded result or cost expansion.
- Keep datasource, tool, data-access, and result limits explicit. Validate and bound application-intermediated results as appropriate.
- Do not expand permissions or execute persistent writes without explicit Issue scope and human authorization.
- Persistent writes include changes to data, Tableau content, permissions, configuration, or external systems.
- Filters, parameters, highlights, selections, and temporary view-state changes are ephemeral UI operations and are not automatically persistent writes. Their concrete Extension policy belongs to a later Issue.

## Secrets and self-review

- Never put production credentials in the repository, logs, prompts, traces, fixtures, or PRs.
- Enable secret scanning before the first Issue that introduces external API or MCP credentials, credential-bearing local configuration, or secret-dependent integration setup.
- Never silence a secret finding or retry an authentication or permission failure automatically.

Before opening a PR, review the full diff, scope, acceptance criteria,
secrets, debug or temporary files, unfinished TODOs, unintended file changes,
and documentation consistency. Report checks that do not exist or were not
run; do not claim runtime validation that was not performed.

Stop and report when satisfying the Issue requires a material human-owned
decision, a destructive or irreversible operation, production credentials, or
scope expansion not authorized by the Issue.
