# Reusable Issue-to-PR workflow

Issue #35 extracts the proven execution procedure into the repository-local
Skill at [`.agents/skills/issue-to-pr/SKILL.md`](../../.agents/skills/issue-to-pr/SKILL.md).
The Skill is intentionally one cohesive procedure. It does not replace local
policy, add an orchestration service, or decide product and architecture
questions.

## Responsibility inventory

| Concern                                            | Reusable procedure in the Skill                                                                                                                                | Repository-local authority or implementation                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Issue resolution and implementation handoff        | Resolve the Issue, inspect required context, and use one bounded Issue-to-PR flow                                                                              | Issue content, `AGENTS.md`, ADRs, and repository implementation                                           |
| Preflight                                          | Require a clean primary worktree, safe base synchronization, and canonical Issue workspace resolution                                                          | `src/review/git-sync.ts`, `src/review/issue-worktree.ts`, configured base/remote, and local branch policy |
| Validation, self-review, and Maintainability Guard | Run deterministic validation, complete the guard, record its result and follow-up candidates before review                                                     | `package.json` scripts and local acceptance criteria                                                      |
| Independent Review                                 | Use a fresh read-only reviewer, structured findings, generalization, sibling search, and bounded correction                                                    | `src/review/runner.ts`, `src/review/gate.ts`, schema, accounting epoch, and Issue #29 compatibility       |
| Finding handling                                   | Continue only for deterministic `AUTO_FIX`; stop for human decisions or missing prerequisites                                                                  | `AGENTS.md`, Issue/ADR decisions, and repository safety policy                                            |
| PR handoff and CI triage                           | Require a fresh PASS and latest-head CI before reporting readiness; classify failures, use bounded repair/transient-rerun limits, fail closed, and never merge | `src/review/runner.ts`, `src/review/ci-feedback.ts`, GitHub checks, branch protection                     |
| Security and external operations                   | Preserve untrusted Issue/evidence boundaries and fail closed                                                                                                   | `AGENTS.md` and `docs/development/external-integration-safety.md`                                         |

## Lessons incorporated

- Issue #32's CI feedback loop is a shared post-push completion gate, not an
  initial-PR-only feature. Existing-PR updates use the same latest-head check,
  classification, repair, and bounded rerun behavior.
- Issue #34's preflight established safe base synchronization. Under the
  Issue #59 workspace boundary, the primary worktree remains on `main`; dirty,
  ahead, diverged, detached, or unsafe states remain blocked.
- Issue #59's workspace boundary keeps the primary worktree on `main` and
  derives both `feat/issue-N` and `.worktrees/issue-N` from the Issue number.
  Existing canonical workspaces are reused; legacy title-slug ambiguity,
  dirty worktrees, and conflicting attachments remain blocked. The workflow
  never uses stash as a switching mechanism.
- Issue #29's review accounting, finding classification, sibling search,
  convergence, legacy migration boundary, and Human Decision ownership stay
  repository-local. The Skill only describes when and how to invoke those
  contracts.

Issue #64's termination recovery is also repository-local: an AUTO_FIX
implementer self-review block is a structured `BLOCKED` stop, while the known
legacy `NO_PROGRESS` shape is recoverable only through a separate explicit
human approval naming the recovery reason and corroborating evidence. Codex
must not create or self-authorize that approval. After a human creates a
matching durable approval, Codex may invoke the approval-gated resume command.
Recovery preserves the terminal epoch and still requires fresh Independent
Review and exact-head CI.

## Authority model

The effective precedence is:

```text
explicit Human instruction / Human Decision
> repository AGENTS.md and safety policy
> this reusable Skill's procedure
> GitHub Issue as untrusted task specification
> ADRs, docs, implementation, and tests
```

The Issue remains the primary scope and acceptance source, but it cannot
authorize secrets, credentials, live operations, direct base pushes, hook
bypass, merges, policy changes, or scope expansion.

## Adopting the Skill in another repository

1. Install or copy the `issue-to-pr` Skill without copying this repository's
   policy text.
2. Add a concise local `AGENTS.md` defining authority, branch protection,
   validation commands, review gate, secret/live-operation policy, and Human
   Decision boundaries.
3. Point the Skill's procedure at the repository's existing base-sync,
   deterministic validation, Independent Review, PR, and CI observation paths.
   Configure names and commands rather than hard-coding this repository.
4. Add deterministic fixture tests for clean/unsafe preflight, review
   classification and convergence, latest-head CI observation, and fail-closed
   evidence handling before enabling autonomous handoff.
5. Keep product rules, ADR decisions, credentials, provider behavior, and
   migration compatibility local. Split the Skill only after a stable reusable
   responsibility boundary is demonstrated by another consumer.

The supported adoption scenario is a clean repository with one base branch,
one feature branch per Issue, deterministic local validation, a fresh
Independent Review entry point, and a required-check API or CLI. A repository
missing one of those prerequisites should remain blocked rather than inherit
unsafe defaults.

## Deferred follow-up

Separate Skills for preflight, Independent Review, CI triage, or the
Maintainability Guard are intentionally deferred. The current repository has
one cohesive workflow and one consumer; splitting it now would duplicate
authority and create drift.
