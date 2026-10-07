# Maintainability review

Issue #30 establishes a lightweight maintainability guard for Issue-to-PR
changes. The guard examines the complete diff and directly related
implementation, then records one of the statuses defined in `AGENTS.md`.
It detects architecture drift without turning style preferences into a merge
gate.

## Issue #30 review disposition

| Area                                                 | Classification | Disposition                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/review/runner.ts` responsibility density        | `DEFER`        | The runner has real boundaries, but splitting it would be a broad safety-sensitive refactor. Track a responsibility-level follow-up rather than changing accounting and persistence together here. |
| `src/review/gate.ts` and `review-result.schema.json` | `KEEP`         | Runtime parsing and child-process schema validation are separate enforcement boundaries.                                                                                                           |
| Accounting, migration, and concurrency tests         | `KEEP`         | Their separation documents distinct safety properties and should not be compressed for appearance.                                                                                                 |
| Existing review and development docs                 | `KEEP`         | They remain the source-specific contracts; the guard is referenced rather than copied into each document.                                                                                          |

No high-confidence dead production module, safe broad consolidation, or
deterministic module split was found within this Issue's bounded scope.

## Guard statuses

- `NO_DRIFT`: no meaningful maintainability debt is introduced.
- `LOCAL_CLEANUP`: a deterministic cleanup inside the Issue scope is applied.
- `FOLLOW_UP_MAINTENANCE`: a real maintainability concern is recorded for a
  later Issue without expanding the current change.

The guard must distinguish meaningful responsibility drift from style
preference. A large file alone is not a reason to split it; a split requires a
clear boundary and an authorized scope. Maintainability findings are searched
across directly related siblings, consolidated, and reported with explicit
follow-up candidates.
