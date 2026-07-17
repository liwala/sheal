# Working-session cadence

**Tier:** global · **Confidence:** high — backed by the corpus's two worst
health scores (34/100 retro `ba1775df5773`, 60/100 retro `2bcbf75eef24`).

Sessions degrade past ~90 minutes, ~3 workstreams, or any context compaction.
Commit per feature, refuse new features past thresholds, follow a fixed
compaction protocol.

## Members

| ID                | Gist                                                 | Provenance                             |
| ----------------- | ---------------------------------------------------- | -------------------------------------- |
| LEARN-010L        | On compaction: stop features, commit, push, restart  | 2026-03-20, retro `ba1775df5773`       |
| LEARN-013         | After compaction, re-read 3 most-recent files        | 2026-03-20, same                       |
| LEARN-003S        | Merged compaction protocol (010L + 013)              | 2026-03-20                             |
| LEARN-021         | `tsc` + commit after each feature before the next    | 2026-03-26, session `b39d0c2a` (draft) |
| LEARN-022         | 5+ files touched → commit before new feature         | 2026-03-26, same                       |
| LEARN-016 (+007S) | Build/vet after each file edit, never batch compiles | 2026-03-20, retro `ba1775df5773`       |
| LEARN-008L        | After `npm link`: rebuild + smoke before testing     | 2026-03-13, retro `c4419b557931`       |
| LEARN-018 (+009S) | Tool fails twice identically → change approach       | 2026-03-20, retro `ba1775df5773`       |
| LEARN-040         | Don't re-read files already in context               | 2026-05-07, session `3c7c67a3` (draft) |

## Proposed merged rules

1. **Compaction protocol:** on context compaction — stop adding features,
   commit and push, restart fresh; re-read the 3 most-recently-edited files
   before resuming. _(LEARN-003S already is this merge; adopt its text, retire
   010L and 013 as separate items)_
2. **Commit rhythm:** commit per completed feature; at 5+ touched files,
   refuse new features until current work is committed and the next feature's
   file list is written. _(absorbs 021 into 022)_
3. **Batch per file, verify per file:** collect all changes _to one file_
   into a single edit pass, then run the toolchain check (`npx tsc`,
   `go build`) after each file — never batch compiles across files; after
   `npm link`/global install, rebuild and smoke-test before using new
   commands. _(absorbs 007S, 008L; T2 precedence decided 2026-07-06 —
   batching granularity and verification granularity are both the file)_
4. **Retry discipline:** the same tool call failing twice identically means
   change approach, not retry. Extension: trust content already in context by
   default — re-reading it is retry-waste — with exactly two exceptions:
   context compaction occurred (rule 1's re-read clause), or the file has
   been touched 3+ times this session (LEARN-012S). _(absorbs 009S, 040; T1
   precedence decided 2026-07-06)_

## Trigger table

| Trigger                             | Rule |
| ----------------------------------- | ---- |
| Context compaction occurred         | 1    |
| Feature complete / 5+ files touched | 2    |
| Any file edit (toolchain projects)  | 3    |
| Identical tool failure ×2           | 4    |
| Same file touched 3+ times          | 4 (re-read exception) |

## Mechanical candidates

- Compaction trigger → SessionStart(compact) hook injecting the protocol.
- Post-edit `npx tsc` hook (rule 3) — prose today, hook tomorrow.
- Touched-file counter ≥5 → gate prompt (rule 2).
