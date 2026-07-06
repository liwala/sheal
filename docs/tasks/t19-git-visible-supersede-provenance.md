---
status: todo
type: task
id: T19
deliverable: P0
created: 2026-07-06
links: ["docs/tasks/t14-compile-mechanical-learnings.md"]
---

# T19. Make supersede provenance git-visible

## Objective

T14's provenance convention (compiled learning → `status: superseded` +
pointer) lives only in the gitignored store — invisible to PR reviewers, and
unsynced machines still carry the prose as active while the repo assumes it's
compiled (pr-tutor finding on PR #46/#47).

## What we need to extract / do

- Decide the mechanism: a committed supersede ledger (e.g.
  `docs/adr/`-adjacent log or a tracked `.sheal-manifest`), emission into the
  AGENTS.md rules block by `sheal rules`, or store-sync as the answer
  (learn push/pull) with a check that flags divergence.
- Whatever the mechanism, `sheal check` (or `learn lint`) should detect "this
  machine's store contradicts the repo's compiled artifacts".

## Done when

- A reviewer can see from tracked files which learnings are compiled into
  which artifacts, and a stale store is mechanically detectable.

## Output

TBD by mechanism decision.

## Dependencies

T14; relates to Q6's promotion-publishes-to-git model.
