# Independent review automation spike

## Question

Can the implementation workflow start a genuinely fresh Codex reviewer without
requiring a human to manually start another session, while preserving the
Independent Review Gate defined in
[`independent-review-gate.md`](independent-review-gate.md)?

The required invariant remains:

```text
Implementer context != Reviewer context
```

This spike evaluates the execution mechanism only. It does not redesign the
review policy, add a provider abstraction, or make automated review a normal CI
requirement.

## Capability discovery

The local environment was inspected on 2026-10-03.

### Option A — Codex-native delegation

**Result: insufficient for this local workflow.**

The installed Codex CLI is version `0.160.0`. Its available commands include
`exec`, `review`, `agents`, `fork`, and `app-server`, but the local CLI help did
not expose a direct subagent/delegation command that this implementation
context can invoke with a bounded, explicit handoff. `fork` is also the wrong
primitive for this gate because it intentionally derives from an existing
session rather than proving a context with no implementation history.

OpenAI's official Multi-agent documentation describes subagents with separate
bounded contexts and collaboration actions, but that capability is exposed
through the Responses/Agents API and requires an API-backed application
configuration. It is not a zero-setup local Codex CLI delegation mechanism for
this repository. It would also introduce an API credential, cost, and service
boundary that this Issue does not authorize.

References:

