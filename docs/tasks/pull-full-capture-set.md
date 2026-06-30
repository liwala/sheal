---
status: done
started: 2026-06-10
closed: 2026-06-10
type: task
deliverable: D2
created: 2026-06-09
output: src/commands/pull.ts, src/pull/adapters/sbx.ts, src/pull/capture-set.ts, test/pull-capture.test.ts
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
   - a container with diff + `$HOME/.claude/` / `$HOME/.codex/` evidence → all
     runtime-home evidence lands in staging, `gaps[]` empty.
   - a container missing an agent-specific runtime-home transcript path → that
     path is listed in `provenance.json` `gaps[]`, and the pull still exits `0`
     (graceful degradation, ADR D5 "logs the gap" — never a silent partial).
     Confirm red.
2. **Implement to green**:
   - define the ordered candidate path list to copy out (workdir git diff,
     agent artifact paths, transcript pointer).
   - sbx adapter `pull()` copies each present path via `sbx cp`; records missing
     ones as gaps.
   - surface gaps in command output (and JSON format).
3. **Confirm green.**

DoD (§10) applies.

## Output

Code: extended sbx `pull()` + capture-set definition in `src/pull/capture-set.ts`;
gap reporting in `src/commands/pull.ts`; test `test/pull-capture.test.ts`.

## Dependencies

`pull-thin-diff`.
