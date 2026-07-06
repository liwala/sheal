---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T12
deliverable: P0
created: 2026-07-06
links: []
output: src/learn/lint.ts
---

# T12. `sheal learn lint`: corpus hygiene checks

## Objective

Give the learnings store a mechanical hygiene gate: today the store contains
duplicate LEARN IDs with different content, near-duplicate rules, and learnings
with no checkable trigger — and nothing detects any of it.

## What we need to extract / do

- `sheal learn lint` scans the project (and optionally global) learnings store
  and reports:
  - duplicate IDs (same LEARN-### in more than one file),
  - near-duplicate learnings (high title/body token overlap across IDs),
  - learnings with no checkable trigger condition (heuristic: no
    when/before/after/if-style trigger phrasing).
- Exit 0 when clean, exit 1 when findings exist (CI-usable); `--format json`
  for machine consumption.

## Done when

- Each finding type is proven by a test that failed before the implementation.
- Running `sheal learn lint` on this repo's real store reports the known
  LEARN-001/LEARN-002 ID collisions.

## Output

src/learn/lint.ts, src/commands/learn.ts wiring, test coverage.

## Dependencies

None (informed by T11 findings, not blocked by them).
