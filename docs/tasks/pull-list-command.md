---
status: todo
type: task
deliverable: D1
created: 2026-06-09
---

# `sheal pull --list` end-to-end (discovery slice)

## Objective

First vertical slice of ADR 0005: a `sheal pull --list` command that enumerates
local container runtimes and the running containers under each. Demonstrable on
its own — run it, see runtimes + containers — before any pulling exists.

**Scope (Q5 answered):** sandboxes only for now — docker backend, focused on
agent **sandboxes**; lima/orbstack deferred. Settle during this task how a
sandbox is distinguished from an ordinary docker container (image/label/name).

## What we need to extract / do

TDD order (AGENTS.md §1), vertical slice (§6), CLI e2e (§7):

1. **Inspect real data first** (§5, LEARN-001): capture actual
   `docker ps --format '{{json .}}'` output and save a fixture.
2. **Write the failing e2e test** (`test/pull-list.test.ts`) driving the command
   with real args, asserting exit code `0` and that output lists detected
   runtimes + running containers (id, name, image, status). Drive the runtime
   call off the fixture via an injected/faked `exec` so the test needs no real
   Docker. Run the suite; confirm it fails for the right reason.
3. **Implement to green**, reading existing patterns before writing (§5):
   - `src/pull/types.ts` — `SandboxAdapter` interface (`type`, `isAvailable()`,
     `listInstances()`) and `SandboxInstance` shape.
   - `src/pull/adapters/docker.ts` — `isAvailable()` (uses `src/utils/exec.ts`;
     ENOENT → `exitCode -2` → false) and `listInstances()` parsing `docker ps`.
   - `src/pull/registry.ts` — registry that returns available adapters.
   - `src/commands/pull.ts` — `runPullList()` following the existing `runX`
     command pattern; support `-f, --format pretty|json` like other commands.
   - `src/index.ts` — register the `pull` command with `--list`.
4. **Confirm green**, then `npx tsc && sheal --help` shows `pull` (LEARN-008).

Definition of done (§10): suite green, lint clean, demonstrable end-to-end,
committed + pushed to this working branch.

## Output

Code: `src/pull/{types,registry}.ts`, `src/pull/adapters/docker.ts`,
`src/commands/pull.ts`, registration in `src/index.ts`; test
`test/pull-list.test.ts` + `docker ps` fixture.

## Dependencies

ADR 0005 (#26). `src/utils/exec.ts`. No blocking dependency.
