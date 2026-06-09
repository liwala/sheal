---
status: todo
type: task
deliverable: D2
created: 2026-06-09
---

# Full capture set with gap logging

## Objective
Extend the thin pull to the full minimal capture set in ADR 0005 D5 — git diff →
in-flight agent memories / self-authored artifacts (per ADR 0004) → session
transcript, in priority order — and record anything absent in `gaps[]` instead of
failing.

## What we need to extract / do
TDD order (§1):

1. **Write failing tests** (`test/pull-capture.test.ts`):
   - a container with diff + a `.claude/` dir + `AGENTS.md`/`MEMORY.md` →
     all land in staging, `gaps[]` empty.
   - a container missing the transcript / memory paths → those are listed in
     `provenance.json` `gaps[]`, and the pull still exits `0` (graceful
     degradation, ADR D5 "logs the gap" — never a silent partial).
   Confirm red.
2. **Implement to green**:
   - define the ordered candidate path list to copy out (workdir git diff,
     agent artifact paths, transcript pointer).
   - docker adapter `pull()` copies each present path via `docker cp`; records
     missing ones as gaps.
   - surface gaps in command output (and JSON format).
3. **Confirm green.**

DoD (§10) applies.

## Output
Code: extended docker `pull()` + capture-set definition; gap reporting in
`src/commands/pull.ts`; test `test/pull-capture.test.ts`.

## Dependencies
`pull-thin-diff`.
