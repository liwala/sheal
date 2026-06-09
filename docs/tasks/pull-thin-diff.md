---
status: doing
started: 2026-06-09
type: task
deliverable: D2
created: 2026-06-09
---

# Thin pull: capture git diff to staging with provenance

## Objective

Thinnest vertical slice of the pull verb: `sheal pull sbx <name>` captures the
sandbox's **git diff only** into the staging tree and stamps `provenance.json`.
Proves the host-side host ← sandbox capture path end-to-end (ADR 0005 D1–D3, D6)
before adding more artifact types.

## What we need to extract / do

TDD order (§1), vertical slice (§6):

1. **Inspect first** (§5): run `sbx exec <name> git -C <workdir> diff` and
   `sbx cp` manually against a throwaway sandbox to confirm the mechanics and
   paths (LEARN-012 — test one invocation before coding the adapter).
2. **Write the failing test** (`test/pull-thin.test.ts`): given a faked adapter/
   `exec` returning a known diff, `sheal pull sbx <name>` writes
   `<stagingDir>/sbx/<name>/<ts>/git.diff` and a `provenance.json` containing
   `type`, `name`, agent, status, `pulledAt`, and `sourcePaths`. Assert exit code
   `0` and the staged files' contents. Confirm red for the right reason.
3. **Implement to green**:
   - extend `SandboxAdapter` with `pull(name, dest)` returning a `PullResult`
     (`artifacts[]`, `gaps[]`, `provenance`).
   - sbx adapter `pull()`: read-only — `sbx exec` to run `git diff` in the
     sandbox workdir, write to the staging dir. **Never mutate the sandbox** (ADR
     0004 D3).
   - `src/pull/stage.ts` — staging-tree writer + provenance stamping.
   - `src/commands/pull.ts` — `runPull()` for `sheal pull <type> <name>`.
4. **Confirm green**; manual smoke pull against a real sandbox as a sanity pass
   (§7 — not the only check).

DoD (§10) applies.

## Output

Code: `src/pull/stage.ts`, `pull()` on the sbx adapter, `runPull()` in
`src/commands/pull.ts`; test `test/pull-thin.test.ts`.

## Dependencies

`pull-list-command` (adapter interface, registry, sbx `isAvailable`).
`pull-staging-config` (staging dir resolution) — or land a default here and wire
the setting in that task.
