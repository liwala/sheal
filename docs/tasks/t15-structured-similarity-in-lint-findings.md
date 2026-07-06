---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T15
deliverable: P0
created: 2026-07-06
links: ["https://github.com/liwala/sheal/pull/46"]
output: src/learn/lint.ts
---

# T15. Expose near-duplicate similarity as structured data in lint findings

## Objective

`buildChangeSet` regex-parses the similarity score out of the lint finding's
human-readable message — rewording the message silently degrades similarity to
"n/a" and no test catches it (pr-tutor finding on PR #46).

## What we need to extract / do

- Add a numeric `similarity` field to near-duplicate `LintFinding`s.
- `buildChangeSet` consumes the field instead of scraping the message.
- A test pins the numeric value end-to-end (lint finding → change set).

## Done when

- The change set carries a numeric similarity that survives message rewording,
  proven by a test that failed before the change.

## Output

src/learn/lint.ts, src/consolidate/change-set.ts.

## Dependencies

T12, T13 (both on PR #46's stack).
