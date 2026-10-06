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

The repository provides an opt-in local command:

```bash
npm run review:independent -- \
  --issue 26 \
  --base main
```

The command builds the small runner, re-runs deterministic validation, fetches
the Issue body, and starts a fresh read-only Codex process. It exits non-zero
unless the reviewer returns a valid `PASS` result. The runner stores only a
small branch/base accounting state in the local, untracked
`.git/tableau-ambient-review-state.json` file and stops after 12 review
invocations or 8 AUTO_FIX cycles across process restarts. This command is not
called by `npm run validate` and is not added to
ordinary CI. Before validation or reviewer invocation, the runner requires a
non-base feature branch, an existing base ref, a clean committed working tree,
and a non-empty diff against that base. This prevents uncommitted or omitted
working-tree changes from being reported as a complete review.

The runner is a bounded review/fix loop, not a general workflow engine. When
all blocking findings are structured `AUTO_FIX`, a separate workspace-write
Codex implementer applies only those deterministic fixes, creates a
Conventional Commit, and returns to validation and a fresh read-only review.
The reviewer process never edits files. The default maximum is 12 independent
review invocations and 8 actual AUTO_FIX cycles. Repeated normalized
generalized rules are tracked; the third consecutive repeat terminates as
`NON_CONVERGING_REVIEW`. An AUTO_FIX with no material repository change
terminates as `NO_PROGRESS`.

Cycle state is reserved only after the deterministic validation succeeds and
the Issue context has been retrieved, immediately before the Codex process is
started. A validation failure or Issue retrieval failure therefore returns a
closed result without consuming a review invocation. Each runner invocation
reserves at most one review invocation; result capture retries do not consume
an AUTO_FIX cycle. The state file is resolved through Git so linked worktrees
use their actual git directory. It is created with a temporary file and
rename, and an existing malformed or invalid state fails closed with
`HUMAN_DECISION_REQUIRED` rather than resetting the accounting.

The old `cyclesUsed` field migrates to `reviewInvocationCount` without being
reset. The Issue #29 branch's prior state of 6 invocations and the prior run
report of 1 actual AUTO_FIX are carried into the new accounting state; the
legacy state did not retain per-cycle rule history, so that history starts
empty after the explicit migration.

## Gate result contract

The smallest machine-readable result is:

```json
{
  "result": "PASS | CHANGES_REQUIRED | HUMAN_DECISION_REQUIRED",
  "blockingFindings": [],
  "nonBlockingFindings": [],
  "escalationRequired": false
}
```

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
- 12 review invocations: stop and escalate with the accounting report;
- the same generalized rule three times consecutively: `NON_CONVERGING_REVIEW`;
- an AUTO_FIX with no repository change: `NO_PROGRESS`.

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
