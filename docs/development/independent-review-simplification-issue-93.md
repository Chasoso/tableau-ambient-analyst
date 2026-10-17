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
10. Human ownership remains with product direction; material architecture or
    external-service selection; security, authentication, and authorization;
    privacy or retention; meaningful recurring cost or material data-flow
    choices; hypothesis keep/revise/reject decisions; conflicting
    requirements; recovery of unverifiable state; and the final merge
    decision. Missing credentials, services, fixtures, or prerequisites are
    blocked prerequisites, not decisions to be guessed by the runner.
11. The Issue-to-PR contract remains intact: one Issue, canonical
    `feat/issue-N` branch and `.worktrees/issue-N` workspace, clean primary
    `main`, no direct main push, no force push or hook bypass, and no Codex
    merge. A fresh PASS and exact-head CI are required before handoff.
12. CI repair is bounded to 3 repair cycles, 2 transient reruns, and 60
    pending polls. These bounds, like the 16 review-invocation and 8
    AUTO_FIX limits, are not reset or extended by a redesign.

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

### Bounded continuation policy evaluation

Unattended continuation is safe only for a narrowly defined, known execution
failure, not for an uncertain state. A future implementation may continue
automatically when all of the following are durably evidenced in the same
transition record: the child exited or timed out with a known result; the
child is verified not to be live; Issue/branch/base/canonical-worktree/HEAD
and reviewer-schema identity are unchanged; the failure record is complete and
valid; and the current time, cost, invocation, AUTO_FIX, and CI limits still
have room. The next reviewer attempt is a new invocation and consumes one
invocation budget unit. No counter is refunded, reset, or extended. The
continuation must remain within the configured timeout and retry bounds; where
the failure is tied to an AUTO_FIX cycle, measurable repository progress is
also required before another continuation is considered.

This policy is an architecture evaluation, not a request to increase today's
limits or to resume any existing Issue. It would make the normal transient
reviewer-process exit/timeout path unattended while preserving the current
accounting evidence. It must hard-stop on unknown child liveness, missing or
malformed failure evidence, changed identity, concurrent invocation, partial
or interrupted recovery, non-converging findings, exhausted limits, security
or authorization questions, and any human-owned decision. A bounded retry
that cannot prove these predicates returns `HUMAN_DECISION_REQUIRED`; it never
counts missing error data as success.

## 6. Conditional recommendation: B, with a narrow use of C

The evidence supports B as the candidate direction, subject to explicit Human
Decision and the feasibility proof below; it does not establish that B is
ready to implement. The proposed simplified single-writer runner would have
one normal state transition owner and one durable, append-oriented audit
record for each invocation. A compact state machine would distinguish only:

- `READY` / no active invocation;
- `RUNNING` with exact Issue/branch/base/worktree/HEAD and a bounded deadline;
- a durable terminal result (`PASS`, `CHANGES_REQUIRED`, execution failure, or
  bounded stop); and
- `HUMAN_DECISION_REQUIRED` for unknown or policy-owned state.

The proposed shape would retain the independent child reviewer, structured parser,
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

### Evidence required before selecting B

Before implementation is authorized, the following must be demonstrated in a
separate spike or design review. The single-writer assumption must be made
explicit: the supported topology is one active Issue-to-PR runner for one
canonical Issue workspace; a second invocation fails closed rather than
joining or repairing the first. If concurrent invocations are a required
product behavior, B is not established by this investigation and A or a new
concurrency design must be considered.

The proof obligations are:

1. Ownership: an exclusive-create primitive identifies one active operation;
   the record binds operation ID, Issue, branch, base, canonical worktree,
   HEAD, schema fingerprint, deadline, and phase. There is no age-based owner
   deletion and no generic stale-lock recovery.
2. Crash atomicity: each state publication is written to a temporary file,
   flushed according to the supported Node/filesystem contract, and atomically
   renamed. A restart sees either the prior complete record or the next
   complete record, never a partial success. An active or ambiguous record
   remains `HUMAN_DECISION_REQUIRED` unless its terminal evidence is complete.
3. Restart semantics: a known, durably recorded child exit may consume a new
   invocation under the bounded-continuation predicates above; unknown
   liveness, interrupted recovery, and malformed records stop without refund.
