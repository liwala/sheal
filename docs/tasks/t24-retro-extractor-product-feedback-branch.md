---
status: todo
type: task
id: T24
deliverable: P0
created: 2026-07-17
links:
  - docs/adr/0001-validation/2026-07-06-change-set.md
  - https://github.com/liwala/sheal/pull/49
---

# T24. Retro extractor: branch "product feedback vs. learning"

## Objective

The LEARN-019/020 reclassification showed the retro extractor files bug
reports about sheal itself into the learnings store as if they were
agent-behavior rules. T22 (PR #49) shipped the input-gap validation half;
this task adds the classification half: when a candidate learning is about
sheal's own pipeline (retro input quality, capture gaps, tool defects),
route it to product feedback (a suggested docs/tasks item), not the store.

## What we need to extract / do

- A classification step in the extraction path (`src/retro/analyzers.ts`
  extractLearnings or the enrich flow) that labels candidates
  `learning` vs `product-feedback`, with a conservative heuristic
  (mentions of sheal/retro/checkpoint/capture tooling as the subject).
- Product-feedback candidates surface in retro output under their own
  heading with a suggested task title — never written to
  `.sheal/learnings/`.
- Tests: a session complaining about retro input completeness produces a
  product-feedback item and no store write; a normal behavioral lesson
  still lands as a learning.

## Done when

- Red-first tests for both branches of the classification pass.
- `sheal retro` output shows product feedback separately; the learnings
  store receives none of it.

## Output

src/retro/ (extraction seam), tests.

## Dependencies

T22 merged (PR #49).
