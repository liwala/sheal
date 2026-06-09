---
status: done
started: 2026-06-09
closed: 2026-06-09
type: task
id: T1
deliverable: D2
created: 2026-06-09
links: []
output: src/commands/pull.ts
---

# T1. Batch pull all sbx sandboxes

## Objective

Add `sheal pull sbx --all` as a narrow batch wrapper over the shipped thin
`sheal pull sbx <name>` behavior.

## What we need to extract / do

- Drive the CLI end to end with a fake `sbx` listing multiple sandboxes.
- Pull each sandbox with an available workspace into
  `.sheal/pulls/sbx/<name>/<timestamp>/`.
- Reuse the same `git.diff` and `provenance.json` contract as
  `sheal pull sbx <name>`.
- Skip and report sandboxes with missing workspaces without failing a batch that
  has at least one successful pull.
- Exit non-zero when `sbx` is unavailable or every eligible pull fails.

## Done when

- `sheal pull sbx --all` exits `0` for a batch with pulled and skipped sandboxes.
- Each pulled sandbox has its own staged `git.diff` and `provenance.json`.
- Missing-workspace sandboxes are reported and do not create staged files.
- The command exits non-zero for unavailable `sbx` and for all-failed eligible
  pulls.
- Build and tests are green.

## Output

Code: `src/index.ts`, `src/commands/pull.ts`; test: `test/pull-all.test.ts`.

## Dependencies

`pull-list-command` and `pull-thin-diff`.