- [OpenAI Multi-agent documentation](https://developers.openai.com/api/docs/guides/responses-multi-agent)
- [OpenAI Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview)

### Option B — Separate local Codex process/session

**Result: available and selected.**

The installed CLI provides a non-interactive `codex exec` command. The selected
invocation uses:

```text
codex exec
  --ephemeral
  --sandbox read-only
  --output-schema src/review/review-result.schema.json
  --json
```

It is a new process with a new ephemeral session. The parent implementation
conversation is not passed to it. The runner supplies only repository metadata,
Issue material, validation results, the intended base, and the review
procedure. The reviewer reads the repository and complete diff itself.

The runner also:

- runs `npm run validate` before invoking the reviewer;
- retrieves the Issue title/body/URL with `gh` and supplies that neutral source
  material to the reviewer;
- passes no raw token, secret, or conversation history to the Codex child;
- restricts the child environment to the minimum local configuration needed for
  Codex authentication and process execution;
- uses read-only sandbox execution for the reviewer; and
- treats process failure, missing output, or malformed output as a non-PASS
  result.

The earlier `codex exec review` subcommand was also tested. It is useful for
human-readable reviews and independently inspected the repository, but its
final output was Markdown rather than the requested schema JSON in this
environment. It was therefore not selected for the machine-readable gate
contract.

### Option C — External orchestration

**Result: not needed.**

Because Option B is available, no GitHub Action, hosted service, paid API,
additional credential, or new infrastructure was investigated or introduced.

## Selected minimum path

The repository provides an opt-in local Issue-to-PR command:

```bash
npm run review:independent -- \
  --issue 29 \
  --base main
```

The command builds the small runner, fetches the Issue body, requires a clean
primary worktree, resolves the canonical Issue workspace (`feat/issue-N` at
`.worktrees/issue-N`), and keeps the primary worktree on `main`. It fetches
`origin/main` and fast-forwards local `main` only when safe before creating or
reusing the canonical workspace and starting a fresh
workspace-write Codex implementer. It validates and commits the implementation,
then starts the bounded independent read-only review/fix loop. Only after a
validated `PASS` does it push the feature branch and create a pull request. It
then waits for the required GitHub Actions checks, adds `Closes #<issue>` only
after they pass, and reports `READY_FOR_HUMAN_REVIEW` only after that update
succeeds. CI repair and transient
reruns are bounded (three repair cycles, two transient reruns, and a bounded
pending-check observation window). It never merges the pull request. The runner stores only a
small branch/base accounting state in the local, untracked
`.git/tableau-ambient-review-state.json` file and stops after 16 review
invocations or 8 AUTO_FIX cycles across process restarts. This command is not
called by `npm run validate` and is not added to
ordinary CI. Before validation or reviewer invocation, the runner requires a
clean base branch and an existing base ref. This prevents uncommitted changes
from entering the autonomous handoff.

For an already-open repository-managed pull request, an agent may complete a
committed follow-up update with the same gate:

```bash
npm run review:independent -- \
  --issue 38 \
  --base main \
  --update-pr https://github.com/Chasoso/tableau-ambient-analyst/pull/1
```

This verifies the active PR and branch, runs validation and a fresh review,
pushes the existing branch, confirms the exact pushed head, and waits for the
required checks before reporting completion. It does not create or merge a PR.
An older green head cannot satisfy the gate; missing or mismatched head/check
evidence fails closed. Follow-up agents must use this repository-managed path
before reporting completion; a direct push to an existing PR is not a
successful handoff.

For an already-prepared committed feature branch, the review-only mode remains
available:

```bash
npm run review:independent -- --review-only --issue 29 --base main
```

`--review-only` performs validation and exactly one read-only Independent
Reviewer invocation. It never launches the workspace-write implementer,
creates a commit, pushes, or creates a pull request. The bounded AUTO_FIX loop
is available only to the full Issue-to-PR path.

After a human merges a pull request, cleanup is explicit and conservative:
optionally remove the remote feature branch, remove the canonical worktree only
when it is clean and no longer needed, delete the corresponding local branch,
and prune stale remote-tracking refs. Dirty, ambiguous, unmerged, ahead,
unpushed, or otherwise unsafe state is never automatically deleted, and legacy
branches are not silently migrated.

The runner is a bounded Issue-to-PR workflow with a bounded review/fix loop.
When
all blocking findings are structured `AUTO_FIX`, a separate workspace-write
Codex implementer applies only those deterministic fixes, creates a
Conventional Commit, and returns to validation and a fresh read-only review.
The reviewer process never edits files. The default maximum is 16 independent
review invocations and 8 actual AUTO_FIX cycles. Repeated normalized
generalized rules and concrete finding identities are tracked; the third
consecutive repeat terminates as `NON_CONVERGING_REVIEW` only when the same
concrete problem has had no meaningful repository progress. A newly discovered
sibling or a meaningful repository change resets that convergence streak. An
AUTO_FIX with no material repository change terminates as `NO_PROGRESS`.

Cycle state is reserved only after the deterministic validation succeeds and
the Issue context has been retrieved, immediately before the Codex process is
started. A validation failure or Issue retrieval failure therefore returns a
closed result without consuming a review invocation. Each runner invocation
reserves at most one review invocation; result capture retries do not consume
an AUTO_FIX cycle. The state file is resolved through Git so linked worktrees
use their actual git directory. It is created with a temporary file and
rename, and an existing malformed or invalid state fails closed with
`HUMAN_DECISION_REQUIRED` rather than resetting the accounting.

The old `cyclesUsed` field has one explicit migration: the Issue #29 branch's
known prior state of 6 invocations and 1 completed AUTO_FIX is retained as
legacy counter audit history. That legacy shape did not contain termination
metadata, so no legacy termination metadata is reconstructed or claimed; only
the current epoch's termination history is retained and enforced. The legacy
counters do not consume the new accounting epoch's limits.
The current epoch is explicit (`issue-29-accounting-v2`) and stores its own
review invocation count, AUTO_FIX count, generalized-rule history, and cycle
records. When the model was activated for the in-progress Issue #29 run, the
current epoch resumed at 6 review invocations and 5 AUTO_FIX cycles; it was not
reset to zero and the legacy six were not double-counted. The legacy state did
not retain per-cycle rule history, so that history starts empty after this
migration. Any other legacy shape is rejected as unrecoverable rather than
resetting or guessing the AUTO_FIX counter; this preserves the configured total
bound across restarts.

## Gate result contract

The smallest machine-readable result is:

```json
{
  "result": "PASS | CHANGES_REQUIRED | HUMAN_DECISION_REQUIRED",
  "blockingFindings": [],
  "nonBlockingFindings": [],
  "escalationRequired": false,
  "maintainability": "NO_DRIFT"
}
```

`maintainability` is required and must be `NO_DRIFT`, `LOCAL_CLEANUP`, or
`FOLLOW_UP_MAINTENANCE`. The runtime parser enforces this field and each
completed review cycle retains the status in its accounting record.

`PASS` can open the gate only after deterministic validation succeeds, blocking
findings are empty, and escalation is false. Invocation failure, malformed
JSON, an inconsistent PASS result, failed validation, or unresolved human
escalation cannot produce PASS. Non-blocking findings alone do not close the
gate.

The contract parser and gate predicate are pure TypeScript functions with
deterministic tests. They do not call a model or network service.

## Independence experiments

### Experiment 1 — Implementer assumption does not leak

The reviewer was started as a new `codex exec --ephemeral` process with a
neutral handoff. It was not given the implementation conversation or a summary
of the intended solution. In the first review it independently found that the
runner did not enforce validation, omitted the complete Issue body, and used an
inaccurate default branch label. These findings were not included in the
handoff, which is evidence that the reviewer was inspecting repository
artifacts rather than accepting the implementer's assumptions.

### Experiment 2 — Complete diff inspection

The reviewer process independently ran repository inspection commands, including
the diff/stat and changed-file checks, before reading the relevant files. The
selected prompt explicitly requires the complete diff against `main` and does
not provide an implementer-selected file subset. A committed branch is required
for the final run so the base comparison includes every intended artifact;
uncommitted changes are not treated as a successful complete-diff review.

### Experiment 3 — Fresh re-review after a blocking finding

The first reviewer run produced blocking findings. The runner was corrected to
enforce validation, include the complete Issue material, report the actual
branch, use structured JSONL output, and enforce the maximum review cycle.
Deterministic validation was rerun. The read-only reviewer is instructed to
inspect the reported validation result rather than rerun write-producing tests
inside its restricted sandbox.
The updated branch must be reviewed by a new `--ephemeral` process before any
PASS is accepted; the implementer cannot self-certify the fixes.

These experiments establish the mechanism and its failure behavior, but they
do not prove that a model will detect every class of defect. That remains pilot
uncertainty.

## Failure and loop behavior

- validation failure: reviewer is not invoked and the gate remains closed;
- process failure or timeout: `HUMAN_DECISION_REQUIRED`-equivalent stop;
- malformed reviewer output: not PASS;
- `CHANGES_REQUIRED` with AUTO_FIX-only findings: invoke the separate
  implementer, commit the in-scope correction, rerun validation, and start a
  fresh review;
- `CHANGES_REQUIRED` with HUMAN_DECISION_REQUIRED or BLOCKED findings: stop;
- `HUMAN_DECISION_REQUIRED`: stop without choosing the material decision; and
- 8 AUTO_FIX cycles: stop and escalate with the accounting report;
- 16 review invocations: stop and escalate with the accounting report;
- the same generalized rule and concrete finding, with no meaningful progress,
  repeated to the threshold: `NON_CONVERGING_REVIEW`; new sibling findings or
  meaningful repository progress continue within the bounds;
- an AUTO_FIX with no repository change: `NO_PROGRESS`.

Review-limit exhaustion is a successful safety stop, not a PASS. Ordinary
retries, commits, CI success, new sessions, and PR updates do not reset it.
When a human decides that continuation is justified, first create a durable
approval record with the human-only authorization command, then run the resume
command from the canonical Issue worktree:

```bash
npm run build
node dist/review/cli.js \
  --authorize-resume-after-limit \
  --confirm-human-authorization \
  --issue 61 \
  --base main \
  --cwd .worktrees/issue-61
node dist/review/cli.js \
  --resume-after-limit \
  --issue 61 \
  --base main \
  --cwd .worktrees/issue-61
```

The authorization command creates a separate durable
`.git/tableau-ambient-review-approval.json` `review-limit-resume` record with
the approved head SHA. Codex must not invoke that command. The
`--confirm-human-authorization` flag records an explicit operator declaration;
it cannot technically prove that the operator is human. A requirement for
cryptographic or platform-backed human identity is `HUMAN_DECISION_REQUIRED`
and must not trigger an agent-selected authentication system. The
resume command is accepted only for the canonical Issue branch, an exhausted
`MAX_REVIEW_INVOCATIONS` state, and one matching unconsumed human approval. It
validates and consumes the approval exactly once, preserves the prior epoch's
counters, findings, cycle results, termination history, and approval reference,
and starts a new bounded epoch. Resume itself is never a PASS: a fresh
Independent Review and the exact-head CI gate remain mandatory. If the new
epoch reaches its limit, automation stops again and requires a new explicit
human authorization.

An AUTO_FIX implementer self-review that reports blocking issues is a distinct
`BLOCKED` stop. It does not consume an AUTO_FIX cycle and is never retried
automatically. A matching `BLOCKED` state is recoverable only when its durable
termination evidence identifies `AUTO_FIX_IMPLEMENTER_SELF_REVIEW_BLOCKED`.
The known older Issue #55 shape may be recovered only through the separate
human-only command with `LEGACY_AUTO_FIX_SELF_REVIEW_BLOCKED` and explicit
corroborating evidence; the runner never infers that reason from
`NO_PROGRESS` alone. The recovery approval is branch/base/epoch/head/reason
bound, single-use, and preserves the original terminal epoch. For example:

```bash
npm run build
node dist/review/cli.js \
  --authorize-termination-recovery \
  --confirm-human-authorization \
  --recovery-reason LEGACY_AUTO_FIX_SELF_REVIEW_BLOCKED \
  --recovery-evidence 'Issue #55 epoch 2 was produced by the documented AUTO_FIX self-review classification bug' \
  --issue 55 --base main --cwd .worktrees/issue-55
node dist/review/cli.js \
  --resume-after-recovery \
  --recovery-reason LEGACY_AUTO_FIX_SELF_REVIEW_BLOCKED \
  --recovery-evidence 'Issue #55 epoch 2 was produced by the documented AUTO_FIX self-review classification bug' \
  --issue 55 --base main --cwd .worktrees/issue-55
```

Codex must not invoke either recovery command. The confirmation flag is an
operator declaration, not cryptographic proof of human identity. Recovery is
never PASS: fresh Independent Review and exact-head CI remain mandatory.

Non-blocking findings are returned for recording and do not automatically cause
implementation churn. A result-capture retry is part of one reviewer
invocation and never increments the AUTO_FIX count.

## Security and network boundary

The reviewer process uses the existing local Codex authentication mechanism,
but no API key, GitHub token, raw auth material, or secret environment variable
is copied into the prompt. The child receives only an allowlisted process
environment. Retrieving the Issue and invoking Codex use network-backed local
tools during this explicit experiment; the application validation path and
ordinary CI remain local/no-network and do not invoke this command.

No GitHub Ruleset, branch protection, merge automation, CI workflow, or paid
API dependency was added.

## Remaining uncertainty

- CLI output and schema behavior may change in future Codex versions;
- the CLI itself does not provide a formal proof of semantic independence from
  all service-side state, so the prompt and ephemeral-session boundary are the
  practical control;
- model review quality, latency, and token usage need observation over 2–3
  subsequent Issues; and
- a human must decide whether to keep this local command as the standard
  workflow after the pilot.

## Recommendation

**Proposed recommendation: KEEP for a bounded local pilot.**

The local `codex exec --json --ephemeral` process is the smallest currently
available path that avoids requiring a human to start the reviewer session,
preserves a neutral handoff, and supports a machine-readable gate result. Keep
the manual #24 fallback, do not add it to ordinary CI, and revisit the choice
if Codex-native delegation becomes available or the local CLI contract changes.

This is a recommendation from the spike, not an automatic permanent workflow
decision. Human confirmation is required before treating it as standard.