4. Accounting/approval semantics: the same single writer atomically records
   the invocation outcome and, where applicable, consumes a target-bound
   single-use approval. Duplicate, stale, or cross-worktree approvals leave
   state unchanged. Historical #76/#77/#88 records are read-only evidence.
5. Concurrency/crash tests pass on macOS and Windows, including two starts,
   crash before/after every publication boundary, partial replacement,
   changed HEAD, duplicate consumption, and a child whose liveness cannot be
   verified. Any failed proof criterion keeps B conditional and leaves A as
   the safer implementation choice.

These are acceptance criteria for a future implementation decision, not claims
that the current runner already satisfies the compact protocol.

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

## 8. #77 review-iteration evidence and causal analysis

### What is available

The unmerged canonical #77 worktree has a read-only durable accounting file
with 16 `CHANGES_REQUIRED` cycle results, 0 recorded AUTO_FIX cycles, and
one to three structured findings per invocation. The file preserves
generalized rules and finding identities, but not reviewer prose, timestamps,
review prompts, child-process logs, or a commit SHA for each finding. No GitHub
PR for `feat/issue-77` was discoverable, and no approval file was present in
the #77 worktree. The following is therefore a classification of the durable
finding evidence plus the ordered implementation commits, not a claim that
every reviewer conversation was recovered.

The #77 state was read without writing it. Its 16 rounds were:

| Round | Durable finding theme | Evidence-based class | Confidence / limitation |
| ---: | --- | --- | --- |
| 1 | Limit terminal state and complete stop/recovery documentation | Existing gap in the initial #77 implementation | High for the observed gap; exact pre-round baseline is not stored |
| 2 | Retry snapshot identity, uncertain recovery, retry-history consistency | Existing/incomplete recovery contract | High; causal commit link unavailable |
| 3 | Base commit and runner compatibility were absent from snapshot bindings | Previously missed invariant | High |
| 4 | Failure-name retry allowlist and optional snapshot bindings | Existing design gap, then exposed by the preceding binding work | Medium; no per-round diff reference |
| 5 | Process liveness and separate retry/accounting transactions | New coordination risk exposed by retry implementation | Medium |
| 6 | Optional bindings and missing accounting revalidation before retry | Same root contract left incomplete | High for repetition; causal “introduced by” status unverified |
| 7 | Resume race and bounded-reason substring false positives | One recovery race plus an independently missed sibling/near-miss case | High for finding content; sibling-search procedure itself unrecorded |
| 8 | Operation-lock check outside the accounting lock | New race exposed by the earlier repair | Medium |
| 9 | Stale accounting lock and operation-lock absence treated as process proof | New recovery surface created by lock-based coordination | High for structural relationship; exact authoring round unverified |
| 10 | Missing process-termination evidence accepted | Previously missed fail-closed parser invariant | High |
| 11 | Retry proof, retry snapshot ordering, accounting-lock scope/race | New interactions among safety checks and recovery | Medium |
| 12 | Interrupted lock archival and duplicate approval issuance | New recovery-of-recovery paths | High for the two concrete gaps |
| 13 | Diagnostic labels as authorization and missing bounded-reason tests | Existing policy mismatch plus missed sibling tests | High |
| 14 | Nonzero/empty diagnostics, missing termination proof, lexical sibling authorization | New failure classification edge plus recurring sibling-search weakness | High for repeated themes |
| 15 | Empty stderr accepted and separate recovery mutex race | New near-miss and new lock interaction | High |
| 16 | Operation locks can remain stale after forced termination | New lock failure mode, final stop after 16 invocations | High |

The ordered commit messages support the broad sequence: initial recovery
hardening, then terminal-state/snapshot/recovery binding, then liveness and
serialization, followed by accounting-lock recovery. They do not bind a
specific finding to a specific commit. In particular, it is **unverified**
whether a given finding existed before the preceding repair, was introduced by
that repair, or was merely made visible by it. No conclusion below treats that
causal distinction as proven.

### What the 16 rounds demonstrate

The strongest verified pattern is not “the reviewer missed 16 unrelated bugs.”
It is a chain of incomplete safety contracts:

1. A recovery feature created new durable states and bindings.
2. A review found one missing binding or race.
3. The repair added a check at one boundary.
4. A later review found the same invariant missing at another boundary, or
   found a race between two separately updated records.

The repeated generalized rules make this visible: process-absence proof,
snapshot completeness, retry/accounting revalidation, serialized approval
consumption, lock recovery, and lexical sibling authorization recur across
multiple rounds. This is evidence of structural coupling and incomplete
consolidation, not evidence that more lock handlers are the right remedy.

