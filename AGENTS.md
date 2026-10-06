# Repository development rules

These rules are the concise execution contract for Codex and other coding
agents. Read this file before implementing an Issue. The detailed inheritance
decisions remain in
[`docs/development/rule-inheritance.md`](docs/development/rule-inheritance.md);
the rationale and lifecycle are in
[`docs/development/development-loop.md`](docs/development/development-loop.md).

## Issue-to-PR execution contract

The user's short instruction is enough to start the default workflow. Resolve
an instruction such as `Issue #Nを実装して` from the GitHub Issue, then use this
priority order: user instruction, complete Issue body, this file, relevant
ADRs, repository docs, and existing implementation/tests. Do not ask the user
to repeat information already present in those sources.

For each Issue, use one Issue, one feature branch, and one PR by default. The
Issue body is the primary task specification; confirm scope, non-goals,
acceptance criteria, related docs/ADRs, and validation before editing. The
required path is implementation, self-review, deterministic validation,
independent review in a fresh context, bounded correction/review cycles, and
PR creation only after the gate passes. `main` is never pushed directly,
`--no-verify` is forbidden, and Codex never merges its own PR. Use
Conventional Commits and include `Closes #N` only when the Issue is complete.

Independent review findings use the existing result names (`PASS`,
`CHANGES_REQUIRED`, and `HUMAN_DECISION_REQUIRED`) plus a finding
classification: `AUTO_FIX`, `HUMAN_DECISION_REQUIRED`, or `BLOCKED`. A
structured finding records its severity, generalized rule, affected
locations, and recommended fix. The reviewer must generalize a finding,
search the complete diff and directly related implementation for siblings, and
return consolidated findings before the implementer acts.

`AUTO_FIX` is limited to a deterministic correction already decided by the
Issue, ADR, policy, acceptance criteria, or existing implementation contract.
AUTO_FIX-only blocking findings may proceed automatically through fix,
validation, and a fresh independent review. Product behavior, material
architecture or scope, external service, authentication/credential, privacy
or retention, meaningful recurring cost, irreversible action, or changing an
existing Human Decision is `HUMAN_DECISION_REQUIRED`; report what must be
decided, why repository rules cannot decide it, options, and a recommendation.
Missing credentials, services, fixtures, or repository prerequisites are
`BLOCKED`, not decisions. Never weaken safety boundaries to keep the loop
moving. The default limits are 16 independent review invocations and 8
AUTO_FIX cycles. Track them separately. Escalate after the same normalized
generalized rule repeats three times, or when an AUTO_FIX reports no material
repository change. Legacy review history is retained for audit but is separate
from the current accounting epoch and does not consume its limits or
convergence history. On any limit or convergence stop, report unresolved
findings, repeated categories, per-cycle results, and why convergence failed.

The PR gate requires deterministic validation, a fresh independent `PASS`, no
blocking findings, and no unresolved human escalation. Preserve the secret
and credential policy, fail-closed handling, branch protection, and the
existing opt-in policy for live/external operations. Do not add PR merge
automation, CI replacement, or unconditionally live operations. A follow-up
instruction such as `その指摘通り修正して` resolves the latest relevant
review, applies the same generalization and sibling search, then repeats
validation and fresh review; stop only when the target is ambiguous or a
human decision/blocker is real.

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
run; do not claim runtime validation that was not performed. After self-review
and deterministic validation pass, obtain an independent review in a fresh,
minimal context before creating the PR. Do not create the PR while blocking
findings or unresolved human escalations remain. Follow the detailed
[`independent review gate`](docs/development/independent-review-gate.md).

Stop and report when satisfying the Issue requires a material human-owned
decision, a destructive or irreversible operation, production credentials, or
scope expansion not authorized by the Issue.
