---
status: done
started: 2026-06-09
type: task
deliverable: D1
created: 2026-06-09
closed: 2026-06-09
output: src/commands/pull.ts
---

# `sheal pull --list` end-to-end (discovery slice)

## Objective

First vertical slice of ADR 0005: a `sheal pull --list` command that enumerates
local agent sandboxes through `sbx ls --json`. Demonstrable on its own — run it,
see sandbox name, agent, status, workspaces, and missing-workspace markers —
before any pulling exists.

**Scope at the time (Q5 answered):** sbx first — treat Docker Sandboxes (`sbx`)
as the first sandbox backend. This slice established `sheal pull sbx <name>`;
raw Docker container discovery was later added by T2. Lima and OrbStack remain
deferred.

## What we need to extract / do

TDD order (AGENTS.md §1), vertical slice (§6), CLI e2e (§7):

1. **Inspect real data first** (§5, LEARN-001): capture actual
   `sbx ls --json` output and save a sanitized fixture.
2. **Write the failing e2e test** (`test/pull-list.test.ts`) driving the command
   with real args, asserting exit code `0` and that output lists sbx sandbox
   name, agent, status, workspaces, and `workspace_missing` when present. Drive
   the sbx call off the fixture via a faked `sbx` executable on `PATH` so the
   test needs no real sandbox runtime. Run the suite; confirm it fails for the
   right reason.
3. **Implement to green**, reading existing patterns before writing (§5):
   - `src/pull/types.ts` — `SandboxAdapter` interface (`type`, `isAvailable()`,
     `listInstances()`) and `SandboxInstance` shape.
   - `src/pull/adapters/sbx.ts` — `isAvailable()` and `listInstances()` parsing
     `sbx ls --json`.
   - `src/pull/registry.ts` — registry that returns available adapters.
   - `src/commands/pull.ts` — `runPullList()` following the existing `runX`
     command pattern; support `-f, --format pretty|json` like other commands.
   - `src/index.ts` — register the `pull` command with `--list`.
4. **Confirm green**, then `npx tsc && sheal --help` shows `pull` (LEARN-008).

Definition of done (§10): suite green, lint clean, demonstrable end-to-end,
committed + pushed to this working branch.

## Output

Code: `src/pull/{types,registry}.ts`, `src/pull/adapters/sbx.ts`,
`src/commands/pull.ts`, registration in `src/index.ts`; test
`test/pull-list.test.ts` + `sbx ls --json` fixture.

## Dependencies

ADR 0005 (#26). `src/utils/exec.ts`. No blocking dependency.
