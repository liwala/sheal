---
status: done
started: 2026-07-07
closed: 2026-07-07
type: task
id: T21
deliverable: P0
created: 2026-07-07
links:
  - docs/adr/0001-sheal-as-consolidation-system.md
  - docs/adr/0001-validation/2026-07-06-change-set.md
output: src/consolidate/apply.ts, src/commands/consolidate.ts, test/consolidate-apply.test.ts, docs/adr/0001-validation/2026-07-07-decisions.json
---

# T21. `sheal review`: apply consolidation change-set dispositions to the store

## Objective

Give the consolidation loop its "Apply" stage: a command that takes a
reviewed change set plus human decisions and executes the dispositions
against `.sheal/learnings/` — so the store gets cleaned mechanically and
reproducibly instead of by hand-editing 56 files. Unblocks T16 (wire guards
into hooks and CI), which cannot lint a dirty store.

## What we need to extract / do

- An apply verb (`sheal review` or `sheal consolidate --apply`) that reads a
  change set and applies each disposition kind:
  - **Renumber** — resolve the 12 ID collisions (one learning keeps the ID,
    the other gets the next free number; references updated).
  - **Merge + retire** — mark absorbed learnings `superseded` with a pointer
    to the surviving item or topic page (same provenance mechanism as the
    T14 emitter), per the merge table in
    `docs/adr/0001-validation/2026-07-06-change-set.md`.
  - **Reclassify** — retire LEARN-019/020 as product feedback with a pointer
    to the follow-up product task.
  - **Rewrite-or-retire** — surface no-trigger items (LEARN-031, LEARN-043)
    for a decision; apply the recorded outcome.
- Decisions live in a reviewable file (annotated change set or a sidecar
  decisions file) so the apply step is deterministic and re-runnable.
- Dry-run by default or an explicit `--apply` flag: never mutate the store
  without an affirmative flag, matching `sheal consolidate`'s
  store-untouched contract.
- After apply, `sheal consolidate` and `sheal learn lint` must come back
  clean (0 collisions, 0 no-trigger items; merge candidates resolved or
  explicitly kept).
- Respect the T1/T2 tension decisions recorded 2026-07-06 in the ADR change
  set (e.g. LEARN-040/013/012S survive as the precedence rule, not as
  separate contradictory items).

## Done when

- A TDD'd command applies renumber / supersede / retire dispositions from a
  change set + decisions input, with a dry-run mode, and never mutates the
  store without the explicit apply flag.
- Running it on the current store resolves the 12 ID collisions, the merge
  table from the 2026-07-06 change set, the LEARN-019/020 reclassification,
  and the two no-trigger dispositions.
- `node dist/index.js consolidate` and `sheal learn lint` report a clean
  store afterwards (exit 0).
- Superseded items carry provenance pointers (retire reason + successor),
  compatible with T19's git-visible provenance direction.

## Output

New command under `src/` (e.g. `src/commands/review.ts` + apply logic in
`src/consolidate/`), tests, and the cleaned `.sheal/learnings/` store.

## Dependencies

- T1/T2 tension decisions — **done 2026-07-06** (recorded in
  `docs/adr/0001-validation/2026-07-06-change-set.md`).
- Change-set generation (T13) and supersede marking (T14) — both shipped.
