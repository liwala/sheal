---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T14
deliverable: P0
created: 2026-07-06
links: ["docs/adr/0001-validation/2026-07-06-change-set.md"]
output: src/commands/guard.ts
---

# T14. Compile mechanical learnings into hooks and checkers (emitter v0)

## Objective

A learning that can be a hook and stays prose is a bug: prose costs context
tokens every session and fires unreliably. The T11 change set names 12
mechanical compilation targets; this task ships the first emitter slice that
turns a classified-mechanical learning into an enforced artifact.

## What we need to extract / do

- Pick the 2–3 cheapest targets from the change set's mechanical table, e.g.:
  - `sheal check --strict` (warnings exit non-zero) — compiles LEARN-007;
  - pre-PR ahead-of-base checker (`git rev-list base..HEAD` non-empty) —
    compiles LEARN-038;
  - pre-checkout dirty-tree guard — compiles LEARN-026.
- Each emitted artifact records which learning it compiles (provenance), so
  the learning can be marked `status: superseded` by the artifact rather than
  deleted.

## Done when

- At least two mechanical learnings are enforced by code/config instead of
  prose, each proven by a test that failed first.
- The source learnings are marked superseded with a pointer to the artifact.

## Output

checker/hook implementations + provenance convention.

## Dependencies

T11 change set (target list). Independent of T13.
