---
status: todo
type: task
id: T13
deliverable: P0
created: 2026-07-06
links: ["docs/adr/0001-sheal-as-consolidation-system.md", "docs/adr/0001-validation/2026-07-06-change-set.md"]
---

# T13. `sheal consolidate`: emit a reviewable change set

## Objective

Productize the consolidation pass that T11 ran manually: `sheal consolidate`
reads the learnings store (plus retros for provenance), runs the
sort → compare → decide stages, and emits a change-set document — merge/retire
dispositions, near-duplicate groups, contradictions for the review queue, and
prose-vs-mechanical classification.

## What we need to extract / do

- Mechanical pre-pass reuses `learn lint` (duplicate IDs, near-duplicates as
  merge candidates).
- LLM stage (agent CLI invocation, like `retro --enrich`) produces
  dispositions and contradiction findings; the T11 output at
  `docs/adr/0001-validation/2026-07-06-change-set.md` is the reference format.
- Output is a dated change-set file — dry-run by default, never mutates the
  store. A later `--apply` (or `sheal review`) executes it.

## Done when

- `sheal consolidate` on a fixture store emits a change set naming at least
  one merge group and one no-trigger disposition, proven by tests that failed
  first.
- Run against the real store, its mechanical sections agree with `learn lint`.

## Output

src/consolidate/ + command wiring, tests.

## Dependencies

T11 (format validated), T12 (lint primitives). LLM-stage quality gating
arrives with `sheal eval` Layer A.
