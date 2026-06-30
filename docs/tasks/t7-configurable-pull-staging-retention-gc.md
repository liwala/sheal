---
status: done
started: 2026-06-18
closed: 2026-06-18
type: task
id: T7
deliverable: ops
created: 2026-06-18
links: [q4-staging-retention-gc.md, ../adr/0005-sheal-pull-acquisition-adapters.md]
output: src/config/types.ts, src/config/defaults.ts, src/pull/stage.ts, src/commands/pull.ts, src/index.ts, test/pull-retention.test.ts, docs/tasks/q4-staging-retention-gc.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
---

# T7. Configurable pull staging retention/GC

## Objective
Add a configurable retention path for pull staging directories so acquisition
material does not grow unbounded while project-local raw registry records remain
untouched.

## What we need to extract / do

- Add a configurable pull staging retention parameter.
- Add a maintenance path that can identify expired pull staging directories by
  timestamped staging folder age.
- Remove expired staging directories without deleting
  `<projectRoot>/.sheal/sessions/raw/` records.
- Keep consumed/consolidated signalling out of scope until consolidation reads
  from staging.
- Document the retention contract and deferred consumed/consolidated signal.

## Done when

- End-to-end tests prove expired pull staging directories are removed according
  to the configured retention parameter.
- End-to-end tests prove unexpired staging directories remain.
- End-to-end tests prove project raw registry records are not touched by staging
  GC.
- ADR/task docs state that consumed/consolidated signalling remains deferred.

## Output
Code, tests, and docs for configurable pull staging retention/GC.

## Dependencies
Requires the existing pull staging root configuration from `pull.stagingDir` and
the raw registry storage split from T3.
