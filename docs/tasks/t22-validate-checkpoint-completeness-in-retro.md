---
status: todo
type: task
id: T22
deliverable: P0
autonomy: auto
created: 2026-07-07
links:
  - docs/adr/0001-validation/2026-07-06-change-set.md
---

# T22. Validate checkpoint completeness inside `sheal retro`

## Objective

`sheal retro` should detect and report incomplete session input (truncated
assistant responses, missing tool errors, missing file lists) instead of
producing hollow analysis from thin data. This is the product-side fix the
consolidation pass extracted from LEARN-019/020, which were retired as
"product feedback, not agent-behavior rules".

## What we need to extract / do

- Define a completeness check for retro input (checkpoint/session data):
  which fields must be present and non-truncated for a meaningful retro.
- Run the check before analysis; on gaps, report them explicitly in the
  retro output (and consider a non-zero exit or `--strict` behavior).
- The retro extractor should also branch "product feedback vs. learning" —
  bug reports about sheal itself should not enter the learnings store.

## Done when

- `sheal retro` on a session with incomplete input names the gaps in its
  output rather than silently analyzing thin data.
- A test drives the CLI with a truncated fixture and asserts the gap report.

## Output

Validation inside `src/commands/retro.ts` (or the retro engine), tests.

## Dependencies

None — extracted from the ADR 0001 validation change set (mechanical
compilation targets table, 019/020 row).
