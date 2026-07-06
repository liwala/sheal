---
status: todo
type: task
id: T16
deliverable: P0
created: 2026-07-06
links: ["https://github.com/liwala/sheal/pull/46", "docs/tasks/t14-compile-mechanical-learnings.md"]
---

# T16. Wire guard pr and check --strict into hooks/CI (close the enforcement loop)

## Objective

T14's artifacts exist but nothing invokes them — "enforced" is still opt-in
(pr-tutor finding on PR #46). Superseded prose is only truly replaced once the
gate fires automatically.

## What we need to extract / do

- A committed hook or CI step runs `sheal guard pr` before PR creation —
  base-aware for stacked branches (default `--base main` would misfire on a
  stack; derive the base from the PR or a flag).
- `sheal check --strict` (or `learn lint`) as a CI step — decide first whether
  the repo's own store must be clean (dispositions executed) before this can
  be green.
- Demonstrate the gate failing on a real violation.

## Done when

- Committed configuration fires at least one T14 gate automatically, shown
  failing on a violation and passing after the fix.

## Output

CI workflow / hook config + docs.

## Dependencies

PR #46 merged; disposition execution for the store-cleanliness question.