### Did the existing review rules work?

| Rule | Evidence of operation | Evidence of insufficiency |
| --- | --- | --- |
| Complete diff review | Findings cite runner, gate, CLI, docs, and tests across the changed diff | Related invariants were still discovered in later rounds; the durable state does not record a dependency-cone checklist or a consolidated pre-fix report |
| Finding generalization | Every round stores generalized rules and identities | Similar rules recur in rounds 2–6, 9–12, and 13–16; generalization happened after each finding, not as a complete pre-fix closure step |
| Bounded sibling search | Round 7 and rounds 13–14 identify near-miss bounded-reason cases | Search scope, sibling set, and negative controls are not persisted; therefore effectiveness is not independently verifiable |
| Consolidated findings | Some rounds reported 2–3 related findings together | No evidence shows that all findings for one invariant cluster were held and reported before AUTO_FIX; the one-finding/one-repair pattern remained possible |
| AUTO_FIX self-review | The accounting records `AUTO_FIX` classification and repositoryChanged fields | #77 records 0 AUTO_FIX cycles and no post-fix impact checklist; it cannot prove that a write-enabled implementer actually checked the full affected dependency cone |

The practical change should therefore be to the review packet and repair
protocol, not another duplicated prose rule: require a pre-fix invariant
cluster report with complete-diff coverage, generalized rule, bounded sibling
set, related locations, and negative controls; require the AUTO_FIX report to
include before/after dependency-cone review and targeted regression evidence;
and only then allow one consolidated fix batch. This reduces serial discovery
without claiming one review is complete.

## 9. Review continuation and budget alternatives

The current 16-invocation counter, 8 AUTO_FIX bound, repeat threshold, and
Human Decision rules remain unchanged. The following are future policy choices
only.

| Option | Infinite-loop prevention | Cost/accounting | Stop conditions | Human intervention | Auditability / unattended completion |
| --- | --- | --- | --- | --- | --- |
| A. Keep 16; improve review quality | Existing 16, repeat, no-progress, and CI bounds remain the hard ceiling | Simple and predictable; lowest policy/migration cost | Any current terminal state still stops at 16 | Human may decide what to do after terminal state; no implicit extension | Highest comparability and easiest audit; unattended completion improves only by reducing avoidable rounds |
| B. Predefined total budget with objective progress | Global invocations/time/cost plus per-cluster and no-progress bounds; no reset/refund | More useful work can fit within a pre-approved total budget, but cost is less predictable per Issue | Unknown state, changed identity, malformed evidence, no measurable repository/test progress, cluster repeat, or total budget exhaustion | Human pre-approves policy and decides after total budget; no LLM-only extension | Auditable if progress is derived from commit/diff/test/finding-identity evidence; better unattended completion only when evidence is objective |
| C. Separate budgets for execution failure, substantive cycles, and no-progress | Each class bounded; also retain a global wall/cost budget and consecutive no-progress stop | Distinguishes cheap launch failures from real review/fix work; requires more counters and migration | Failure-class budget, substantive-cycle budget, no-progress, unknown liveness, or any human/security stop | Human owns category budgets and any continuation beyond them | More diagnostic and potentially better completion, but more states and accounting complexity—the risk this Issue is trying to avoid |

Option B is the narrowest candidate for future evaluation. “Progress” must be
machine-observable: a new committed repository state, a changed normalized
finding identity, a passing targeted validation that was previously failing,
or a durable state transition that closes a known execution failure. An LLM
self-report such as “I made progress” is insufficient. Every extra review is
a new invocation; counters are never refunded or reset. Option C is useful as
a measurement model even if its separate operational counters are not adopted.

## 10. B案の効果、限界、成立条件

The B candidate could remove the following current paths, provided the proof
obligations in Section 6 pass:

- routine recovery mutexes and stale-lock deletion/recovery commands that
  exist only because multiple commands mutate the same transition;
- separate “record failure, clear terminal state, then reserve again” windows;
- approval issuance/consumption paths used to repair ordinary runner
  bookkeeping rather than a genuine Human Decision;
- recovery-of-recovery transactions for lock archival, duplicate approvals,
  and interrupted multi-file coordination.

