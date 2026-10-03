# Independent pre-PR review gate

## Purpose

This document defines a lightweight review gate between implementation and PR
creation. It moves an independent review into the pre-PR workflow without
replacing deterministic validation, human judgment, or later PR review.

The gate is:

```text
Implement
  -> self-review
  -> deterministic validation
  -> independent review in a fresh context
  -> fix blocking findings and rerun validation
  -> independent re-review
  -> zero blocking findings
  -> create PR
```

The process is intended for a manual or scriptable pilot. It does not require
an agent framework, a review bot, a paid API, or live external integration.

## Self-review and independent review

Both reviews are required, and they have different purposes.

### Self-review

The implementation context performs self-review after the change is built. It
checks implementation intent, the complete diff, obvious mistakes, scope,
secrets, documentation consistency, and deterministic validation. It uses the
repository commands appropriate to the Issue, such as `npm run validate`, and
must report checks that were not run.

Self-review is useful preparation, but it is not independent approval because
the implementation context already knows the change's assumptions and intent.

### Independent review

An independent reviewer evaluates the result as a reviewer, not as the author.
The reviewer must use a fresh or otherwise minimal context that does not carry
the implementer's conversation history, hidden reasoning, or persuasive
argument for correctness. The reviewer should challenge assumptions, compare
the result with the Issue, and identify blocking and non-blocking findings.

Independent review does not replace self-review, deterministic validation, or
human review after a PR is opened.

## Reviewer input boundary

Provide only the artifacts needed to review the change:

- the complete Issue body and acceptance criteria;
- `AGENTS.md` and relevant development or safety policies;
- the complete diff against the intended base branch;
- changed files and necessary surrounding code or documentation;
- deterministic validation results and commands actually run; and
- relevant ADRs or other source-of-truth documents.

A short handoff may identify the branch, base, Issue number, changed files,
and validation result. It must remain factual and minimal. Do not require or
provide the implementer's hidden reasoning, implementation transcript, or a
summary designed to persuade the reviewer that the change is correct.

## Pilot execution

During the pilot, run the independent review manually in a separate Codex
session or context. The reviewer context must not contain the implementation
conversation, implementer reasoning, or a persuasive explanation of why the
solution is correct.

Use this sequence:

1. The implementer completes the Issue work on the feature branch.
2. The implementer performs self-review and reviews the complete diff.
3. The implementer runs deterministic validation and records the actual
   results.
4. Start a separate Codex session or context with no implementation history.
5. Give that reviewer only neutral inputs: the repository, feature branch,
   intended base branch, Issue number, validation results, and this reusable
   review procedure/prompt.
6. The reviewer independently reads the complete Issue and acceptance
   criteria, `AGENTS.md`, relevant policies, the complete diff against the
   intended base, changed files, necessary surrounding code/docs, and relevant
   ADRs.
7. The reviewer returns `PASS` or `CHANGES_REQUIRED` using the output contract
   below.
8. If the result is `CHANGES_REQUIRED`, return the findings to the implementer,
   apply only necessary in-scope fixes, and rerun deterministic validation.
9. Start another fresh independent review against the updated complete diff.
10. Repeat until the result is `PASS`, blocking findings are zero, and no
    unresolved human escalation remains.
11. Only then create the PR or, when an existing draft is being used for the
    bootstrap exception below, mark it ready for normal review.

A minimal handoff should contain factual metadata such as:

```text
Repository: Chasoso/tableau-ambient-analyst
Issue: #NN
Branch: feat/...
Base: main

Validation:
- npm ci: passed
- npm run validate: passed
- git diff --check: passed

Run the repository's independent pre-PR review procedure.
```

The handoff must not limit the reviewer to named files or selected changes.
The reviewer must inspect the complete diff itself and may inspect necessary
surrounding code or documentation. Do not pass an implementer summary as a
substitute for that inspection.

