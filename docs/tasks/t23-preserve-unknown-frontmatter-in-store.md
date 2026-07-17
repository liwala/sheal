---
status: done
started: 2026-07-09
closed: 2026-07-09
type: task
id: T23
deliverable: P0
created: 2026-07-07
links:
  - docs/tasks/t19-git-visible-supersede-provenance.md
output: src/learn/store.ts, src/learn/types.ts, test/store-frontmatter.test.ts
---

# T23. Preserve unknown frontmatter through learnings-store round-trips

## Objective

`readLearning`/`renderLearning` keep only the eight known frontmatter fields;
any other key is silently dropped by every store mutation (learn review,
consolidate apply). Future provenance keys (`first-seen`, `confidence`,
`superseded-by` as structured data for T19) would be stripped by the store's
own tooling. Found by the pr-tutor pass on PR #48.

## What we need to extract / do

- Carry unknown frontmatter keys through parse → mutate → render unchanged
  (preserve order where cheap; exact formatting round-trip is not required).
- A test that writes a learning with an extra key, applies a supersede via
  `sheal consolidate --decisions --apply`, and asserts the key survives.

## Done when

- Unknown frontmatter keys survive every mutation path that uses
  `renderLearning` (review accept/edit, consolidate apply actions).
- Test proves it end-to-end through the apply stage.

## Output

`src/learn/store.ts` (parse/render), `src/learn/types.ts`, tests.

## Dependencies

None; unblocks structured provenance in T19 (Make supersede provenance
git-visible).