B does **not** remove these hard stops: unknown child liveness, malformed or
partial accounting, changed Issue/branch/base/HEAD/schema, concurrent active
runner, unverifiable approval, non-converging findings, exhausted approved
budget, security/authorization ambiguity, missing prerequisites, and final
merge. A known child exit with complete failure evidence and unchanged identity
may be retried automatically within the current bounded budget. A residual
lock or unknown process cannot be age-deleted or assumed absent; it requires a
Human Decision unless a platform-tested ownership protocol proves safe absence.

The conditions for practical unattended completion are stronger than fewer
lines: one active runner per canonical workspace, atomic publication of one
complete transition record, a read-only compatibility reader for old
accounting, objective progress evidence, and a tested child termination model.
If any condition fails, A is the safer recommendation. A successful B spike
must report not only code reduction but the measured rate of uninterrupted
Issue-to-PR completion, human stops, recovery operations, and safe restarts.

Platform checks must cover macOS and Windows separately: exclusive-create and
rename semantics, flush/durability expectations, path and permission errors,
PID/child-tree liveness and termination, forced process exit, antivirus/file
sharing interference, and restart after each durable boundary. Node.js API
parity is necessary but not sufficient evidence.

## 11. Minimum spike and adoption criteria

No implementation is authorized by this PR. The following is the smallest
evidence package for a later decision:

| Hypothesis | Minimum verification | PASS / FAIL | Fallback and metric |
| --- | --- | --- | --- |
| One runner can own a canonical workspace safely | Two concurrent starts plus restart/forced-exit tests on macOS and Windows using a temp workspace | PASS only one owner proceeds and the other fails closed with intact evidence; FAIL if both proceed, state is ambiguous, or cleanup requires age deletion | Keep A or obtain a separate concurrency design; measure competing-start rejection and human stops |
| State publication is crash-atomic | Inject termination before/after each state and approval publication; reload repeatedly | PASS only prior/next complete record is observed and no counter is refunded; FAIL on partial success or unrecoverable intermediate state | Keep existing transactional paths; measure safe restart rate and manual recovery operations |
| Known reviewer failure can restart safely | Child exit/timeout/launch failure fixtures with positive termination proof, changed HEAD, unknown liveness, permission-like exit, and malformed evidence | PASS only complete evidence + unchanged identity consumes one new invocation; FAIL if ambiguous failures retry or approval is accepted | Stop and require Human Decision; measure automatic safe restart rate and false-retry rate (must be zero) |
| Old accounting remains auditable | Read #76/#77/#88/#29 fixtures through compatibility reader without writing them; compare hashes and fields | PASS if all supported records remain unchanged and unmapped records fail closed; FAIL on rewrite, inferred history, or counter change | Preserve A and isolate a read-only reader; measure migration coverage and rejected-shape count |
| Consolidated review reduces serial rounds | Replay representative #77 finding clusters with a review packet containing diff, dependency cone, sibling set, and negative controls | PASS if related findings are reported in one batch without suppressing a known defect; FAIL if packet omits affected siblings or materially increases false negatives | Keep current review with better prompts/checklists; measure findings-per-invocation, repeated-root-cause rate, and post-fix regression rate |
| Objective progress supports continuation | Use committed diff hashes, normalized finding identities, targeted test results, and bounded total budget; compare against no-progress fixtures | PASS only machine-observable progress permits continuation and no-progress stops; FAIL if LLM text alone changes the decision | Maintain A or use C only for measurement; measure added cost, completion rate, stop frequency, and audit completeness |

Adoption requires a human review of the measured results. Minimum decision
metrics are: (1) unattended Issue-to-PR completion rate, (2) human
intervention stop count per Issue, (3) recovery operation count, (4) safe
restart rate after abnormal exit, (5) duplicate/false retry rate, (6) review
rounds and repeated-root-cause rate, (7) total review/AUTO_FIX cost, and (8)
percentage of accounting states covered without mutation. No single metric,
especially LOC or lock count, is sufficient.

## 12. Human Decision required

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

## 13. Quality notes

- This deliverable changes documentation only.
- No runner, CLI, accounting, approval, lock, authentication, or security
  policy was changed.
- No reviewer limit was reset or extended, and no external credential or live
  Tableau operation was used.
- Follow-up maintenance candidate: keep implementation responsibilities
  split by lifecycle stage when the approved redesign is implemented; do not
  broaden this investigation into a runner refactor.