After any material correction, prefer a new review context for re-review. At a
minimum, the updated complete diff must be independently re-evaluated; the
implementer may never approve its own correction.

If the environment cannot start a separate Codex session or context, record:

```text
Independent review: pending / unavailable
Gate: not passed
```

Do not substitute the implementation session's self-review and do not report
`PASS` in that situation. During the initial bootstrap of this gate only, a
draft PR may be used to obtain the first independent review when no separate
pre-PR reviewer is available. Such a draft is a bootstrap exception: it is not
gate-passed, not ready for merge, and must remain clearly marked as pending
until a fresh reviewer returns `PASS`.

## Review checklist

Use the following checklist for every independent review. Mark an item as not
applicable when appropriate rather than silently omitting it.

### Requirements

- Does the change satisfy every applicable Issue acceptance criterion?
- Is any required behavior missing?
- Does the implementation or PR claim more than the diff actually delivers?

### Scope

- Are all changes within the Issue scope?
- Are unrelated files, cleanup, or features included?
- Were out-of-scope features or undecided architecture choices introduced?

### Correctness and failure behavior

- Are relevant edge cases, errors, empty results, and unavailable dependencies
  handled correctly?
- Are retry and stop behaviors bounded and consistent with repository policy?
- Are contracts, fixtures, schemas, documentation, and implementation
  internally consistent?

### Tests and validation

- Do deterministic tests cover the important behavior introduced?
- Are tests deterministic where they are expected to be?
- Could tests pass while an internal contract remains broken?
- Were the repository validation commands actually run and reported?

### Documentation and consistency

- Do README, development docs, ADRs, comments, and the PR body match the
  implementation?
- Are accepted decisions represented consistently?
- Are undecided topics still explicitly open?
- Is there one clear source of truth rather than duplicated text that can
  drift?

### Architecture and maintainability

- Is there unnecessary abstraction, speculative framework work, or avoidable
  coupling?
- Is the change appropriately small for the Issue?
- Can later evidence revise the design without unnecessary rework?

### Security and external integration

When relevant:

- Does the change follow
  [`external-integration-safety.md`](external-integration-safety.md)?
- Are secrets or sensitive values exposed in code, logs, fixtures, prompts,
  screenshots, Issues, or the PR?
- Were network, authentication, permission, write, or cost boundaries expanded
  without explicit scope and human authorization?
- Are untrusted tool results treated as data or evidence rather than as new
  authorization or instructions?

### Complete diff and PR integrity

- Was the complete diff against the intended base reviewed, including deleted
  and newly generated files?
- Do the branch, Issue, changed files, tests, docs, validation evidence, and PR
  body tell the same story?
- Is `Closes #<issue>` present only when the Issue is fully completed?

## Finding severity

### Blocking

A blocking finding prevents PR creation until it is fixed or a human-owned
decision resolves it. Examples include:

- an unmet acceptance criterion or required behavior;
- a correctness or unsafe-behavior defect;
- a contract, fixture, schema, or test inconsistency;
- missing required validation or a failing validation result;
- a material documentation/implementation mismatch;
- a material out-of-scope change or undocumented architecture decision;
- exposed credentials or unsafe external-integration behavior; or
- an incorrect Issue-closure claim.

Style preferences, optional cleanup, and future improvements are not blocking
by themselves.

### Non-blocking

Non-blocking findings may be recorded for follow-up without stopping PR
creation. Examples include minor readability improvements, optional cleanup,
future refactoring, or a design consideration that is not required for the
current Issue.

## Reviewer output contract

The reviewer must return an unambiguous gate result in this form or an
equivalent structure:

```text
Review result: PASS | CHANGES_REQUIRED

Blocking findings:
- <finding, or "none">

Non-blocking findings:
- <finding, or "none">

Acceptance criteria:
- satisfied | not satisfied | human decision required

Validation reviewed:
- <commands and results actually inspected>

Escalation required:
- yes | no
- <decision needed, if any>
```

