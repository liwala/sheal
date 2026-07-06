---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T17
deliverable: P0
created: 2026-07-06
links: ["https://github.com/liwala/sheal/pull/46"]
output: src/output/json.ts
---

# T17. Reconcile --strict's warning definition with the check report summary

## Objective

`check --strict` exits 1 on detail-level warnings, but the JSON
`summary.warnings` counts only checker-level severity — a checker that passes
overall while carrying warn details produces exit 1 with `warnings: 0` in the
report. Confusing exactly where strict lives: CI (pr-tutor finding on PR #46).

## What we need to extract / do

- One shared predicate for "this result carries warnings" used by both the
  summary and the strict exit decision.
- A test covering a pass-severity checker with warn-level details.

## Done when

- `summary.warnings` and `--strict` agree on the same input, proven by a test
  that failed before the change.

## Output

src/output/json.ts, src/commands/check.ts.

## Dependencies

T14 (PR #46).
