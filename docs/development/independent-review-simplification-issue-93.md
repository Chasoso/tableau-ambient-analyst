# Independent Review orchestration simplification investigation

Status: investigation complete; recommendation is pending explicit Human Decision.

Issue: [#93](https://github.com/Chasoso/tableau-ambient-analyst/issues/93)

This document records a read-only comparison of `main` and the available,
unmerged `feat/issue-77` worktree. It proposes a design direction only. It
does not authorize a runner change, a security-policy change, a limit change,
or recovery of another Issue's state.

## 1. Evidence and boundary

The comparison was made on 2026-10-17 after `main` was fetched and verified at
`00ffe3daf03e72c6533f3062e8670750a10e99f3`, equal to `origin/main`.

Observed repository facts:

| Signal | `main` | `feat/issue-77` | Interpretation |
| --- | ---: | ---: | --- |
| `src/review/runner.ts` lines | 8,191 | 9,136 | #77 adds 945 lines to the orchestration boundary |
| `src/review/cli.ts` lines | 354 | 364 | More recovery entry-point plumbing |
| `tests/independent-review.test.ts` lines | 8,899 | 9,356 | More state and recovery contract surface |
| exported authorize/resume/reconcile/finalize functions | 26 | 27 | A new public recovery operation |
| `rawArguments.includes(...)` checks | 22 | 25 | Three additional CLI mode checks |
| case-insensitive `lock` references in runner | 120 | 248 | Lock/liveness coordination is the dominant #77 expansion |

The counts are indicators, not a quality metric. They are useful because the
additional code is concentrated in coordination and recovery rather than in
the reviewer verdict contract. The available #77 worktree and its local
ignored state files were inspected read-only. No #77 or #88 file, branch,
accounting record, approval record, or stop state was changed. The ignored
state files available in this checkout were empty/uninitialized, so no claim
is made here about live historical counters or the exact blocked #77 runtime
state described by the Issue. That runtime fact remains an Issue-provided
input until independently reproducible evidence is supplied.

## 2. Current responsibility inventory

The current runner combines these responsibilities:

1. Establish a canonical Issue branch/worktree and exact base/HEAD identity.
2. Run deterministic validation and retrieve untrusted Issue material.
3. Reserve a bounded review invocation, mark it started, invoke a separate
   read-only reviewer, and record a structured verdict.
4. Decide whether a verdict is PASS, deterministic AUTO_FIX, a human-owned
   escalation, a reviewer execution failure, or a terminal bounded stop.
5. Run a separate write-enabled AUTO_FIX implementer, validate its path and
   self-review report, commit it, and start a fresh review.
6. Persist counters, epoch history, cycle results, failure evidence,
   termination evidence, and pending invocation state.
7. Issue and consume single-use approvals for limit resume and exceptional
   recovery, with repository/branch/base/HEAD/schema/state-preimage bindings.
8. Serialize accounting and operation/recovery transitions using lock files,
   temporary/rename writes, transaction markers, and process-liveness checks.
9. Push only after a fresh PASS, verify the pushed exact head, and observe
   bounded CI before handoff.

The key structural observation is that the runner is both the normal state
machine and the repair system for its own partially completed transitions.
When a transition is interrupted, recovery must prove which side effects
occurred. When that proof itself races with a normal invocation, another lock
and another preimage/liveness check are added. The same coordination is then
duplicated across reservation reconciliation, reviewer-failure recovery,
termination recovery, limit finalization, and Issue-specific compatibility.

### Main versus #77

`main` already has durable accounting, atomic file replacement, exact identity
checks, bounded review/AUTO_FIX limits, structured reviewer output, and
explicit single-use Human Decision paths. #77 adds stale accounting-lock
inspection/recovery and additional operation-lock checks around reviewer
failure and reservation recovery. It also tightens retry evidence and commit
boundary validation.

The evidence does not support the claim that a file lock is intrinsically the
root cause. The deeper cause is a multi-writer, multi-phase protocol whose
recovery commands must mutate two durable files and prove process absence
between observations. A new lock protects the recovery command, but the lock
creates a new object with owner identity, age/liveness, archive, preimage,
approval, and interrupted-recovery states. Recovery therefore becomes another
workflow requiring recovery.

Facts and assumptions are kept separate:

- Fact: #77 adds an accounting-lock recovery entry point and many lock/liveness
  guards, as shown by the diff and source inspection.
- Fact: the repository requires fail-closed handling, exact-head CI, bounded
  accounting, and human-owned authorization.
- Assumption requiring later measurement: a single-process runner invocation
  is the normal deployment topology. If concurrent invocations are a hard
  product requirement, the recommendation needs a separate concurrency design
  review rather than an implicit lock expansion.
- Unverified: whether every historical recovery state in #77 can be migrated
  without preserving its exact audit shape. No migration should be inferred
  from this document.

## 3. Minimum safety invariants

These are guarantees, not commitments to a particular file, lock, or command:

1. A fresh, structurally and semantically valid, evidence-backed independent
   review PASS is required before push or PR handoff.
2. Reviewer and implementer contexts remain independent. Reviewer output is
   read-only evidence; it is never authorization.
3. Issue, canonical branch, base, worktree, reviewed HEAD, pushed HEAD, and CI
   head are exact identities. A changed or ambiguous identity fails closed.
4. Review invocation and AUTO_FIX budgets are durable, bounded, and never
   refunded, reset, or silently migrated. Current limits remain 16 invocations,
   8 AUTO_FIX cycles, and the configured repeat/no-progress rules.
5. Accounting transitions are exclusive and race-safe; each approval is
   single-use and bound to its exact target state.
6. Review history, counters, approvals, and failure/termination evidence are
   immutable in meaning and auditable across process restarts.
7. Missing, malformed, partial, stale, or contradictory evidence is not
   success and does not authorize autonomous continuation.
8. Time, cost, process, review, AUTO_FIX, CI repair, transient rerun, and
   pending-observation work remain bounded.
9. Reviewer execution failure, crash with unknown liveness, non-converging
   findings, exhausted limits, unverifiable state, security decisions, and
   final merge remain distinct outcomes.
10. Human ownership remains with security/authorization policy, material
    architecture or external-service choices, recovery of unverifiable state,
    and the final merge decision.

## 4. Options using common criteria

| Criterion | A. Minimal repairs | B. Simplified runner | C. Delegate primitives |
| --- | --- | --- | --- |
| Shape | Keep the current state machine; repair each observed gap | One linear invocation record plus one terminal/audit append path; keep only necessary recovery | Use OS/process/file primitives for exclusive create, atomic replace, and child termination where portable |
| Feasibility | High: compatible with existing tests and #77 | Medium: requires explicit redesign and migration decision | Medium for primitives; low for semantics because OS primitives do not provide approval/audit policy |
| macOS/Windows/Node.js | Existing behavior is known; more platform-specific cases accumulate | Portable if the durable format and atomic-write contract are kept small | `open(...,'wx')`, rename, PID/process APIs, and signal semantics differ; Windows process identity is not equivalent to POSIX liveness |
| Independence/safety | Preserves current gate, but more paths can diverge | Preserves the gate if every transition has one owner and one evidence contract | Helps with mechanics only; cannot establish reviewer independence, exact identity, or Human authorization |
| Unattended completion | Better for known failures, worse as new failure paths stop | Best for known, bounded transient failures; hard stops remain explicit | May reduce implementation code but not policy stops |
| Crash/concurrency | More recovery cases and races | Crash leaves one unambiguous pending/unknown state; concurrent second invocation is rejected | Crash semantics depend on OS and filesystem; stale-owner interpretation remains a policy problem |
| Migration risk | Low but preserves complexity | Medium/high; requires a one-way, fail-closed migration and #76/#77 audit preservation | Medium; replacing primitives can alter platform behavior without reducing semantic states |
| Testability | Broad matrix continues to grow | Smaller state-transition matrix and deterministic crash injection points | Requires a macOS/Windows matrix and filesystem/process fault tests |
| New failure modes | Recovery-handler drift and lock/recovery recursion | Lost detail if the compact record is underspecified; this must be prevented by append-only evidence | False stale-process conclusions, rename/locking differences, orphaned children |
| Cost | Low now, recurring maintenance | Medium once, lower recurring coordination cost | Medium now, recurring portability cost |

Option C is useful as an implementation detail inside B, not as an
architecture by itself. OS primitives can provide exclusive creation and
atomic publication, but they cannot decide whether an interrupted reviewer
was executed, whether an approval is legitimate, or whether a limit may be
continued.

## 5. Failure-mode matrix

| Failure | Observable state | Required invariant | Safe autonomous action | Human action | Structural elimination |
| --- | --- | --- | --- | --- | --- |
| Normal completion | PASS, exact reviewed HEAD, pushed-head CI PASS | 1–3 | Publish audit result and hand off | Merge only | Reduce duplicate coordination; not eliminate |
| Crash before durable write | No transition record | 4, 6, 7 | Re-read; do not refund or infer success | Resolve only if ambiguity remains | Single commit point reduces states |
| Crash after durable write | Record exists; next step may be absent | 4, 6 | Reconcile from immutable record, or stop | Decide unverifiable state | One append/commit boundary |
| Interrupted recovery | Approval/transaction pending | 5–7 | No second recovery or refund | Explicitly inspect exact preimages | Remove recovery transactions where possible |
| Reviewer exits/orphans/unknown liveness | Started invocation with failure or unknown process | 1, 4, 7, 8 | Record failure without refund; stop if liveness is unknown | Authorize any exceptional retry | One owner and one terminal failure record |
| Stale accounting/operation lock | Lock exists but ownership is uncertain | 5, 7 | Never age-delete; stop | Explicit recovery decision | Avoid semantic lock recovery by rejecting concurrent invocation |
| Concurrent invocation/resume | Two commands target same epoch/state | 5, 6 | One wins; other fails closed | Resolve only if evidence conflicts | Single-writer runner process |
| Partial/malformed evidence | JSON/record/preimage invalid | 6, 7 | Stop; do not repair by guessing | Inspect and decide migration/recovery | Atomic complete records and strict parser |
| Changed HEAD/base | Fingerprint mismatch | 2 | Stop and require fresh review | None unless state repair is requested | Capture identity at one transition boundary |
| Duplicate/forged/stale approval | Binding, preimage, or consumption mismatch | 5–7, 10 | Reject and leave state unchanged | Provide a new valid Human Decision if appropriate | Single-use target-bound approvals; cannot eliminate human decision |
| Review limit exhausted | 16 invocations, or 8 AUTO_FIX, or terminal reason | 4, 9, 10 | Stop; never reset/extend | Explicit authorized resume or accept terminal state | Cannot eliminate without changing policy |
| Repeated findings/no progress | Same concrete finding repeats with no material progress | 4, 9 | Stop at configured threshold | Decide scope/architecture change | Progress-aware state can avoid duplicate retries, not the hard stop |

The matrix deliberately separates a reviewer execution failure from
`CHANGES_REQUIRED`, a safe crash from unknown liveness, and a configured limit
from a broken state. Missing error evidence never becomes PASS.

## 6. Recommendation: B, with a narrow use of C

Recommend a simplified single-writer runner, subject to explicit Human
Decision. The runner should have one normal state transition owner and one
durable, append-oriented audit record for each invocation. A compact state
machine should distinguish only:

- `READY` / no active invocation;
- `RUNNING` with exact Issue/branch/base/worktree/HEAD and a bounded deadline;
- a durable terminal result (`PASS`, `CHANGES_REQUIRED`, execution failure, or
  bounded stop); and
- `HUMAN_DECISION_REQUIRED` for unknown or policy-owned state.

The proposed shape retains the independent child reviewer, structured parser,
exact identity checks, current budgets, fail-closed semantics, AUTO_FIX
eligibility rules, and exact-head CI gate. It simplifies or removes generic
recovery commands that exist only to repair an interrupted multi-file
coordination protocol. Approval records remain only for genuinely
human-owned policy decisions, not for routine repair of runner bookkeeping.

Use existing Node/filesystem primitives for exclusive create and atomic
replacement where they are already portable and tested. Do not introduce an
OS-specific lock manager, age-based deletion, process supervisor, service, or
authentication provider.

### Complexity reduction evidence

This is a state-category reduction, not a LOC target:

| Category | Current `main` / #77 shape | Proposed target |
| --- | --- | --- |
| Lock mechanisms | Accounting lock plus operation/recovery locks, with liveness, archive, and preimage handling; #77 adds another recovery lock family | One runner ownership boundary; no semantic stale-lock recovery path |
| Persisted states | Counters, epoch history, pending review, failure recovery, termination recovery, multiple transaction markers, approvals, and compatibility records | One in-flight record plus immutable terminal/audit entries; explicit unknown state |
| Recovery entry points | Limit resume, termination recovery, reviewer-failure recovery, reservation reconciliation, Issue-specific reconciliation, and #77 accounting-lock recovery/finalization | Normal bounded retry only when the runner has an unambiguous failure record; otherwise one Human Decision stop |
| Failure paths | Every partially completed recovery can require lock, preimage, liveness, and transaction recovery | Fewer transition boundaries; crash ambiguity is a deliberate hard stop rather than a new recovery protocol |

The proposed design does not claim that all historical records can be deleted.
Existing #76/#77/#88 records must remain readable as audit history, and a
fail-closed compatibility reader may remain isolated from the new writer.

## 7. Migration and test plan (not authorized by this Issue)

Implementation must be a separate explicitly approved change:

1. Freeze the current accounting schema and write a read-only compatibility
   reader for #76, #77, #88, and the Issue #29 epoch. Do not rewrite or refund
   historical counters.
2. Define the compact transition/audit schema and prove mappings for normal
   PASS, deterministic AUTO_FIX, reviewer failure, terminal limit, and
   unknown state. Reject every unmapped shape.
3. Implement the single-writer boundary behind the existing CLI contract and
   keep the current limits unchanged.
4. Add deterministic tests for every row in the failure matrix, including
   crash before/after each durable boundary, partial writes, concurrent start,
   changed HEAD, duplicate approval, and process-liveness uncertainty.
5. Run macOS and Windows tests for exclusive creation, atomic replacement,
   path resolution, child timeout/termination, and restart behavior.
6. Exercise rollback by reading old records without mutating them, and verify
   that a failed migration leaves the old state untouched.
7. Re-run the complete self-review, fresh Independent Review, exact-head CI,
   and a human review of the security/authorization policy before adoption.

The migration must preserve the Issue-to-PR contract: clean canonical
worktree, independent PASS, no direct main push, latest exact-head CI, bounded
repair/rerun limits, and no Codex merge.

## 8. Human Decision required

Before implementing B (or changing any authorization/security policy), a
Human must decide whether the repository accepts the following recommendation:

> Adopt a single-writer, compact durable state machine; retain fail-closed
> unknown-state stops and current budgets; use OS/filesystem primitives only as
> mechanics; preserve legacy records through a read-only compatibility reader;
> remove generic stale-lock/recovery recursion rather than adding handlers.

Viable alternatives are A (minimal repairs, lowest migration risk but ongoing
complexity) and C (delegate mechanics, smaller local code but material
cross-platform/process-semantics risk). The recommendation is B plus the
narrow C primitive use because it reduces the number of states requiring
recovery while preserving the invariants. This document is not that approval.

Impact is intentionally limited: #76/#77/#88 worktrees, implementations,
accounting, approvals, and stop states remain unchanged. #77 should not be
resumed, rebased, pushed, or used as an approved baseline by this Issue. #88's
blocked launch case remains a regression fixture/input. Any implementation
must provide an explicit rollback and a human decision on how legacy
recovery-only states are represented.

## 9. Quality notes

- This deliverable changes documentation only.
- No runner, CLI, accounting, approval, lock, authentication, or security
  policy was changed.
- No reviewer limit was reset or extended, and no external credential or live
  Tableau operation was used.
- Follow-up maintenance candidate: keep implementation responsibilities
  split by lifecycle stage when the approved redesign is implemented; do not
  broaden this investigation into a runner refactor.