`PASS` is valid for the PR gate only when blocking findings are none,
deterministic validation has passed, and no unresolved human escalation
remains. `CHANGES_REQUIRED` means the PR must not be created yet.

## Re-review loop

When a reviewer reports a blocking finding:

1. return the finding to the implementer;
2. make only the necessary in-scope correction, or stop for human direction;
3. rerun deterministic validation and review the updated complete diff;
4. start an independent review again in a fresh context; and
5. repeat until the result is `PASS` or a human decision is required.

The implementation context must not self-certify that its own fix resolved a
blocking finding. A changed diff always requires independent re-review.

## Human escalation

Escalate instead of deciding automatically when the finding requires a
material choice about:

- product or architecture direction;
- provider or external-service selection;
- security, authentication, authorization, or permission expansion;
- material cost or data-flow behavior;
- Issue scope or acceptance-criteria changes;
- conflicting requirements; or
- accepting a known blocking risk.

The reviewer may describe evidence, alternatives, and a recommendation, but
must not silently finalize a human-owned decision.

## PR creation gate

PR creation is allowed only when all of the following are true:

1. implementation is complete for the Issue;
2. self-review is complete;
3. deterministic validation passes;
4. an independent review was performed from a fresh/minimal context;
5. the latest independent review has zero blocking findings; and
6. no unresolved human escalation remains.

PR creation and merge are separate. Human merge ownership remains unchanged;
Codex must not merge its own PR. Later human, ChatGPT, or GitHub review is
still allowed and is not prohibited by this pre-PR gate.

If a fresh reviewer cannot be started in the current environment, do not claim
that independent review was completed. Report it as unavailable or pending
human/other-session review, and do not present the gate as passed.

## Reusable reviewer prompt

The following prompt can be given to a fresh reviewer together with the
bounded input artifacts above:

```text
You are an independent reviewer, not the implementer. Do not assume the
implementation is correct and do not make unrelated changes.

Read the complete Issue and acceptance criteria, AGENTS.md, relevant repository
policies, the complete diff against the intended base branch, changed files and
necessary surrounding context, and the reported deterministic validation
results. Do not rely on the implementer's hidden reasoning or persuasive
summary. Review from the supplied artifacts only.

Check requirements, scope, correctness and failure behavior, tests and
validation, documentation consistency, architecture/maintainability, security
and external-integration boundaries, and complete diff/PR integrity.

Classify findings as blocking only when they prevent acceptance, indicate a
correctness or safety problem, reveal a material scope or documentation
failure, require missing validation, or require a human-owned decision. Keep
style preferences and optional future work non-blocking.

Return exactly:

Review result: PASS | CHANGES_REQUIRED

Blocking findings:
- ...

Non-blocking findings:
- ...

Acceptance criteria:
- satisfied / not satisfied / human decision required

Validation reviewed:
- ...

Escalation required:
- yes / no
- ...

Do not approve PR creation when blocking findings remain. If a blocking
finding is fixed, require a fresh independent re-review rather than accepting
the implementer's self-assertion.
```

## Pilot approach

Apply the pilot execution procedure manually to the next 2–3 representative
Issues before adding automation. Record lightweight observations in the Issue
or PR when useful:

- independent-review finding count;
- blocking and non-blocking finding counts;
- number of correction/review loops;
- material findings later discovered by external PR review;
- false positives or low-value findings;
- token and time overhead; and
- whether the reviewer context was genuinely independent.

This Issue does not require a measurement system or a structured review
database. Use the pilot evidence to decide whether automation is worthwhile.

## Out of scope

- LLM review bots, GitHub Actions, or automatic PR creation gates;
- multi-agent frameworks, schedulers, daemons, or review servers;
- paid/live API requirements or external credentials;
- automatic merge or bot approval;
- reviewer scoring, ranking, or large telemetry systems; and
- changes to GitHub Rulesets, branch protection, CI, or product features.
