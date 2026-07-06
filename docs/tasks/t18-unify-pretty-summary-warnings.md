---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T18
deliverable: P0
created: 2026-07-06
links: ["https://github.com/liwala/sheal/pull/47", "docs/tasks/t17-reconcile-strict-warning-definition.md"]
output: src/output/pretty.ts
---

# T18. Unify the pretty summary line with the shared warning predicate

## Objective

T17 unified the JSON summary and `--strict`'s exit code on one warning
predicate, but the default terminal output still counted checker-level
severities only — the same contradiction one surface over (pr-tutor delta
finding on PR #47).

## What we need to extract / do

- `outputPretty` builds its summary line from the shared `buildSummary`
  (detail-level warnings count; passed excludes warn-carriers).

## Done when

- A pass-severity checker with warn details shows as a warning in the pretty
  summary line, proven by a test that failed before the change.

## Output

src/output/pretty.ts, test/check-summary.test.ts.

## Dependencies

T17.
