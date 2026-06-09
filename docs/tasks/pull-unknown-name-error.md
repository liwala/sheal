---
status: todo
type: task
deliverable: D2
created: 2026-06-09
---

# Unknown sandbox name error path

## Objective

`sheal pull sbx <name>` must fail clearly when `<name>` is not a sandbox the
adapter can see — a non-zero exit and a message pointing at
`sheal pull --list` — rather than producing an empty/partial staging dir.

## What we need to extract / do

TDD order (§1):

1. **Write the failing test** (`test/pull-errors.test.ts`): pulling a name absent
   from `listInstances()` exits non-zero with a message that references
   `sheal pull --list`; no staging dir is created. Also assert a name containing
   shell metacharacters is passed as an `execFile` argument (array), never
   string-interpolated — no injection (§4.3, exec util already uses `execFile`).
   Confirm red.
2. **Implement to green**: validate `<name>` against `listInstances()` before
   pulling; clean, actionable error.

DoD (§10) applies.

## Output

Code: name validation in `runPull()`; test `test/pull-errors.test.ts`.

## Dependencies

`pull-thin-diff` (adapter `pull()` + `runPull()` exist).
